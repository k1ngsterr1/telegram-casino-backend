import { PrismaService } from 'src/shared/services/prisma.service';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Currency, Payment, PaymentStatus } from '@prisma/client';
import { BotService } from 'src/shared/services/bot.service';
import { CreateStarsPaymentDto } from './dto/create-stars-payment.dto';
import { getMessage } from 'src/shared/consts/messages.consts';

@Injectable()
export class PaymentService {
  private logger = new Logger(PaymentService.name);

  constructor(
    private prisma: PrismaService,
    private bot: BotService,
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

      return await this.bot.createInvoice({
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
    } catch (error) {
      if (payment) {
        await this.prisma.payment.delete({ where: { id: payment.id } });
      }
      if (error instanceof HttpException) throw error;
      throw new HttpException('Failed to create payment', 500);
    }
  }
}
