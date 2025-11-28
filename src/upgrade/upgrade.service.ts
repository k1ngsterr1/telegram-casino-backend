import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../shared/services/prisma.service';
import {
  UpgradeOptionsResponseDto,
  UpgradeOptionDto,
} from './dto/upgrade-options-response.dto';
import { UpgradeResultDto } from './dto/upgrade-result.dto';
import {
  UpgradeHistoryResponseDto,
  UpgradeHistoryItemDto,
} from './dto/upgrade-history-response.dto';
import { UpgradeStatsResponseDto } from './dto/upgrade-stats-response.dto';
import { UpgradeChancePublicDto } from './dto/upgrade-chance-public.dto';

@Injectable()
export class UpgradeService {
  private readonly logger = new Logger(UpgradeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all available upgrade chances (public endpoint for frontend)
   */
  async getUpgradeChances(): Promise<UpgradeChancePublicDto[]> {
    try {
      await this.prisma.ensureConnected();

      const upgradeChances = await this.prisma.upgradeChance.findMany({
        orderBy: {
          multiplier: 'asc',
        },
      });

      return upgradeChances.map((chance) => ({
        multiplier: Number(chance.multiplier),
        chance: Number(chance.chance),
        chancePercent: Math.round(Number(chance.chance) * 100),
      }));
    } catch (error) {
      this.logger.error('Failed to get upgrade chances', error);
      throw new HttpException('Failed to get upgrade chances', 500);
    }
  }

  /**
   * Get chance for specific multiplier (public endpoint)
   */
  async getUpgradeChanceByMultiplier(
    multiplier: number,
  ): Promise<UpgradeChancePublicDto> {
    try {
      await this.prisma.ensureConnected();

      const upgradeChance = await this.prisma.upgradeChance.findUnique({
        where: { multiplier },
      });

      if (!upgradeChance) {
        throw new HttpException('Multiplier not found', 404);
      }

      return {
        multiplier: Number(upgradeChance.multiplier),
        chance: Number(upgradeChance.chance),
        chancePercent: Math.round(Number(upgradeChance.chance) * 100),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get upgrade chance by multiplier', error);
      throw new HttpException(
        'Failed to get upgrade chance by multiplier',
        500,
      );
    }
  }

  /**
   * Get upgrade options for a specific inventory item
   * Shows all possible upgrade paths with different multipliers
   */
  async getUpgradeOptions(
    inventoryItemId: number,
    userId: string,
  ): Promise<UpgradeOptionsResponseDto> {
    try {
      await this.prisma.ensureConnected();

      // 1. Fetch inventory item with prize
      const inventoryItem = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        include: {
          prize: true,
        },
      });

      if (!inventoryItem) {
        throw new HttpException('Inventory item not found', 404);
      }

      // 2. Verify ownership
      if (inventoryItem.userId !== userId) {
        throw new HttpException('You do not own this item', 403);
      }

      const sourcePrize = inventoryItem.prize;

      // 3. Get all upgrade chances
      const upgradeChances = await this.prisma.upgradeChance.findMany({
        orderBy: {
          multiplier: 'asc',
        },
      });

      if (upgradeChances.length === 0) {
        throw new HttpException(
          'Upgrade system not configured. Please contact admin.',
          500,
        );
      }

      // 4. Calculate target prizes for each multiplier
      const options: UpgradeOptionDto[] = [];

      for (const upgradeChance of upgradeChances) {
        const multiplierValue = Number(upgradeChance.multiplier);
        const targetAmount = Math.floor(sourcePrize.amount * multiplierValue);

        // Пытаемся найти приз с нужной или большей суммой
        let targetPrize = await this.prisma.prize.findFirst({
          where: {
            amount: {
              gte: targetAmount,
            },
          },
          orderBy: {
            amount: 'asc',
          },
        });

        // Если не нашли подходящий приз, берем самый дорогой доступный
        if (!targetPrize) {
          targetPrize = await this.prisma.prize.findFirst({
            orderBy: {
              amount: 'desc',
            },
          });
        }

        if (targetPrize) {
          options.push({
            multiplier: multiplierValue,
            chance: Number(upgradeChance.chance),
            targetPrize: {
              id: targetPrize.id,
              name: targetPrize.name,
              amount: targetPrize.amount,
              url: targetPrize.url,
            },
          });
        }
      }

      if (options.length === 0) {
        throw new HttpException(
          'No upgrade paths available for this prize',
          400,
        );
      }

      return {
        sourcePrize: {
          id: sourcePrize.id,
          name: sourcePrize.name,
          amount: sourcePrize.amount,
          url: sourcePrize.url,
        },
        options,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get upgrade options', error);
      throw new HttpException('Failed to get upgrade options', 500);
    }
  }

  /**
   * Execute an upgrade attempt
   * - Validates inventory item ownership
   * - Gets upgrade chance from DB
   * - Calculates target prize
   * - Randomly determines success/failure
   * - Updates inventory (delete old, add new if success)
   * - Records upgrade attempt in history
   */
  async executeUpgrade(
    inventoryItemId: number,
    multiplier: number,
    userId: string,
  ): Promise<UpgradeResultDto> {
    try {
      await this.prisma.ensureConnected();

      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Fetch and validate inventory item
        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { id: inventoryItemId },
          include: {
            prize: true,
          },
        });

        if (!inventoryItem) {
          throw new HttpException('Inventory item not found', 404);
        }

        if (inventoryItem.userId !== userId) {
          throw new HttpException('You do not own this item', 403);
        }

        const sourcePrize = inventoryItem.prize;

        // 2. Get upgrade chance for the multiplier
        const upgradeChance = await tx.upgradeChance.findUnique({
          where: { multiplier },
        });

        if (!upgradeChance) {
          throw new HttpException('Upgrade multiplier not configured', 400);
        }

        const chance = Number(upgradeChance.chance);

        // 3. Calculate target prize
        const multiplierValue = Number(upgradeChance.multiplier);
        const targetAmount = Math.floor(sourcePrize.amount * multiplierValue);

        // Пытаемся найти приз с нужной или большей суммой
        let targetPrize = await tx.prize.findFirst({
          where: {
            amount: {
              gte: targetAmount,
            },
          },
          orderBy: {
            amount: 'asc',
          },
        });

        // Если не нашли подходящий приз, берем самый дорогой доступный
        if (!targetPrize) {
          targetPrize = await tx.prize.findFirst({
            orderBy: {
              amount: 'desc',
            },
          });

          // Если вообще нет призов в базе (критическая ошибка)
          if (!targetPrize) {
            throw new HttpException('No prizes available in the system', 500);
          }
        }

        // 4. Determine success/failure using random
        const random = Math.random();
        const success = random <= chance;

        // 5. Delete the source inventory item (always happens)
        await tx.inventoryItem.delete({
          where: { id: inventoryItemId },
        });

        let newInventoryItem = null;

        // 6. If successful, add new prize to inventory
        if (success) {
          newInventoryItem = await tx.inventoryItem.create({
            data: {
              userId,
              prizeId: targetPrize.id,
            },
          });
        }

        // 7. Record upgrade attempt in history
        await tx.upgrade.create({
          data: {
            userId,
            fromPrizeId: sourcePrize.id,
            toPrizeId: success ? targetPrize.id : null,
            multiplier,
            chance,
            success,
          },
        });

        return {
          success,
          chance,
          sourcePrize,
          targetPrize: success ? targetPrize : null,
          newInventoryItemId: newInventoryItem?.id,
        };
      });

      return {
        success: result.success,
        multiplier,
        chance: result.chance,
        fromPrize: {
          id: result.sourcePrize.id,
          name: result.sourcePrize.name,
          amount: result.sourcePrize.amount,
          url: result.sourcePrize.url,
        },
        toPrize: result.targetPrize
          ? {
              id: result.targetPrize.id,
              name: result.targetPrize.name,
              amount: result.targetPrize.amount,
              url: result.targetPrize.url,
            }
          : undefined,
        newInventoryItemId: result.newInventoryItemId,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to execute upgrade', error);
      throw new HttpException('Failed to execute upgrade', 500);
    }
  }

  /**
   * Get user's upgrade history with pagination
   */
  async getUpgradeHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<UpgradeHistoryResponseDto> {
    try {
      await this.prisma.ensureConnected();

      const skip = (page - 1) * limit;

      const [upgrades, total] = await Promise.all([
        this.prisma.upgrade.findMany({
          where: { userId },
          include: {
            fromPrize: true,
            toPrize: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip,
          take: limit,
        }),
        this.prisma.upgrade.count({
          where: { userId },
        }),
      ]);

      const upgradeItems: UpgradeHistoryItemDto[] = upgrades.map((upgrade) => ({
        id: upgrade.id,
        success: upgrade.success,
        multiplier: Number(upgrade.multiplier),
        chance: Number(upgrade.chance),
        fromPrize: {
          id: upgrade.fromPrize.id,
          name: upgrade.fromPrize.name,
          amount: upgrade.fromPrize.amount,
          url: upgrade.fromPrize.url,
        },
        toPrize: upgrade.toPrize
          ? {
              id: upgrade.toPrize.id,
              name: upgrade.toPrize.name,
              amount: upgrade.toPrize.amount,
              url: upgrade.toPrize.url,
            }
          : undefined,
        createdAt: upgrade.createdAt,
      }));

      return {
        upgrades: upgradeItems,
        total,
        page,
        limit,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get upgrade history', error);
      throw new HttpException('Failed to get upgrade history', 500);
    }
  }

  /**
   * Get comprehensive upgrade statistics for a user
   */
  async getUpgradeStats(userId: string): Promise<UpgradeStatsResponseDto> {
    try {
      await this.prisma.ensureConnected();

      const allUpgrades = await this.prisma.upgrade.findMany({
        where: { userId },
        include: {
          fromPrize: true,
          toPrize: true,
        },
      });

      const totalAttempts = allUpgrades.length;
      const successfulUpgrades = allUpgrades.filter((u) => u.success).length;
      const failedUpgrades = totalAttempts - successfulUpgrades;
      const successRate =
        totalAttempts > 0
          ? Math.round((successfulUpgrades / totalAttempts) * 100 * 100) / 100
          : 0;

      // Calculate value lost and gained
      let totalValueLost = 0;
      let totalValueGained = 0;

      for (const upgrade of allUpgrades) {
        const fromValue = upgrade.fromPrize.amount;
        if (upgrade.success && upgrade.toPrize) {
          const toValue = upgrade.toPrize.amount;
          totalValueGained += toValue - fromValue;
        } else {
          totalValueLost += fromValue;
        }
      }

      const netProfit = totalValueGained - totalValueLost;

      // Statistics by multiplier
      const byMultiplier: Record<
        string,
        {
          attempts: number;
          successes: number;
          successRate: number;
        }
      > = {};

      // Get all unique multipliers from upgrades
      const uniqueMultipliers = [
        ...new Set(allUpgrades.map((u) => Number(u.multiplier))),
      ].sort((a, b) => a - b);

      for (const mult of uniqueMultipliers) {
        const upgradesForMult = allUpgrades.filter(
          (u) => Number(u.multiplier) === mult,
        );
        const attempts = upgradesForMult.length;
        const successes = upgradesForMult.filter((u) => u.success).length;
        const rate =
          attempts > 0
            ? Math.round((successes / attempts) * 100 * 100) / 100
            : 0;

        byMultiplier[`X${mult}`] = {
          attempts,
          successes,
          successRate: rate,
        };
      }

      return {
        totalAttempts,
        successfulUpgrades,
        failedUpgrades,
        successRate,
        totalValueLost,
        totalValueGained,
        netProfit,
        byMultiplier,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get upgrade stats', error);
      throw new HttpException('Failed to get upgrade stats', 500);
    }
  }
}
