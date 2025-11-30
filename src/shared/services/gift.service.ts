import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface GiftProcessResult {
  success: boolean;
  giftId?: number;
  message: string;
}

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process and save a gift message (MessageActionStarGift or MessageActionStarGiftUnique)
   */
  async processGiftMessage(
    message: any,
    receiverTelegramId: string,
    telegramClient?: any,
  ): Promise<GiftProcessResult> {
    try {
      const action = message.action;
      if (!action || !action.className?.includes('StarGift')) {
        return { success: false, message: 'Not a star gift message' };
      }

      // Extract sender info correctly
      const fromUserId = action.fromId?.userId?.toString() || null;
      const fromUsername = action.fromId?.username || null;
      const isAnonymous = message.fromId === null && action.fromId?.userId;

      // Create unique message ID for gift tracking
      const senderForId = fromUserId || message.peerId?.userId || 'unknown';
      const telegramMessageId = `gift_${senderForId}_${message.id}_${receiverTelegramId}`;

      this.logger.log(
        `Gift sender info: message.fromId=${message.fromId?.userId}, action.fromId=${fromUserId}, isAnonymous=${isAnonymous}, telegramMessageId=${telegramMessageId}`,
      );

      // Check if already processed
      const existing = await this.prisma.telegramGift.findFirst({
        where: {
          telegramUserId: receiverTelegramId,
          telegramMessageId,
        },
      });

      if (existing) {
        return { success: false, message: 'Gift already processed' };
      }

      // Find or create user
      let user: any = null;
      try {
        user = await this.prisma.user.findUnique({
          where: { telegramId: receiverTelegramId },
        });
      } catch (e) {
        this.logger.warn(`User lookup failed for ${receiverTelegramId}`);
      }

      // If user doesn't exist in our system, we cannot save the gift
      if (!user) {
        this.logger.warn(
          `User ${receiverTelegramId} not found in database, skipping gift`,
        );
        return {
          success: false,
          message: 'User not registered in casino',
        };
      }

      // Parse gift details
      const giftType = action.className;
      const isUniqueGift = giftType === 'MessageActionStarGiftUnique';

      let giftData: any = {
        userId: user.id,
        telegramUserId: receiverTelegramId,
        giftType: isUniqueGift ? 'STAR_GIFT_UNIQUE' : 'STAR_GIFT',
        isUnique: isUniqueGift,
        telegramMessageId,
        senderTelegramId: fromUserId,
        senderName: fromUsername,
        isAnonymous,
        receivedAt: message.date ? new Date(message.date * 1000) : new Date(),
        rawMessage: message,
      };

      if (isUniqueGift) {
        // Parse NFT gift details
        const gift = action.gift || {};
        giftData = {
          ...giftData,
          nftTitle: gift.title || gift.name,
          nftNumber: gift.num ? `#${gift.num}` : null,
          nftTotalCount: gift.totalCount?.toString() || null,
          nftAttributes: gift.attributes || null,
        };

        this.logger.log(
          `Processing NFT gift: ${gift.title || 'Unknown'} #${gift.num} for user ${receiverTelegramId}`,
        );
      } else {
        // Regular star gift
        const starsValue = action.stars || 0;
        giftData.starsValue = starsValue;

        this.logger.log(
          `Processing star gift: ${starsValue} stars for user ${receiverTelegramId}`,
        );
      }

      // Create a prize for this gift
      const prize = await this.prisma.prize.create({
        data: {
          name:
            giftData.nftTitle ||
            `Telegram Gift (${isUniqueGift ? 'NFT' : `${giftData.starsValue || 0} stars`})`,
          amount: giftData.starsValue || 0,
          url: '',
        },
      });

      // Create inventory item for the user
      const inventoryItem = await this.prisma.inventoryItem.create({
        data: {
          userId: user.id,
          prizeId: prize.id,
        },
      });

      // Save gift record with reference to inventory item
      giftData.status = 'CONVERTED';
      giftData.convertedAt = new Date();
      giftData.convertedValue = prize.amount;
      giftData.inventoryItemId = inventoryItem.id;

      const savedGift = await this.prisma.telegramGift.create({
        data: giftData,
      });

      this.logger.log(
        `✅ Saved ${isUniqueGift ? 'NFT' : 'star'} gift ${savedGift.id} as inventory item ${inventoryItem.id} for user ${receiverTelegramId}`,
      );

      return {
        success: true,
        giftId: savedGift.id,
        message: `Saved ${isUniqueGift ? 'NFT' : 'star'} gift as inventory item for user ${receiverTelegramId}`,
      };
    } catch (error) {
      this.logger.error('Failed to process gift message:', error);
      return {
        success: false,
        message: `Error: ${error.message}`,
      };
    }
  }

  /**
   * Get all gifts for a user
   */
  async getUserGifts(telegramId: string, limit = 50, offset = 0) {
    try {
      const gifts = await this.prisma.telegramGift.findMany({
        where: { telegramUserId: telegramId },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, username: true, telegramId: true },
          },
        },
      });

      const totalCount = await this.prisma.telegramGift.count({
        where: { telegramUserId: telegramId },
      });

      return {
        gifts,
        totalCount,
        hasMore: totalCount > offset + limit,
      };
    } catch (error) {
      this.logger.error(`Failed to get gifts for user ${telegramId}:`, error);
      return { gifts: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Get all NFT gifts (unique gifts only)
   */
  async getAllNFTGifts(limit = 100, offset = 0) {
    try {
      const gifts = await this.prisma.telegramGift.findMany({
        where: { giftType: 'STAR_GIFT_UNIQUE' },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, username: true, telegramId: true },
          },
        },
      });

      return { gifts, count: gifts.length };
    } catch (error) {
      this.logger.error('Failed to get NFT gifts:', error);
      return { gifts: [], count: 0 };
    }
  }

  /**
   * Convert a Telegram gift to a Prize that can be used in cases/payouts
   * DEPRECATED: Use convertGiftToInventoryItem instead
   */
  async convertGiftToPrize(giftId: number): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      if (gift.convertedAt) {
        throw new HttpException('Gift already converted', 400);
      }

      // Create a prize from the gift
      const prize = await this.prisma.prize.create({
        data: {
          name: gift.nftTitle || `Telegram Gift #${gift.id}`,
          amount: gift.starsValue || 0,
          url: '',
        },
      });

      // Mark gift as converted
      await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedValue: prize.amount,
        },
      });

      this.logger.log(
        `✅ Converted gift ${giftId} to prize ${prize.id}: ${prize.name}`,
      );

      return prize;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to convert gift to prize:', error);
      throw new HttpException('Failed to convert gift to prize', 500);
    }
  }

  /**
   * Create an inventory item from a gift for a user
   */
  async convertGiftToInventoryItem(
    giftId: number,
    userId: string,
  ): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      if (gift.convertedAt) {
        throw new HttpException('Gift already converted', 400);
      }

      if (gift.userId !== userId) {
        throw new HttpException('Gift does not belong to this user', 403);
      }

      // Create a prize for this gift
      const prize = await this.prisma.prize.create({
        data: {
          name: gift.nftTitle || `Telegram Gift #${gift.id}`,
          amount: gift.starsValue || 0,
          url: '',
        },
      });

      // Create inventory item
      const inventoryItem = await this.prisma.inventoryItem.create({
        data: {
          userId,
          prizeId: prize.id,
        },
      });

      // Mark gift as converted and link to inventory item
      await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          convertedValue: prize.amount,
          inventoryItemId: inventoryItem.id,
        },
      });

      this.logger.log(
        `✅ Converted gift ${giftId} to inventory item ${inventoryItem.id} for user ${userId}`,
      );

      return {
        inventoryItem,
        prize,
        gift,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to convert gift to inventory:', error);
      throw new HttpException('Failed to convert gift to inventory item', 500);
    }
  }

  /**
   * Get available gifts that haven't been converted yet
   */
  async getAvailableGiftsForConversion(limit = 50, offset = 0) {
    try {
      const gifts = await this.prisma.telegramGift.findMany({
        where: {
          status: 'PENDING',
        },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, username: true, telegramId: true },
          },
        },
      });

      const totalCount = await this.prisma.telegramGift.count({
        where: {
          status: 'PENDING',
        },
      });

      return {
        gifts,
        totalCount,
        hasMore: totalCount > offset + limit,
      };
    } catch (error) {
      this.logger.error('Failed to get available gifts:', error);
      throw new HttpException('Failed to get available gifts', 500);
    }
  }
}
