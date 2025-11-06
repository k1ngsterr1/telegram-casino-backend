import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { UserService } from './user.service';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { User } from 'src/shared/decorator/user.decorator';

@Controller('user')
@ApiTags('User')
export class UserController {
  private readonly logger = new Logger(UserController.name);
  constructor(private userService: UserService) {}

  @Post('telegram')
  @ApiOperation({
    summary: 'Authenticate with Telegram Web App',
    description:
      'Authenticate a user using Telegram Web App initData and receive a JWT token. The initData is validated to ensure it comes from Telegram and has not been tampered with.',
  })
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
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid initData or validation failed',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
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
  async getProfile(@User('id') userId: string) {
    return this.userService.getProfile(userId);
  }

  @Post('test')
  @ApiOperation({
    summary: 'Test endpoint - Generate token',
    description:
      'Development/testing endpoint to generate a JWT token for a hardcoded user ID. Should not be used in production.',
  })
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
      'd581bb7e-56b1-4050-bcf2-b6afce518bad',
    );
  }
}
