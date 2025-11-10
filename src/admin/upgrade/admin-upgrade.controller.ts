import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminUpgradeService } from './admin-upgrade.service';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { UpdateUpgradeChanceDto } from './dto/update-upgrade-chance.dto';
import { UpgradeChanceResponseDto } from './dto/upgrade-chance-response.dto';

@ApiTags('Admin - Upgrade')
@Controller('admin/upgrade')
@UseGuards(AdminGuard)
@ApiBearerAuth()
export class AdminUpgradeController {
  constructor(private readonly adminUpgradeService: AdminUpgradeService) {}

  @Get('chances')
  @ApiOperation({ summary: 'Get all upgrade chances' })
  @ApiResponse({
    status: 200,
    description: 'Returns all upgrade chances configuration',
    type: [UpgradeChanceResponseDto],
  })
  async getAllUpgradeChances(): Promise<UpgradeChanceResponseDto[]> {
    return this.adminUpgradeService.getAllUpgradeChances();
  }

  @Put('chance')
  @ApiOperation({ summary: 'Update upgrade chance for a multiplier' })
  @ApiResponse({
    status: 200,
    description: 'Upgrade chance updated successfully',
    type: UpgradeChanceResponseDto,
  })
  async updateUpgradeChance(
    @Body() dto: UpdateUpgradeChanceDto,
  ): Promise<UpgradeChanceResponseDto> {
    return this.adminUpgradeService.updateUpgradeChance(dto);
  }

  @Put('initialize')
  @ApiOperation({ summary: 'Initialize default upgrade chances' })
  @ApiResponse({
    status: 200,
    description: 'Default upgrade chances initialized',
  })
  async initializeDefaultChances(): Promise<{ message: string }> {
    await this.adminUpgradeService.initializeDefaultChances();
    return { message: 'Default upgrade chances initialized' };
  }
}
