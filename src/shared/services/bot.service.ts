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

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private bot: Bot;
  private token: string;
  private webAppUrl: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
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
      const languageCode =
        ctx.from.language_code === 'ru' ? LanguageCode.ru : LanguageCode.en;

      const keyboard = new InlineKeyboard().webApp(
        getMessage(languageCode, 'bot.buttonText'),
        this.webAppUrl,
      );

      await Promise.all([
        this.prisma.user.upsert({
          where: { telegramId: telegramId.toString() },
          update: { username: username, languageCode: languageCode },
          create: {
            telegramId: telegramId.toString(),
            username: username,
            languageCode: languageCode,
          },
        }),
        ctx.reply(getMessage(languageCode, 'bot.welcome'), {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        }),
      ]);
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

      // Load bot token from database
      const tokenRecord = await this.prisma.system.findUnique({
        where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
        select: { value: true },
      });
      if (!tokenRecord) {
        throw new Error('Telegram bot token not found in the database');
      }

      // Load WebApp URL from database or fallback to env
      const webAppUrlRecord = await this.prisma.system.findUnique({
        where: { key: SystemKey.WEBAPP_URL },
        select: { value: true },
      });
      this.webAppUrl =
        webAppUrlRecord?.value || this.configService.getOrThrow('WEBAPP_URL');

      this.token = tokenRecord.value;
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
}
