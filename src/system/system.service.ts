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
}
