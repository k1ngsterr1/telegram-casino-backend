import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { User } from 'src/shared/decorator/user.decorator';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { AuthGuard } from '@nestjs/passport';

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
}
