import { HttpException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/shared/services/prisma.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { validateTelegramWebAppData } from './utils/telegram.utils';
import { BotService } from 'src/shared/services/bot.service';
import {
  ReferralLinkDto,
  ReferralStatsDto,
  ReferralEarningDto,
} from './dto/referral-response.dto';

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
          role: true,
        },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const payload = {
        id: user.id,
        isBanned: user.isBanned,
        role: user.role,
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
          rating: true,
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

      // Extract referral code from start_param (format: ref_USERID)
      let referrerId: string | null = null;
      if (parsedData.start_param) {
        const parts = parsedData.start_param.trim().split('_');
        if (parts[0] === 'ref' && parts[1]) {
          referrerId = parts[1];
          this.logger.log(
            `User ${telegramId} authenticated with referral code from ${referrerId}`,
          );
        }
      }

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { telegramId },
        select: { id: true, referredBy: true },
      });

      // Only set referrer if:
      // 1. User is new OR user exists but has no referrer
      // 2. Referrer ID was provided
      // 3. User is not trying to refer themselves
      let shouldSetReferrer = false;
      if (referrerId) {
        if (!existingUser) {
          // New user - check referrer exists and is not the same user
          const referrer = await this.prisma.user.findUnique({
            where: { id: referrerId },
            select: { id: true, telegramId: true },
          });

          if (referrer && referrer.telegramId !== telegramId) {
            shouldSetReferrer = true;
          }
        } else if (!existingUser.referredBy) {
          // Existing user without referrer - check referrer exists and is not the same user
          const referrer = await this.prisma.user.findUnique({
            where: { id: referrerId },
            select: { id: true, telegramId: true },
          });

          if (referrer && referrer.telegramId !== telegramId) {
            shouldSetReferrer = true;
          }
        }
      }

      const user = await this.prisma.user.upsert({
        where: { telegramId },
        update: {
          ...(shouldSetReferrer && { referredBy: referrerId }),
        },
        create: {
          telegramId,
          username: parsedData.user.username || 'Unknown',
          languageCode: parsedData.user.language_code === 'ru' ? 'ru' : 'en',
          ...(shouldSetReferrer && { referredBy: referrerId }),
        },
        select: {
          id: true,
          telegramId: true,
          role: true,
          isBanned: true,
        },
      });

      if (shouldSetReferrer) {
        this.logger.log(
          `Successfully set referrer ${referrerId} for user ${telegramId}`,
        );
      }

      if (user.isBanned) {
        throw new HttpException('User is banned', 403);
      }

      const payload = {
        id: user.id,
        isBanned: user.isBanned,
        role: user.role,
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

  /**
   * Get referral link for user
   */
  async getReferralLink(userId: string): Promise<ReferralLinkDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Get bot info to construct the referral link
      const botInfo = await this.botService['bot'].api.getMe();
      const botUsername = botInfo.username;

      const referralCode = `ref_${userId}`;
      const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;

      return {
        referralLink,
        referralCode,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get referral link: ', error);
      throw new HttpException('Failed to get referral link', 500);
    }
  }

  /**
   * Get referral statistics for user
   */
  async getReferralStats(userId: string): Promise<ReferralStatsDto> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Get all referred users
      const referredUsers = await this.prisma.user.findMany({
        where: { referredBy: userId },
        select: { id: true },
      });

      const totalReferrals = referredUsers.length;

      // Get all earnings
      const earnings = await this.prisma.referralEarning.findMany({
        where: { referrerId: userId },
        select: {
          amount: true,
          isFirstDeposit: true,
        },
      });

      const totalEarnings = earnings.reduce(
        (sum, e) => sum + e.amount.toNumber(),
        0,
      );
      const firstDepositEarnings = earnings
        .filter((e) => e.isFirstDeposit)
        .reduce((sum, e) => sum + e.amount.toNumber(), 0);
      const subsequentDepositEarnings = earnings
        .filter((e) => !e.isFirstDeposit)
        .reduce((sum, e) => sum + e.amount.toNumber(), 0);

      // Get number of referrals who made at least one deposit
      const activeReferralsCount = await this.prisma.referralEarning.groupBy({
        by: ['referredUserId'],
        where: { referrerId: userId },
        _count: true,
      });

      return {
        totalReferrals,
        totalEarnings,
        firstDepositEarnings,
        subsequentDepositEarnings,
        activeReferrals: activeReferralsCount.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get referral stats: ', error);
      throw new HttpException('Failed to get referral stats', 500);
    }
  }

  /**
   * Get referral earnings history
   */
  async getReferralEarnings(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: ReferralEarningDto[]; total: number }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const skip = (page - 1) * limit;

      const [earnings, total] = await Promise.all([
        this.prisma.referralEarning.findMany({
          where: { referrerId: userId },
          select: {
            id: true,
            referredUserId: true,
            amount: true,
            percentage: true,
            isFirstDeposit: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.referralEarning.count({
          where: { referrerId: userId },
        }),
      ]);

      const data = earnings.map((e) => ({
        id: e.id,
        referredUserId: e.referredUserId,
        amount: e.amount.toNumber(),
        percentage: e.percentage.toNumber(),
        isFirstDeposit: e.isFirstDeposit,
        createdAt: e.createdAt,
      }));

      return { data, total };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get referral earnings: ', error);
      throw new HttpException('Failed to get referral earnings', 500);
    }
  }

  /**
   * Get user inventory with prizes
   */
  async getUserInventory(
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    data: Array<{
      id: number;
      prize: {
        id: number;
        name: string;
        amount: number;
        url: string;
      };
      case: {
        id: number;
        name: string;
      } | null;
      createdAt: Date;
    }>;
    total: number;
  }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        this.prisma.inventoryItem.findMany({
          where: { userId },
          include: {
            prize: {
              select: {
                id: true,
                name: true,
                amount: true,
                url: true,
              },
            },
            case: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.inventoryItem.count({
          where: { userId },
        }),
      ]);

      return {
        data: items.map((item) => ({
          id: item.id,
          prize: item.prize,
          case: item.case,
          createdAt: item.createdAt,
        })),
        total,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to get user inventory: ', error);
      throw new HttpException('Failed to get user inventory', 500);
    }
  }

  /**
   * Sell inventory item - user gets prize amount added to balance
   */
  async sellInventoryItem(
    userId: string,
    inventoryItemId: number,
  ): Promise<{ balance: number; amount: number }> {
    try {
      // Check if user exists
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, balance: true },
      });

      if (!user) {
        throw new HttpException('User not found', 404);
      }

      // Find inventory item and verify it belongs to the user
      const inventoryItem = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        include: {
          prize: {
            select: {
              amount: true,
              name: true,
            },
          },
        },
      });

      if (!inventoryItem) {
        throw new HttpException('Inventory item not found', 404);
      }

      if (inventoryItem.userId !== userId) {
        throw new HttpException('You do not own this inventory item', 403);
      }

      const sellAmount = inventoryItem.prize.amount;

      // Delete inventory item and update user balance in a transaction
      const updatedUser = await this.prisma.$transaction(async (tx) => {
        // Delete the inventory item
        await tx.inventoryItem.delete({
          where: { id: inventoryItemId },
        });

        // Update user balance
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            balance: {
              increment: sellAmount,
            },
          },
          select: {
            balance: true,
          },
        });

        return updated;
      });

      this.logger.log(
        `User ${userId} sold inventory item ${inventoryItemId} (${inventoryItem.prize.name}) for ${sellAmount} stars. New balance: ${updatedUser.balance}`,
      );

      return {
        balance: updatedUser.balance.toNumber(),
        amount: sellAmount,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to sell inventory item: ', error);
      throw new HttpException('Failed to sell inventory item', 500);
    }
  }
}
