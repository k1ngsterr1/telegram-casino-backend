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

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  public getBotToken(): string {
    return this.token;
  }

  private setup() {
    this.bot.command('start', async (ctx) => {
      const url = this.configService.getOrThrow('WEBAPP_URL');

      const keyboard = new InlineKeyboard().webApp('🎮 Casino Bot', url);

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

      const token = await this.prisma.system.findUnique({
        where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
        select: { value: true },
      });
      if (!token) {
        throw new Error('Telegram bot token not found in the database');
      }

      this.token = token.value;
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
}
