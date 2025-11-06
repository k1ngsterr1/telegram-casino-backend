import { HttpException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/shared/services/prisma.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { validateTelegramWebAppData } from './utils/telegram.utils';
import { BotService } from 'src/shared/services/bot.service';

@Injectable()
export class UserService {
  private logger = new Logger(UserService.name);
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private botService: BotService,
  ) {}
  async generateToken(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          isBanned: true,
        },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const payload = {
        id: user.id,
        isBanned: user.isBanned,
      };

      return this.jwtService.sign(payload);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to generate token: ', error);
      throw new HttpException('Failed to generate token', 500);
    }
  }

  async getProfile(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          telegramId: true,
          role: true,
          isBanned: true,
          balance: true,
        },
      });

      return user;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get user profile: ', error);
      throw new HttpException('Failed to get user profile', 500);
    }
  }

  async telegram(data: TelegramAuthDto): Promise<{ accessToken: string }> {
    try {
      const parsedData = validateTelegramWebAppData(
        data.initData,
        this.botService.getBotToken(),
      );

      if (!parsedData.user || !parsedData.user.id) {
        throw new HttpException('Invalid user data', 400);
      }

      const telegramId = String(parsedData.user.id);

      const user = await this.prisma.user.upsert({
        where: { telegramId },
        update: {},
        create: {
          telegramId,
          username: parsedData.user.username || 'Unknown',
          languageCode: parsedData.user.language_code === 'ru' ? 'ru' : 'en',
        },
        select: {
          id: true,
          telegramId: true,
          role: true,
          isBanned: true,
        },
      });

      if (user.isBanned) {
        throw new HttpException('User is banned', 403);
      }

      const payload = {
        id: user.id,
        isBanned: user.isBanned,
      };

      const accessToken = this.jwtService.sign(payload);

      return { accessToken: accessToken };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to authenticate with Telegram: ', error);

      throw new HttpException('Failed to authenticate', 500);
    }
  }
}
