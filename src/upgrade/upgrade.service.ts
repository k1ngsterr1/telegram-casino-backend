import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../shared/services/prisma.service';
import { UpgradeMultiplier } from './dto/execute-upgrade.dto';
import {
  UpgradeOptionsResponseDto,
  UpgradeOptionDto,
} from './dto/upgrade-options-response.dto';
import { UpgradeResultDto } from './dto/upgrade-result.dto';

@Injectable()
export class UpgradeService {
  private readonly logger = new Logger(UpgradeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convert multiplier enum to numeric value
   */
  private getMultiplierValue(multiplier: UpgradeMultiplier): number {
    const multiplierMap = {
      [UpgradeMultiplier.X1_5]: 1.5,
      [UpgradeMultiplier.X2]: 2,
      [UpgradeMultiplier.X3]: 3,
      [UpgradeMultiplier.X5]: 5,
      [UpgradeMultiplier.X10]: 10,
    };
    return multiplierMap[multiplier];
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
        const multiplierValue = this.getMultiplierValue(
          upgradeChance.multiplier as UpgradeMultiplier,
        );
        const targetAmount = Math.floor(sourcePrize.amount * multiplierValue);

        // Find the closest prize with amount >= targetAmount
        const targetPrize = await this.prisma.prize.findFirst({
          where: {
            amount: {
              gte: targetAmount,
            },
          },
          orderBy: {
            amount: 'asc',
          },
        });

        if (targetPrize) {
          options.push({
            multiplier: upgradeChance.multiplier as UpgradeMultiplier,
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
    multiplier: UpgradeMultiplier,
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
          throw new HttpException(
            'Upgrade multiplier not configured',
            400,
          );
        }

        const chance = Number(upgradeChance.chance);

        // 3. Calculate target prize
        const multiplierValue = this.getMultiplierValue(multiplier);
        const targetAmount = Math.floor(sourcePrize.amount * multiplierValue);

        const targetPrize = await tx.prize.findFirst({
          where: {
            amount: {
              gte: targetAmount,
            },
          },
          orderBy: {
            amount: 'asc',
          },
        });

        if (!targetPrize) {
          throw new HttpException(
            'No suitable target prize found for this upgrade',
            400,
          );
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
}
