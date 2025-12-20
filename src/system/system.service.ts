import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../shared/services/prisma.service';
import { BotService } from '../shared/services/bot.service';
import { UpdateBotTokenDto } from './dto/update-bot-token.dto';
import { UpdateDepositSettingsDto } from './dto/update-deposit-settings.dto';
import { SystemKey } from '@prisma/client';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: BotService,
  ) {}

  /**
   * Get all system variables
   */
  async findAll() {
    try {
      const systemVariables = await this.prisma.system.findMany({
        orderBy: { key: 'asc' },
      });

      return systemVariables.map((variable) => ({
        key: variable.key,
        value:
          variable.key === SystemKey.AVIATOR ||
          variable.key === SystemKey.DEPOSIT
            ? JSON.parse(variable.value)
            : variable.value,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch system variables', error);
      throw new HttpException('Failed to fetch system variables', 500);
    }
  }

  /**
   * Get a specific system variable by key
   */
  async findOne(key: SystemKey) {
    try {
      const variable = await this.prisma.system.findUnique({
        where: { key },
      });

      if (!variable) {
        throw new HttpException(`System variable '${key}' not found`, 404);
      }

      return {
        key: variable.key,
        value:
          variable.key === SystemKey.AVIATOR ||
          variable.key === SystemKey.DEPOSIT
            ? JSON.parse(variable.value)
            : variable.value,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to fetch system variable '${key}'`, error);
      throw new HttpException('Failed to fetch system variable', 500);
    }
  }

  /**
   * Update Telegram bot token
   */
  async updateBotToken(dto: UpdateBotTokenDto) {
    try {
      const updated = await this.prisma.system.upsert({
        where: { key: SystemKey.TELEGRAM_BOT_TOKEN },
        update: { value: dto.token },
        create: {
          key: SystemKey.TELEGRAM_BOT_TOKEN,
          value: dto.token,
        },
      });

      // Reload bot with new token
      await this.botService.reloadBotToken();

      return {
        key: updated.key,
        value: updated.value,
      };
    } catch (error) {
      this.logger.error('Failed to update bot token', error);
      throw new HttpException('Failed to update bot token', 500);
    }
  }

  /**
   * Update WebApp URL
   */
  async updateWebAppUrl(url: string) {
    try {
      const updated = await this.prisma.system.upsert({
        where: { key: SystemKey.WEBAPP_URL },
        update: { value: url },
        create: {
          key: SystemKey.WEBAPP_URL,
          value: url,
        },
      });

      // Reload WebApp URL in bot service
      await this.botService.reloadWebAppUrl();

      return {
        key: updated.key,
        value: updated.value,
      };
    } catch (error) {
      this.logger.error('Failed to update WebApp URL', error);
      throw new HttpException('Failed to update WebApp URL', 500);
    }
  }

  /**
   * Update deposit settings (min deposit, max withdrawal, commission)
   */
  async updateDepositSettings(dto: UpdateDepositSettingsDto) {
    try {
      const depositSettings = {
        minDeposit: dto.minDeposit,
        maxWithdrawal: dto.maxWithdrawal,
        withdrawalCommission: dto.withdrawalCommission,
      };

      const updated = await this.prisma.system.upsert({
        where: { key: SystemKey.DEPOSIT },
        update: { value: JSON.stringify(depositSettings) },
        create: {
          key: SystemKey.DEPOSIT,
          value: JSON.stringify(depositSettings),
        },
      });

      return {
        key: updated.key,
        value: JSON.parse(updated.value),
      };
    } catch (error) {
      this.logger.error('Failed to update deposit settings', error);
      throw new HttpException('Failed to update deposit settings', 500);
    }
  }

  /**
   * Get current free case subscription requirements
   */
  async getSubscriptionRequirements() {
    try {
      const config = await this.prisma.system.findUnique({
        where: { key: SystemKey.FREE_CASE_SUBSCRIPTIONS },
        select: { value: true },
      });

      if (!config || !config.value) {
        return { subscriptions: [] };
      }

      const subscriptions = JSON.parse(config.value);

      // Enrich with chat info from Telegram
      const enrichedSubscriptions = await Promise.all(
        subscriptions.map(async (sub: any) => {
          const chatInfo = await this.botService.getChatInfo(sub.chatId);
          return {
            ...sub,
            chatInfo,
          };
        }),
      );

      return { subscriptions: enrichedSubscriptions };
    } catch (error) {
      this.logger.error('Failed to get subscription requirements', error);
      throw new HttpException('Failed to get subscription requirements', 500);
    }
  }

  /**
   * Update free case subscription requirements
   */
  async updateSubscriptionRequirements(
    subscriptions: Array<{
      chatId: string;
      title: string;
      inviteLink?: string;
    }>,
  ) {
    try {
      // Validate that bot can access all chats
      const validationResults = await Promise.all(
        subscriptions.map(async (sub) => {
          const chatInfo = await this.botService.getChatInfo(sub.chatId);
          return {
            chatId: sub.chatId,
            isValid: chatInfo !== null,
            chatInfo,
          };
        }),
      );

      const invalidChats = validationResults.filter((r) => !r.isValid);
      if (invalidChats.length > 0) {
        const invalidIds = invalidChats.map((r) => r.chatId).join(', ');
        throw new HttpException(
          `Bot cannot access the following chats: ${invalidIds}. Make sure the bot is added as an admin to these chats/channels.`,
          400,
        );
      }

      const updated = await this.prisma.system.upsert({
        where: { key: SystemKey.FREE_CASE_SUBSCRIPTIONS },
        update: { value: JSON.stringify(subscriptions) },
        create: {
          key: SystemKey.FREE_CASE_SUBSCRIPTIONS,
          value: JSON.stringify(subscriptions),
        },
      });

      return {
        key: updated.key,
        subscriptions: JSON.parse(updated.value),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update subscription requirements', error);
      throw new HttpException('Failed to update subscription requirements', 500);
    }
  }

  /**
   * Verify a single chat/channel is accessible by the bot
   */
  async verifyChatAccess(chatId: string) {
    try {
      const chatInfo = await this.botService.getChatInfo(chatId);

      if (!chatInfo) {
        return {
          isAccessible: false,
          message:
            'Bot cannot access this chat. Make sure the bot is added as an admin to the chat/channel.',
        };
      }

      return {
        isAccessible: true,
        chatInfo,
      };
    } catch (error) {
      this.logger.error(`Failed to verify chat access for ${chatId}`, error);
      throw new HttpException('Failed to verify chat access', 500);
    }
  }
}
