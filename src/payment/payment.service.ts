import { PrismaService } from 'src/shared/services/prisma.service';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Currency, Payment, PaymentStatus } from '@prisma/client';
import { BotService } from 'src/shared/services/bot.service';
import { CreateStarsPaymentDto } from './dto/create-stars-payment.dto';
import { getMessage } from 'src/shared/consts/messages.consts';
import { TonService } from './services/ton.service';
import { InitiateTonPaymentDto } from './dto/initiate-ton-payment.dto';
import { TonWebhookDto } from './dto/ton-webhook.dto';
import { ReferralService } from 'src/shared/services/referral.service';

@Injectable()
export class PaymentService {
  private logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private bot: BotService,
    private tonService: TonService,
    private referralService: ReferralService,
  ) {}

  async createStarsInvoice(userId: string, data: CreateStarsPaymentDto) {
    let payment: Payment | null = null;
    try {
      // Get user language
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { languageCode: true },
      });

      const languageCode = user?.languageCode || 'en';

      payment = await this.prisma.payment.create({
        data: {
          userId: userId,
          amount: data.amount,
          currency: Currency.XTR,
          status: PaymentStatus.PENDING,
        },
      });

      const invoiceResponse = await this.bot.createInvoice({
        title: getMessage(languageCode, 'payment.title'),
        description: getMessage(languageCode, 'payment.description'),
        payload: `payment_${payment.id}`,
        prices: [
          {
            label: getMessage(languageCode, 'payment.label'),
            amount: data.amount,
          },
        ],
      });

      return {
        invoiceLink: invoiceResponse.invoice,
        paymentId: payment.id,
      };
    } catch (error) {
      if (payment) {
        await this.prisma.payment.delete({ where: { id: payment.id } });
      }
      if (error instanceof HttpException) throw error;
      throw new HttpException('Failed to create payment', 500);
    }
  }

  async initiateTonPayment(userId: string, data: InitiateTonPaymentDto) {
    try {
      const stars = await this.tonService.convertToStars(data.amount);

      const payment = await this.prisma.payment.create({
        data: {
          userId: userId,
          amount: stars,
          currency: Currency.TON,
          status: PaymentStatus.PENDING,
        },
      });

      return {
        payment: payment,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to initiate TON payment:', error);
      throw new HttpException('Failed to initiate TON payment', 500);
    }
  }

  async tonWebhook(data: TonWebhookDto) {
    try {
      const transactions = await this.tonService.getTransactions(data.lt);

      if (!transactions || transactions.length === 0) {
        this.logger.warn('No transactions found for the given lt');
        return { status: 'ok', message: 'No transactions found' };
      }

      for (const tx of transactions) {
        if (tx.hash === data.hash) {
          const ton = Number(tx.inMsg?.value) / 1_000_000_000;
          const usd = await this.tonService.convertToUSD(ton);
          const payment = await this.prisma.payment.findFirst({
            where: {
              currency: Currency.TON,
              status: PaymentStatus.PENDING,
              createdAt: {
                gte: new Date(Date.now() - 20 * 60 * 1000),
              },
              amount: {
                gte: ton * 0.99,
                lte: ton * 1.01,
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            include: {
              user: true,
            },
          });

          if (!payment) {
            this.logger.error(
              `No matching pending payment found for TON amount: ${ton} TON (${usd} USD)`,
            );
            return { status: 'ok', message: 'No matching payment found' };
          }

          // Process the payment
          await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.COMPLETED,
                invoiceId: data.hash,
              },
            });

            // Update user balance
            await tx.user.update({
              where: { id: payment.userId },
              data: {
                balance: {
                  increment: payment.amount,
                },
              },
            });

            this.logger.log(
              `TON payment completed: ${payment.id}, User: ${payment.userId}, Amount: ${payment.amount} USD (${ton} TON)`,
            );
          });

          // Process referral commissions after payment is completed
          const referralReward =
            await this.referralService.processDepositReferrals(
              payment.userId,
              payment.amount.toNumber(),
            );

          if (referralReward.referral) {
            const reward = referralReward.referral;

            // Update referrer balance and create earning record in a transaction
            await this.prisma.$transaction(async (tx) => {
              // Update referrer's balance
              await tx.user.update({
                where: { id: reward.referrerId },
                data: {
                  balance: { increment: reward.amount },
                },
              });

              // Create referral earning record
              await tx.referralEarning.create({
                data: {
                  referrerId: reward.referrerId,
                  referredUserId: reward.referredUserId,
                  paymentId: payment.id,
                  amount: reward.amount,
                  percentage: reward.percentage,
                  isFirstDeposit: reward.isFirstDeposit,
                },
              });
            });

            this.logger.log(
              `Referral reward (${reward.isFirstDeposit ? '10% first' : '3% subsequent'}): User ${reward.referrerId} earned ${reward.amount} XTR from ${payment.userId}'s TON deposit`,
            );

            // Send notification to referrer about earning
            const [referrer, referredUser] = await Promise.all([
              this.prisma.user.findUnique({
                where: { id: reward.referrerId },
                select: { telegramId: true, languageCode: true },
              }),
              this.prisma.user.findUnique({
                where: { id: reward.referredUserId },
                select: { username: true },
              }),
            ]);

            if (referrer && referredUser) {
              const messageKey = reward.isFirstDeposit
                ? 'referral.firstDepositReward'
                : 'referral.subsequentDepositReward';
              const notificationMessage = getMessage(
                referrer.languageCode,
                messageKey,
                {
                  username: referredUser.username,
                  amount: reward.amount.toString(),
                },
              );
              await this.bot.sendMessage(
                referrer.telegramId,
                notificationMessage,
              );
            }
          }

          return {
            status: 'ok',
            message: 'TON payment processed successfully',
          };
        }
      }

      this.logger.warn(
        `Transaction hash ${data.hash} not found in fetched transactions`,
      );
      return { status: 'ok', message: 'Transaction not found' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to process TON webhook:', error);
      throw new HttpException('Failed to process TON webhook', 500);
    }
  }
}
