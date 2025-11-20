import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate and update user ratings based on balance
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async updateUserRatings() {
    try {
      this.logger.log('Starting user rating calculation...');

      // Get all users ordered by balance (descending) and createdAt (for tie-breaking)
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          balance: true,
        },
        orderBy: [
          { balance: 'desc' },
          { createdAt: 'asc' }, // Users who registered earlier get better rank in case of tie
        ],
      });

      // Batch update ratings
      const updatePromises = users.map((user, index) => {
        const rating = index + 1; // Rank starts from 1
        return this.prisma.user.update({
          where: { id: user.id },
          data: { rating },
        });
      });

      await Promise.all(updatePromises);

      this.logger.log(`Successfully updated ratings for ${users.length} users`);
    } catch (error) {
      this.logger.error('Failed to update user ratings', error);
    }
  }
}
