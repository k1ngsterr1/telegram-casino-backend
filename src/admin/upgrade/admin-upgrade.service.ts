import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { UpgradeMultiplier } from '../../upgrade/dto/execute-upgrade.dto';
import { UpdateUpgradeChanceDto } from './dto/update-upgrade-chance.dto';
import { UpgradeChanceResponseDto } from './dto/upgrade-chance-response.dto';

@Injectable()
export class AdminUpgradeService {
  private readonly logger = new Logger(AdminUpgradeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all upgrade chances
   */
  async getAllUpgradeChances(): Promise<UpgradeChanceResponseDto[]> {
    try {
      await this.prisma.ensureConnected();

      const chances = await this.prisma.upgradeChance.findMany({
        orderBy: {
          multiplier: 'asc',
        },
      });

      return chances.map((chance) => ({
        id: chance.id,
        multiplier: chance.multiplier as UpgradeMultiplier,
        chance: chance.chance.toString(),
        createdAt: chance.createdAt,
        updatedAt: chance.updatedAt,
      }));
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get upgrade chances', error);
      throw new HttpException('Failed to get upgrade chances', 500);
    }
  }

  /**
   * Update upgrade chance for a specific multiplier
   */
  async updateUpgradeChance(
    dto: UpdateUpgradeChanceDto,
  ): Promise<UpgradeChanceResponseDto> {
    try {
      await this.prisma.ensureConnected();

      // Upsert the upgrade chance
      const upgradeChance = await this.prisma.upgradeChance.upsert({
        where: {
          multiplier: dto.multiplier,
        },
        update: {
          chance: dto.chance,
        },
        create: {
          multiplier: dto.multiplier,
          chance: dto.chance,
        },
      });

      return {
        id: upgradeChance.id,
        multiplier: upgradeChance.multiplier as UpgradeMultiplier,
        chance: upgradeChance.chance.toString(),
        createdAt: upgradeChance.createdAt,
        updatedAt: upgradeChance.updatedAt,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update upgrade chance', error);
      throw new HttpException('Failed to update upgrade chance', 500);
    }
  }

  /**
   * Initialize default upgrade chances if they don't exist
   */
  async initializeDefaultChances(): Promise<void> {
    try {
      await this.prisma.ensureConnected();

      const defaultChances = [
        { multiplier: UpgradeMultiplier.X1_5, chance: 0.7 },
        { multiplier: UpgradeMultiplier.X2, chance: 0.5 },
        { multiplier: UpgradeMultiplier.X3, chance: 0.33 },
        { multiplier: UpgradeMultiplier.X5, chance: 0.2 },
        { multiplier: UpgradeMultiplier.X10, chance: 0.1 },
      ];

      for (const defaultChance of defaultChances) {
        await this.prisma.upgradeChance.upsert({
          where: {
            multiplier: defaultChance.multiplier,
          },
          update: {},
          create: {
            multiplier: defaultChance.multiplier,
            chance: defaultChance.chance,
          },
        });
      }

      this.logger.log('Default upgrade chances initialized');
    } catch (error) {
      this.logger.error('Failed to initialize default upgrade chances', error);
      throw new HttpException(
        'Failed to initialize default upgrade chances',
        500,
      );
    }
  }
}
