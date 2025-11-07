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
import { SystemKey } from '@prisma/client';

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
      const keyboard = new InlineKeyboard().webApp(
        '🎮 Casino Bot',
        this.webAppUrl,
      );

      const telegramId = ctx.from.id;
      const username = ctx.from.username || 'Unknown';
      const languageCode = ctx.from.language_code === 'ru' ? 'ru' : 'en';

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
        ctx.reply('Welcome to Casino Bot!', {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        }),
      ]);
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
}
