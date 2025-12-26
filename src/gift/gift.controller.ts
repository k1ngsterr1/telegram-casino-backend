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
import { UserGuard } from '../shared/guards/user.guard';
import { User } from '../shared/decorator/user.decorator';
import {
  PaginationDto,
  ConvertGiftToPrizeDto,
  ConvertGiftToInventoryDto,
  SendGiftNotificationDto,
  RequestGiftPayoutDto,
} from './dto/gift.dto';

@ApiTags('Gifts')
@Controller('gift')
export class GiftController {
  constructor(
    private readonly giftService: GiftService,
    private readonly telegramUserbotService: TelegramUserbotService,
  ) {}

  @Get('my-gifts')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's Telegram gifts" })
  @ApiResponse({
    status: 200,
    description: 'Returns user gifts with pagination',
  })
  async getMyGifts(
    @User('telegramId') telegramId: string,
    @Query() paginationDto: PaginationDto,
  ) {
    try {
      const { page = 1, limit = 20 } = paginationDto;
      const offset = (page - 1) * limit;

      const result = await this.giftService.getUserGifts(
        telegramId,
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
      throw new HttpException('Failed to get user gifts', 500);
    }
  }

  @Get('available')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get available gifts that can be converted' })
  @ApiResponse({ status: 200, description: 'Returns unconverted gifts' })
  async getAvailableGifts(@Query() paginationDto: PaginationDto) {
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
          hasMore: result.hasMore,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get available gifts', 500);
    }
  }

  @Post('convert-to-inventory')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Convert a Telegram gift to inventory item' })
  @ApiResponse({ status: 201, description: 'Gift converted successfully' })
  async convertToInventory(
    @User('id') userId: string,
    @Body() dto: ConvertGiftToPrizeDto,
  ) {
    try {
      const result = await this.giftService.convertGiftToInventoryItem(
        dto.giftId,
        userId,
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

  @Get('nft')
  @ApiOperation({ summary: 'Get all NFT gifts' })
  @ApiResponse({ status: 200, description: 'Returns NFT gifts' })
  async getNFTGifts(@Query() paginationDto: PaginationDto) {
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

  @Post('request-payout')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request payout for a gift (send to Telegram)' })
  @ApiResponse({ status: 201, description: 'Payout request submitted' })
  async requestPayout(
    @User('id') userId: string,
    @User('telegramId') telegramId: string,
    @Body() dto: { giftId: number },
  ) {
    try {
      // Verify the gift belongs to this user by checking the gift
      const userGifts = await this.giftService.getUserGifts(
        telegramId,
        1000,
        0,
      );
      const gift = userGifts.gifts.find((g: any) => g.id === dto.giftId);

      if (!gift) {
        throw new HttpException(
          'Gift not found or does not belong to you',
          404,
        );
      }

      if (!gift.starGiftId && !gift.starGiftSlug) {
        throw new HttpException(
          'This gift cannot be paid out (no valid Telegram identifier)',
          400,
        );
      }

      const result = await this.giftService.requestGiftPayout(
        dto.giftId,
        telegramId, // Request payout to the user's own telegram account
      );

      return {
        success: true,
        message: 'Payout request submitted. Please wait for admin approval.',
        data: result,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to request payout', 500);
    }
  }

  @Get('my-payout-requests')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my payout requests status' })
  @ApiResponse({ status: 200, description: 'Returns payout request statuses' })
  async getMyPayoutRequests(
    @User('telegramId') telegramId: string,
    @Query() paginationDto: PaginationDto,
  ) {
    try {
      const { page = 1, limit = 20 } = paginationDto;
      const userGifts = await this.giftService.getUserGifts(
        telegramId,
        1000,
        0,
      );

      // Filter gifts that have payout requests
      const payoutRequests = userGifts.gifts.filter(
        (g: any) => g.payoutStatus && g.payoutStatus !== 'NONE',
      );

      const paginatedRequests = payoutRequests.slice(
        (page - 1) * limit,
        page * limit,
      );

      return {
        data: paginatedRequests,
        meta: {
          total: payoutRequests.length,
          page,
          limit,
          totalPages: Math.ceil(payoutRequests.length / limit),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Failed to get payout requests', 500);
    }
  }
}
