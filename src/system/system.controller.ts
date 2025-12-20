import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SystemService } from './system.service';
import { UpdateBotTokenDto } from './dto/update-bot-token.dto';
import { UpdateWebAppUrlDto } from './dto/update-webapp-url.dto';
import { UpdateDepositSettingsDto } from './dto/update-deposit-settings.dto';
import {
  UpdateSubscriptionsDto,
  VerifySubscriptionDto,
} from './dto/update-subscriptions.dto';
import { AdminGuard } from '../shared/guards/admin.guard';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('System')
@Controller('admin/system')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@ApiBearerAuth('JWT')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly systemService: SystemService) {}

  @Get()
  @ApiOperation({ summary: 'Get all system variables' })
  @ApiResponse({ status: 200, description: 'Returns all system variables' })
  async findAll() {
    return this.systemService.findAll();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get specific system variable by key' })
  @ApiResponse({ status: 200, description: 'Returns system variable' })
  async findOne(@Param('key') key: string) {
    return this.systemService.findOne(key as any);
  }

  @Put('bot-token')
  @ApiOperation({ summary: 'Update Telegram bot token' })
  @ApiResponse({ status: 200, description: 'Bot token updated successfully' })
  async updateBotToken(@Body() dto: UpdateBotTokenDto) {
    return this.systemService.updateBotToken(dto);
  }

  @Put('webapp-url')
  @ApiOperation({ summary: 'Update WebApp URL' })
  @ApiResponse({ status: 200, description: 'WebApp URL updated successfully' })
  async updateWebAppUrl(@Body() dto: UpdateWebAppUrlDto) {
    return this.systemService.updateWebAppUrl(dto.url);
  }

  @Put('deposit-settings')
  @ApiOperation({ summary: 'Update deposit settings' })
  @ApiResponse({
    status: 200,
    description: 'Deposit settings updated successfully',
  })
  async updateDepositSettings(@Body() dto: UpdateDepositSettingsDto) {
    return this.systemService.updateDepositSettings(dto);
  }

  @Get('subscriptions/requirements')
  @ApiOperation({ summary: 'Get free case subscription requirements' })
  @ApiResponse({
    status: 200,
    description: 'Returns current subscription requirements for free cases',
  })
  async getSubscriptionRequirements() {
    return this.systemService.getSubscriptionRequirements();
  }

  @Put('subscriptions/requirements')
  @ApiOperation({ summary: 'Update free case subscription requirements' })
  @ApiResponse({
    status: 200,
    description: 'Subscription requirements updated successfully',
  })
  async updateSubscriptionRequirements(@Body() dto: UpdateSubscriptionsDto) {
    return this.systemService.updateSubscriptionRequirements(dto.subscriptions);
  }

  @Post('subscriptions/verify')
  @ApiOperation({ summary: 'Verify bot access to a chat/channel' })
  @ApiResponse({
    status: 200,
    description: 'Returns whether bot can access the specified chat',
  })
  async verifyChatAccess(@Body() dto: VerifySubscriptionDto) {
    return this.systemService.verifyChatAccess(dto.chatId);
  }
}
