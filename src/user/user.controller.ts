import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Inject,
  UseGuards,
  Query,
  Param,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { User } from 'src/shared/decorator/user.decorator';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { AuthGuard } from '@nestjs/passport';
import {
  ReferralLinkDto,
  ReferralStatsDto,
  ReferralEarningDto,
} from './dto/referral-response.dto';

@Controller('user')
@ApiTags('User')
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(
    private userService: UserService,
    @Inject(WebsocketGateway)
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  @Post('telegram')
  @ApiOperation({ summary: 'Authenticate with Telegram Web App' })
  @ApiBody({ type: TelegramAuthDto })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful - JWT token returned',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description: 'JWT access token for API authentication',
        },
      },
    },
  })
  async telegram(@Body() data: TelegramAuthDto) {
    try {
      return await this.userService.telegram(data);
    } catch (error) {
      this.logger.error('Failed to authenticate with Telegram: ', error);
      throw error;
    }
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'User ID' },
        telegramId: { type: 'string', description: 'Telegram user ID' },
        role: {
          type: 'string',
          enum: ['USER', 'ADMIN'],
          description: 'User role',
        },
        isBanned: { type: 'boolean', description: 'Ban status' },
        balance: { type: 'number', description: 'User balance' },
        rating: { type: 'number', description: 'User rank based on balance' },
      },
    },
  })
  async getProfile(@User('id') userId: string) {
    return this.userService.getProfile(userId);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test endpoint - Generate token for testing' })
  @ApiResponse({
    status: 201,
    description: 'Test token generated successfully',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          description: 'JWT access token for testing',
        },
      },
    },
  })
  async test() {
    return this.userService.generateToken(
      'c354c4c4-f424-469b-8a1b-6eb690112f2d',
    );
  }

  @Get('active-users')
  @ApiOperation({ summary: 'Get active users count (public)' })
  @ApiResponse({
    status: 200,
    description: 'Returns count of active users',
  })
  getActiveUsers() {
    return {
      count: this.websocketGateway.getActiveUsersCount(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('referral/link')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get referral link for user' })
  @ApiResponse({
    status: 200,
    description: 'Referral link retrieved successfully',
    type: ReferralLinkDto,
  })
  async getReferralLink(@User('id') userId: string) {
    return this.userService.getReferralLink(userId);
  }

  @Get('referral/stats')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get referral statistics for user' })
  @ApiResponse({
    status: 200,
    description: 'Referral statistics retrieved successfully',
    type: ReferralStatsDto,
  })
  async getReferralStats(@User('id') userId: string) {
    return this.userService.getReferralStats(userId);
  }

  @Get('referral/earnings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get referral earnings history' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Referral earnings history retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/ReferralEarningDto' },
        },
        total: { type: 'number' },
      },
    },
  })
  async getReferralEarnings(
    @User('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.userService.getReferralEarnings(
      userId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Post('inventory/sell/:itemId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Sell an inventory item' })
  @ApiResponse({
    status: 200,
    description: 'Item sold successfully',
    schema: {
      type: 'object',
      properties: {
        balance: { type: 'number', description: 'Updated user balance' },
        amount: { type: 'number', description: 'Amount received from sale' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 403, description: 'Not authorized to sell this item' })
  async sellInventoryItem(
    @User('id') userId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.userService.sellInventoryItem(userId, Number(itemId));
  }

  @Get('inventory')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get user inventory' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiResponse({
    status: 200,
    description: 'User inventory retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              prize: {
                type: 'object',
                properties: {
                  id: { type: 'number' },
                  name: { type: 'string' },
                  amount: { type: 'number' },
                  url: { type: 'string' },
                },
              },
              case: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'number' },
                  name: { type: 'string' },
                },
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        total: { type: 'number' },
      },
    },
  })
  async getUserInventory(
    @User('id') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.userService.getUserInventory(
      userId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
    );
  }
}
