// bot.service.ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard } from 'grammy';
import { PrismaService } from './prisma.service';
import { LanguageCode, PaymentStatus, SystemKey } from '@prisma/client';
import { CreateInvoiceDto } from '../dto/invoice.dto';
import { getMessage } from '../consts/messages.consts';
import { ReferralService } from './referral.service';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot;
  private token: string;
  private webAppUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private referralService: ReferralService,
  ) {}

  public getBotToken(): string {
    return this.token;
  }

  public getWebAppUrl(): string {
    return this.webAppUrl;
  }

  private setup() {
    this.bot.command('start', async (ctx) => {
      const telegramId = ctx.from.id;
      const username = ctx.from.username || 'Unknown';
      const firstName = ctx.from.first_name;
      const lastName = ctx.from.last_name;
      const languageCode =
        ctx.from.language_code === 'ru' ? LanguageCode.ru : LanguageCode.en;

      // Получаем фото профиля пользователя
      let photoUrl: string | null = null;
      try {
        const userProfilePhotos = await ctx.api.getUserProfilePhotos(
          telegramId,
          { limit: 1 },
        );

        if (userProfilePhotos.photos.length > 0) {
          const photo = userProfilePhotos.photos[0][0]; // Берем первое фото в наименьшем размере
          const file = await ctx.api.getFile(photo.file_id);
          photoUrl = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
          this.logger.log(`Got photo URL for user ${telegramId}: ${photoUrl}`);
        }
      } catch (error) {
        this.logger.error(`Failed to get user photo for ${telegramId}:`, error);
      }

      const keyboard = new InlineKeyboard().webApp(
        getMessage(languageCode, 'bot.buttonText'),
        this.webAppUrl,
      );

      // Get user photo from Telegram
      let photo: string | null = null;
      try {
        const photos = await ctx.api.getUserProfilePhotos(telegramId, {
          limit: 1,
        });
        if (photos.total_count > 0) {
          const fileId = photos.photos[0][0].file_id;
          const file = await ctx.api.getFile(fileId);
          photo = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch photo for user ${telegramId}:`,
          error,
        );
      }

      // Extract referral code from /start command (format: /start ref_USERID)
      const startPayload = ctx.match; // Gets everything after /start
      let referrerId: string | null = null;

      if (startPayload && typeof startPayload === 'string') {
        const parts = startPayload.trim().split('_');
        if (parts[0] === 'ref' && parts[1]) {
          referrerId = parts[1];
          this.logger.log(
            `User ${telegramId} started with referral code from ${referrerId}`,
          );
        }
      }

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { telegramId: telegramId.toString() },
        select: { id: true, referredBy: true },
      });

      // Only set referrer if:
      // 1. User is new OR user exists but has no referrer
      // 2. Referrer ID was provided
      // 3. User is not trying to refer themselves
      let shouldSetReferrer = false;
      if (referrerId) {
        if (!existingUser) {
          // New user - check referrer exists and is not the same user
          const referrer = await this.prisma.user.findUnique({
            where: { id: referrerId },
            select: { id: true, telegramId: true },
          });

          if (referrer && referrer.telegramId !== telegramId.toString()) {
            shouldSetReferrer = true;
          }
        } else if (!existingUser.referredBy) {
          // Existing user without referrer - check referrer exists and is not the same user
          const referrer = await this.prisma.user.findUnique({
            where: { id: referrerId },
            select: { id: true, telegramId: true },
          });

          if (referrer && referrer.telegramId !== telegramId.toString()) {
            shouldSetReferrer = true;
          }
        }
      }

      await Promise.all([
        this.prisma.user.upsert({
          where: { telegramId: telegramId.toString() },
          update: {
            username: username,
            firstName: firstName,
            lastName: lastName,
            photoUrl: photoUrl,
            languageCode: languageCode,
            photo: photo,
            ...(shouldSetReferrer && { referredBy: referrerId }),
          },
          create: {
            telegramId: telegramId.toString(),
            username: username,
            firstName: firstName,
            lastName: lastName,
            photoUrl: photoUrl,
            languageCode: languageCode,
            photo: photo,
            ...(shouldSetReferrer && { referredBy: referrerId }),
          },
        }),
        ctx.reply(getMessage(languageCode, 'bot.welcome'), {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        }),
      ]);

      if (shouldSetReferrer) {
        this.logger.log(
          `Successfully set referrer ${referrerId} for user ${telegramId}`,
        );

        // Send notification to referrer about new referral
        const referrer = await this.prisma.user.findUnique({
          where: { id: referrerId },
          select: { telegramId: true, languageCode: true },
        });

        if (referrer) {
          const referrerMessage = getMessage(
            referrer.languageCode,
            'referral.newReferral',
            { username: username },
          );
          await this.sendMessage(referrer.telegramId, referrerMessage);
        }

        // Send welcome message to referred user
        const referrerInfo = await this.prisma.user.findUnique({
          where: { id: referrerId },
          select: { username: true },
        });

        if (referrerInfo) {
          const welcomeMessage = getMessage(
            languageCode,
            'referral.welcomeReferral',
            { referrerUsername: referrerInfo.username },
          );
          await this.sendMessage(telegramId.toString(), welcomeMessage);
        }
      }
    });

    this.bot.on('message', async (ctx) => {
      if (ctx.message.successful_payment) {
        try {
          const payload = ctx.message.successful_payment.invoice_payload;
          const paymentId = payload.split('_')[1];

          const payment = await this.prisma.$transaction(async (tx) => {
            const payment = await tx.payment.update({
              where: { id: paymentId },
              data: {
                status: PaymentStatus.COMPLETED,
                invoiceId:
                  ctx.message.successful_payment.telegram_payment_charge_id,
              },
              select: {
                userId: true,
                amount: true,
                user: {
                  select: {
                    languageCode: true,
                  },
                },
              },
            });
            await tx.user.update({
              where: { id: payment.userId },
              data: {
                balance: { increment: payment.amount },
              },
            });
            return payment;
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
                  paymentId: paymentId,
                  amount: reward.amount,
                  percentage: reward.percentage,
                  isFirstDeposit: reward.isFirstDeposit,
                },
              });
            });

            this.logger.log(
              `Referral reward (${reward.isFirstDeposit ? '10% first' : '3% subsequent'}): User ${reward.referrerId} earned ${reward.amount} XTR from ${payment.userId}'s Stars deposit`,
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
              await this.sendMessage(referrer.telegramId, notificationMessage);
            }
          }

          const languageCode = payment.user.languageCode;
          await ctx.reply(getMessage(languageCode, 'payment.success'));
        } catch (error) {
          const languageCode =
            ctx.from?.language_code === 'ru'
              ? LanguageCode.ru
              : LanguageCode.en;
          await ctx.reply(getMessage(languageCode, 'payment.failed'));
        }
      }

      if (ctx.message.text && ctx.message.text.startsWith('/')) {
        const languageCode =
          ctx.from?.language_code === 'ru' ? LanguageCode.ru : LanguageCode.en;
        await ctx.reply(getMessage(languageCode, 'bot.unknownCommand'));
      }
    });

    this.bot.on('pre_checkout_query', async (ctx) => {
      try {
        const payload = ctx.preCheckoutQuery.invoice_payload;
        const languageCode =
          ctx.from?.language_code === 'ru' ? LanguageCode.ru : LanguageCode.en;

        if (!payload.startsWith('payment_')) {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: getMessage(languageCode, 'payment.invalidRequest'),
          });
          return;
        }

        const paymentId = payload.split('_')[1];
        const payment = await this.prisma.payment.findUnique({
          where: { id: paymentId },
        });

        if (!payment) {
          await ctx.answerPreCheckoutQuery(false, {
            error_message: getMessage(languageCode, 'payment.notFound'),
          });
          return;
        }

        await ctx.answerPreCheckoutQuery(true);
      } catch (error) {
        this.logger.error('Failed to answer pre-checkout query: ', error);
        const languageCode =
          ctx.from?.language_code === 'ru' ? LanguageCode.ru : LanguageCode.en;
        await ctx.answerPreCheckoutQuery(false, {
          error_message: getMessage(languageCode, 'payment.processingError'),
        });
      }
    });
  }

  async onModuleInit() {
    try {
      await this.prisma.ensureConnected();

      // Hardcoded bot token
      this.token = '8556587427:AAFe7KM2FMk4fhTKtCtCzsVhpXMjqxfKeH8';

      // Use production WebApp URL
      this.webAppUrl = 'https://gifty-realm-production.up.railway.app';

      this.bot = new Bot(this.token);

      this.bot.catch((error) => {
        const ctx = error.ctx;
        const e = error.error as Error;
        this.logger.error(
          `Bot error in update ${ctx.update.update_id}: ${e.message}`,
          e.stack,
        );
      });

      this.setup();

      this.bot.start({
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
        onStart: () => {
          this.logger.log('Telegram bot launched');
        },
      });
    } catch (error) {
      this.logger.error('Failed to launch Telegram bot', error as Error);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.bot.stop();
    this.logger.log('Telegram bot stopped');
  }

  /**
   * Reload bot token and restart the bot
   * Should be called after updating TELEGRAM_BOT_TOKEN in the database
   */
  async reloadBotToken() {
    try {
      const tokenRecord = await this.prisma.system.findUnique({
        where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
        select: { value: true },
      });

      if (!tokenRecord) {
        throw new Error('Telegram bot token not found in the database');
      }

      const newToken = tokenRecord.value;

      // Only restart if token has changed
      if (newToken !== this.token) {
        this.logger.log('Bot token changed, restarting bot...');

        // Stop old bot
        if (this.bot) {
          await this.bot.stop();
        }

        // Update token and create new bot
        this.token = newToken;
        this.bot = new Bot(this.token);

        this.bot.catch((error) => {
          const ctx = error.ctx;
          const e = error.error as Error;
          this.logger.error(
            `Bot error in update ${ctx.update.update_id}: ${e.message}`,
            e.stack,
          );
        });

        this.setup();

        await this.bot.start({
          drop_pending_updates: true,
          allowed_updates: ['message', 'callback_query'],
          onStart: () => {
            this.logger.log('Telegram bot restarted with new token');
          },
        });
      }
    } catch (error) {
      this.logger.error('Failed to reload bot token', error as Error);
      throw error;
    }
  }

  /**
   * Reload WebApp URL from database
   * Should be called after updating WEBAPP_URL in the database
   */
  async reloadWebAppUrl() {
    try {
      const webAppUrlRecord = await this.prisma.system.findUnique({
        where: { key: SystemKey.WEBAPP_URL },
        select: { value: true },
      });

      if (webAppUrlRecord) {
        this.webAppUrl = webAppUrlRecord.value;
        this.logger.log(`WebApp URL reloaded: ${this.webAppUrl}`);
      }
    } catch (error) {
      this.logger.error('Failed to reload WebApp URL', error as Error);
      throw error;
    }
  }

  async createInvoice(data: CreateInvoiceDto) {
    try {
      const invoice = await this.bot.api.createInvoiceLink(
        data.title,
        data.description,
        data.payload,
        '',
        'XTR',
        data.prices,
      );
      return { invoice: invoice };
    } catch (error) {
      this.logger.error('Failed to create invoice link: ', error);
    }
  }

  /**
   * Send a message to a user by their telegramId
   * @param telegramId - Telegram user ID
   * @param message - Message text to send
   */
  async sendMessage(telegramId: string, message: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(telegramId, message, {
        parse_mode: 'Markdown',
      });
      this.logger.log(`Message sent to user ${telegramId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send message to user ${telegramId}: ${error}`,
      );
      // Don't throw - message sending shouldn't block the main flow
    }
  }
}
