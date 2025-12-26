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
        // Store the message ID for later use with inputSavedStarGiftUser
        savedMsgId: message.id,
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
          // For unique gifts, store the slug for inputSavedStarGiftSlug
          starGiftSlug: gift.slug || null,
          // Store the gift_id (id field from starGiftUnique)
          starGiftId: gift.id?.toString() || gift.giftId?.toString() || null,
        };

        this.logger.log(
          `Processing NFT gift: ${gift.title || 'Unknown'} #${gift.num} (giftId: ${gift.id}, slug: ${gift.slug}) for user ${receiverTelegramId}`,
        );
      } else {
        // Regular star gift
        const starsValue = action.stars || 0;
        const gift = action.gift || {};

        giftData.starsValue = starsValue;
        // Store the starGift.id - this is crucial for sending the gift via inputInvoiceStarGift
        giftData.starGiftId =
          gift.id?.toString() || action.giftId?.toString() || null;

        this.logger.log(
          `Processing star gift: ${starsValue} stars (giftId: ${gift.id}) for user ${receiverTelegramId}`,
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
      giftData.status = 'IN_INVENTORY';
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
   * Create a prize from a gift (admin only)
   */
  async convertGiftToPrize(giftId: number): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      if (gift.status !== 'PENDING') {
        throw new HttpException('Gift is not in PENDING status', 400);
      }

      // Create a prize for this gift
      const prize = await this.prisma.prize.create({
        data: {
          name: gift.nftTitle || `Telegram Gift #${gift.id}`,
          amount: gift.starsValue || 0,
          url: '',
        },
      });

      this.logger.log(`✅ Created prize ${prize.id} from gift ${giftId}`);

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

      if (gift.status !== 'PENDING') {
        throw new HttpException('Gift is not in PENDING status', 400);
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

      // Mark gift as in inventory and link to inventory item
      await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'IN_INVENTORY',
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

  /**
   * Request payout for a gift - marks it for admin approval
   */
  async requestGiftPayout(
    giftId: number,
    targetTelegramId: string,
  ): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
        include: { inventoryItem: true },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      if (!gift.starGiftId && !gift.starGiftSlug) {
        throw new HttpException(
          'Gift does not have a valid Telegram gift identifier for payout',
          400,
        );
      }

      // Check if gift is in a valid state for payout request
      if (gift.status !== 'IN_INVENTORY') {
        throw new HttpException(
          `Gift cannot be paid out (current status: ${gift.status})`,
          400,
        );
      }

      const updatedGift = await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'PAYOUT_REQUESTED',
          payoutToTelegramId: targetTelegramId,
        },
      });

      this.logger.log(
        `📝 Gift ${giftId} marked for payout to ${targetTelegramId}`,
      );

      return updatedGift;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to request gift payout:', error);
      throw new HttpException('Failed to request gift payout', 500);
    }
  }

  /**
   * Get all gifts pending payout approval (admin only)
   */
  async getPendingPayoutGifts(limit = 50, offset = 0) {
    try {
      const gifts = await this.prisma.telegramGift.findMany({
        where: {
          status: 'PAYOUT_REQUESTED',
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, username: true, telegramId: true },
          },
          inventoryItem: {
            include: {
              prize: true,
            },
          },
        },
      });

      const totalCount = await this.prisma.telegramGift.count({
        where: { status: 'PAYOUT_REQUESTED' },
      });

      return {
        gifts,
        totalCount,
        hasMore: totalCount > offset + limit,
      };
    } catch (error) {
      this.logger.error('Failed to get pending payout gifts:', error);
      throw new HttpException('Failed to get pending payout gifts', 500);
    }
  }

  /**
   * Approve gift payout - this will be called by admin and triggers the actual sending
   */
  async approveGiftPayout(giftId: number): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
        include: {
          inventoryItem: true,
          user: true,
        },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      if (gift.status !== 'PAYOUT_REQUESTED') {
        throw new HttpException(
          `Gift is not pending approval (current status: ${gift.status})`,
          400,
        );
      }

      if (!gift.payoutToTelegramId) {
        throw new HttpException('No target telegram ID set for payout', 400);
      }

      // Mark as approved
      const updatedGift = await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'PAYOUT_APPROVED',
          payoutApprovedAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Gift ${giftId} approved for payout to ${gift.payoutToTelegramId}`,
      );

      return {
        gift: updatedGift,
        targetTelegramId: gift.payoutToTelegramId,
        starGiftId: gift.starGiftId,
        starGiftSlug: gift.starGiftSlug,
        savedMsgId: gift.savedMsgId,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to approve gift payout:', error);
      throw new HttpException('Failed to approve gift payout', 500);
    }
  }

  /**
   * Mark gift payout as completed - called after successful Telegram send
   */
  async completeGiftPayout(giftId: number): Promise<any> {
    try {
      const gift = await this.prisma.telegramGift.findUnique({
        where: { id: giftId },
        include: { inventoryItem: true },
      });

      if (!gift) {
        throw new HttpException('Gift not found', 404);
      }

      // Remove from inventory if exists
      if (gift.inventoryItemId) {
        await this.prisma.inventoryItem.delete({
          where: { id: gift.inventoryItemId },
        });
      }

      // Update gift status
      const updatedGift = await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'PAID_OUT',
          payoutCompletedAt: new Date(),
          inventoryItemId: null,
        },
      });

      this.logger.log(
        `🎁 Gift ${giftId} payout completed and removed from inventory`,
      );

      return updatedGift;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to complete gift payout:', error);
      throw new HttpException('Failed to complete gift payout', 500);
    }
  }

  /**
   * Mark gift payout as failed
   */
  async failGiftPayout(giftId: number, error: string): Promise<any> {
    try {
      const updatedGift = await this.prisma.telegramGift.update({
        where: { id: giftId },
        data: {
          status: 'FAILED',
          payoutError: error,
        },
      });

      this.logger.error(`❌ Gift ${giftId} payout failed: ${error}`);

      return updatedGift;
    } catch (err) {
      this.logger.error('Failed to mark gift payout as failed:', err);
      throw new HttpException('Failed to update gift payout status', 500);
    }
  }

  /**
   * Get gifts with their identifiers for payout
   */
  async getGiftsForPayout(limit = 50, offset = 0) {
    try {
      const gifts = await this.prisma.telegramGift.findMany({
        where: {
          status: 'IN_INVENTORY',
          starGiftId: { not: null }, // Must have catalog ID for buying
        },
        orderBy: { receivedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, username: true, telegramId: true },
          },
          inventoryItem: {
            include: {
              prize: true,
            },
          },
        },
      });

      const totalCount = await this.prisma.telegramGift.count({
        where: {
          status: 'IN_INVENTORY',
          starGiftId: { not: null },
        },
      });

      return {
        gifts,
        totalCount,
        hasMore: totalCount > offset + limit,
      };
    } catch (error) {
      this.logger.error('Failed to get gifts for payout:', error);
      throw new HttpException('Failed to get gifts for payout', 500);
    }
  }
}
