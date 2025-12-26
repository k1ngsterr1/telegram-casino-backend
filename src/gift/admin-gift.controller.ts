import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GiftService } from '../shared/services/gift.service';
import { TelegramUserbotService } from '../shared/services/telegram-userbot.service';
import { AdminGuard } from '../shared/guards/admin.guard';
import {
  PaginationDto,
  ConvertGiftToPrizeDto,
  ConvertGiftToInventoryDto,
  SendGiftNotificationDto,
  RequestGiftPayoutDto,
  ApproveGiftPayoutDto,
  SendGiftToUserDto,
} from './dto/gift.dto';

@ApiTags('Admin - Gifts')
@Controller('admin/gift')
@UseGuards(AdminGuard)
@ApiBearerAuth()
export class AdminGiftController {
  constructor(
    private readonly giftService: GiftService,
    private readonly telegramUserbotService: TelegramUserbotService,
  ) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all Telegram gifts (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Returns all gifts with pagination',
  })
  async getAllGifts(@Query() paginationDto: PaginationDto) {
    try {
      const { page = 1, limit = 50 } = paginationDto;
      const offset = (page - 1) * limit;

      const result = await this.giftService.getAvailableGiftsForConversion(
        limit,
        offset,
      );

      return {
        data: result.gifts,
        meta: {
          total: result.totalCount,
          page,
          limit,
          totalPages: Math.ceil(result.totalCount / limit),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get gifts', 500);
    }
  }

  @Post('convert-to-prize')
  @ApiOperation({ summary: 'Convert a Telegram gift to a prize (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Gift converted to prize successfully',
  })
  async convertToPrize(@Body() dto: ConvertGiftToPrizeDto) {
    try {
      const prize = await this.giftService.convertGiftToPrize(dto.giftId);

      return {
        success: true,
        message: 'Gift converted to prize successfully',
        data: prize,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to convert gift to prize', 500);
    }
  }

  @Post('convert-to-inventory')
  @ApiOperation({
    summary: 'Convert gift to inventory for specific user (admin only)',
  })
  @ApiResponse({
    status: 201,
    description: 'Gift converted to inventory successfully',
  })
  async convertToInventoryForUser(@Body() dto: ConvertGiftToInventoryDto) {
    try {
      const result = await this.giftService.convertGiftToInventoryItem(
        dto.giftId,
        dto.userId,
      );

      return {
        success: true,
        message: 'Gift converted to inventory item successfully',
        data: result,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to convert gift to inventory', 500);
    }
  }

  @Post('send-notification')
  @ApiOperation({
    summary: 'Send gift notification to user via Telegram (admin only)',
  })
  @ApiResponse({ status: 201, description: 'Notification sent successfully' })
  async sendGiftNotification(@Body() dto: SendGiftNotificationDto) {
    try {
      const result = await this.telegramUserbotService.sendGiftToUser(
        dto.telegramUserId,
        {
          title: dto.title,
          description: dto.description,
        },
      );

      return {
        success: true,
        message: 'Gift notification sent successfully',
        data: result,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to send gift notification', 500);
    }
  }

  @Get('nft')
  @ApiOperation({ summary: 'Get all NFT gifts (admin only)' })
  @ApiResponse({ status: 200, description: 'Returns all NFT gifts' })
  async getAllNFTGifts(@Query() paginationDto: PaginationDto) {
    try {
      const { page = 1, limit = 100 } = paginationDto;
      const offset = (page - 1) * limit;

      const result = await this.giftService.getAllNFTGifts(limit, offset);

      return {
        data: result.gifts,
        meta: {
          total: result.count,
          page,
          limit,
          totalPages: Math.ceil(result.count / limit),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get NFT gifts', 500);
    }
  }

  // ==================== GIFT PAYOUT MANAGEMENT ====================

  @Get('available-star-gifts')
  @ApiOperation({ summary: 'Get available star gifts from Telegram API' })
  @ApiResponse({
    status: 200,
    description: 'Returns available Telegram star gifts',
  })
  async getAvailableStarGifts() {
    try {
      const result = await this.telegramUserbotService.getAvailableStarGifts();
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get available star gifts', 500);
    }
  }

  @Get('for-payout')
  @ApiOperation({
    summary: 'Get gifts that can be paid out (have valid gift identifiers)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns gifts eligible for payout',
  })
  async getGiftsForPayout(@Query() paginationDto: PaginationDto) {
    try {
      const { page = 1, limit = 50 } = paginationDto;
      const offset = (page - 1) * limit;

      const result = await this.giftService.getGiftsForPayout(limit, offset);

      return {
        data: result.gifts,
        meta: {
          total: result.totalCount,
          page,
          limit,
          totalPages: Math.ceil(result.totalCount / limit),
          hasMore: result.hasMore,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get gifts for payout', 500);
    }
  }

  @Get('pending-payouts')
  @ApiOperation({ summary: 'Get gifts pending payout approval' })
  @ApiResponse({
    status: 200,
    description: 'Returns gifts waiting for admin approval',
  })
  async getPendingPayouts(@Query() paginationDto: PaginationDto) {
    try {
      const { page = 1, limit = 50 } = paginationDto;
      const offset = (page - 1) * limit;

      const result = await this.giftService.getPendingPayoutGifts(
        limit,
        offset,
      );

      return {
        data: result.gifts,
        meta: {
          total: result.totalCount,
          page,
          limit,
          totalPages: Math.ceil(result.totalCount / limit),
          hasMore: result.hasMore,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get pending payouts', 500);
    }
  }

  @Post('request-payout')
  @ApiOperation({
    summary: 'Request payout for a gift (marks for admin approval)',
  })
  @ApiResponse({ status: 201, description: 'Payout request created' })
  async requestPayout(@Body() dto: RequestGiftPayoutDto) {
    try {
      const result = await this.giftService.requestGiftPayout(
        dto.giftId,
        dto.targetTelegramId,
      );

      return {
        success: true,
        message: 'Payout request created, waiting for approval',
        data: result,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to request payout', 500);
    }
  }

  @Post('approve-payout')
  @ApiOperation({
    summary: 'Approve and BUY gift from Telegram, then send to user',
  })
  @ApiResponse({
    status: 201,
    description: 'Gift purchased and sent to user successfully',
  })
  async approvePayout(@Body() dto: ApproveGiftPayoutDto) {
    try {
      // First, approve the payout
      const approval = await this.giftService.approveGiftPayout(dto.giftId);

      const { gift, targetTelegramId, starGiftId } = approval;

      if (!starGiftId) {
        await this.giftService.failGiftPayout(
          dto.giftId,
          'No catalog gift ID found',
        );
        throw new HttpException(
          'Gift has no catalog ID - cannot purchase from Telegram',
          400,
        );
      }

      // Validate the gift can be purchased
      const validation =
        await this.telegramUserbotService.validateGiftCanBeSent(starGiftId);

      if (!validation.canSend) {
        await this.giftService.failGiftPayout(
          dto.giftId,
          validation.reason || 'Gift validation failed',
        );
        throw new HttpException(
          `Cannot purchase gift: ${validation.reason}`,
          400,
        );
      }

      // Buy and send the gift via Telegram
      try {
        const sendResult =
          await this.telegramUserbotService.buyAndSendGiftToUser(
            targetTelegramId,
            starGiftId,
          );

        // Mark as completed and remove from inventory
        await this.giftService.completeGiftPayout(dto.giftId);

        return {
          success: true,
          message: `Gift purchased (${validation.stars} stars) and sent to user successfully`,
          data: {
            gift,
            starsCost: validation.stars,
            sendResult,
          },
        };
      } catch (sendError) {
        // Mark payout as failed
        await this.giftService.failGiftPayout(dto.giftId, sendError.message);
        throw sendError;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to approve payout', 500);
    }
  }

  @Post('send-gift-direct')
  @ApiOperation({
    summary: 'Directly BUY and send a star gift to a user (admin only)',
  })
  @ApiResponse({
    status: 201,
    description: 'Gift purchased and sent successfully',
  })
  async sendGiftDirect(@Body() dto: SendGiftToUserDto) {
    try {
      // Get the gift from database
      const gifts = await this.giftService.getGiftsForPayout(1000, 0);
      const giftFromDb = gifts.gifts.find((g: any) => g.id === dto.giftId);

      if (!giftFromDb) {
        throw new HttpException(
          'Gift not found or not eligible for payout',
          404,
        );
      }

      if (!giftFromDb.starGiftId) {
        throw new HttpException(
          'Gift has no catalog ID - cannot purchase from Telegram',
          400,
        );
      }

      // Validate first
      const validation =
        await this.telegramUserbotService.validateGiftCanBeSent(
          giftFromDb.starGiftId,
        );
      if (!validation.canSend) {
        throw new HttpException(
          `Cannot purchase gift: ${validation.reason}`,
          400,
        );
      }

      // Buy and send
      const sendResult = await this.telegramUserbotService.buyAndSendGiftToUser(
        dto.targetTelegramId,
        giftFromDb.starGiftId,
        {
          message: dto.message,
          hideName: dto.hideName,
        },
      );

      // Mark gift as used
      await this.giftService.completeGiftPayout(dto.giftId);

      return {
        success: true,
        message: `Gift purchased (${validation.stars} stars) and sent successfully`,
        starsCost: validation.stars,
        data: sendResult,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to send gift', 500);
    }
  }

  @Post('validate-gift')
  @ApiOperation({
    summary: 'Validate if a gift can be purchased from Telegram',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns validation result with cost',
  })
  async validateGift(@Body() body: { starGiftId: string }) {
    try {
      const result = await this.telegramUserbotService.validateGiftCanBeSent(
        body.starGiftId,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to validate gift', 500);
    }
  }

  @Get('saved-gifts')
  @ApiOperation({ summary: 'Get saved gifts from Telegram account' })
  @ApiResponse({
    status: 200,
    description: 'Returns saved gifts from bot account',
  })
  async getSavedGifts(@Query() query: { limit?: number; offset?: string }) {
    try {
      const result = await this.telegramUserbotService.getSavedGifts(
        query.limit || 50,
        query.offset || '',
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get saved gifts', 500);
    }
  }
}
