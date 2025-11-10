import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UpgradeService } from './upgrade.service';
import { UserGuard } from '../shared/guards/user.guard';
import { User } from '../shared/decorator/user.decorator';
import { GetUpgradeOptionsDto } from './dto/get-upgrade-options.dto';
import { ExecuteUpgradeDto } from './dto/execute-upgrade.dto';
import { UpgradeOptionsResponseDto } from './dto/upgrade-options-response.dto';
import { UpgradeResultDto } from './dto/upgrade-result.dto';

@ApiTags('Upgrade')
@Controller('upgrade')
export class UpgradeController {
  constructor(private readonly upgradeService: UpgradeService) {}

  @Get('options')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get upgrade options for an inventory item' })
  @ApiResponse({
    status: 200,
    description: 'Returns available upgrade paths with chances',
    type: UpgradeOptionsResponseDto,
  })
  async getUpgradeOptions(
    @Query() dto: GetUpgradeOptionsDto,
    @User('id') userId: string,
  ): Promise<UpgradeOptionsResponseDto> {
    return this.upgradeService.getUpgradeOptions(dto.inventoryItemId, userId);
  }

  @Post('execute')
  @UseGuards(UserGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execute an upgrade attempt' })
  @ApiResponse({
    status: 201,
    description: 'Upgrade executed, returns success/failure result',
    type: UpgradeResultDto,
  })
  async executeUpgrade(
    @Body() dto: ExecuteUpgradeDto,
    @User('id') userId: string,
  ): Promise<UpgradeResultDto> {
    return this.upgradeService.executeUpgrade(
      dto.inventoryItemId,
      dto.multiplier,
      userId,
    );
  }
}
