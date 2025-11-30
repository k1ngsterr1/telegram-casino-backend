import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../shared/services/prisma.service';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get leaderboard by volume
   */
  async getLeaderboardByVolume(
    limit: number = 100,
  ): Promise<LeaderboardResponseDto> {
    try {
      await this.prisma.ensureConnected();

      const users = await this.prisma.user.findMany({
        where: {
          isBanned: false,
        },
        select: {
          id: true,
          username: true,
          photoUrl: true,
          totalVolume: true,
          totalSpins: true,
        },
        orderBy: {
          totalVolume: 'desc',
        },
        take: limit,
      });

      return {
        leaderboard: users.map((user, index) => ({
          position: index + 1,
          userId: user.id,
          username: user.username,
          photoUrl: user.photoUrl,
          totalSpins: user.totalSpins,
          totalVolume: Number(user.totalVolume),
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get leaderboard by volume', error);
      throw error;
    }
  }

  /**
   * Get leaderboard by spins
   */
  async getLeaderboardBySpins(
    limit: number = 100,
  ): Promise<LeaderboardResponseDto> {
    try {
      await this.prisma.ensureConnected();

      const users = await this.prisma.user.findMany({
        where: {
          isBanned: false,
        },
        select: {
          id: true,
          username: true,
          photoUrl: true,
          totalVolume: true,
          totalSpins: true,
        },
        orderBy: {
          totalSpins: 'desc',
        },
        take: limit,
      });

      return {
        leaderboard: users.map((user, index) => ({
          position: index + 1,
          userId: user.id,
          username: user.username,
          photoUrl: user.photoUrl,
          totalSpins: user.totalSpins,
          totalVolume: Number(user.totalVolume),
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get leaderboard by spins', error);
      throw error;
    }
  }

  /**
   * Get user position in leaderboard
   */
  async getUserPosition(userId: string): Promise<{
    volumePosition: number;
    spinsPosition: number;
    totalSpins: number;
    totalVolume: number;
  }> {
    try {
      await this.prisma.ensureConnected();

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          totalVolume: true,
          totalSpins: true,
        },
      });

      if (!user) {
        return {
          volumePosition: 0,
          spinsPosition: 0,
          totalSpins: 0,
          totalVolume: 0,
        };
      }

      // Get volume position
      const volumePosition = await this.prisma.user.count({
        where: {
          isBanned: false,
          totalVolume: {
            gt: user.totalVolume,
          },
        },
      });

      // Get spins position
      const spinsPosition = await this.prisma.user.count({
        where: {
          isBanned: false,
          totalSpins: {
            gt: user.totalSpins,
          },
        },
      });

      return {
        volumePosition: volumePosition + 1,
        spinsPosition: spinsPosition + 1,
        totalSpins: user.totalSpins,
        totalVolume: Number(user.totalVolume),
      };
    } catch (error) {
      this.logger.error('Failed to get user position', error);
      throw error;
    }
  }

  /**
   * Increment user spins (called when opening a case)
   */
  async incrementUserSpins(userId: string, casePrice: number): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          totalSpins: { increment: 1 },
          totalVolume: { increment: casePrice },
        },
      });
    } catch (error) {
      this.logger.error('Failed to increment user spins', error);
    }
  }
}
