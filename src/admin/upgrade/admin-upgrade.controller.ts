import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminUpgradeService } from './admin-upgrade.service';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { CreateUpgradeChanceDto } from './dto/create-upgrade-chance.dto';
import { UpdateUpgradeChanceDto } from './dto/update-upgrade-chance.dto';
import { DeleteUpgradeChanceDto } from './dto/delete-upgrade-chance.dto';
import { EditMultiplierDto } from './dto/edit-multiplier.dto';
import { UpgradeChanceResponseDto } from './dto/upgrade-chance-response.dto';

@ApiTags('Admin - Upgrade')
@Controller('admin/upgrade')
@UseGuards(AuthGuard('jwt'), AdminGuard)
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

  @Post('chance')
  @ApiOperation({ summary: 'Create new upgrade chance multiplier' })
  @ApiResponse({
    status: 201,
    description: 'Upgrade chance created successfully',
    type: UpgradeChanceResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Multiplier already exists',
  })
  async createUpgradeChance(
    @Body() dto: CreateUpgradeChanceDto,
  ): Promise<UpgradeChanceResponseDto> {
    return this.adminUpgradeService.createUpgradeChance(dto);
  }

  @Put('chance')
  @ApiOperation({ summary: 'Update upgrade chance for a multiplier' })
  @ApiResponse({
    status: 200,
    description: 'Upgrade chance updated successfully',
    type: UpgradeChanceResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Multiplier not found',
  })
  async updateUpgradeChance(
    @Body() dto: UpdateUpgradeChanceDto,
  ): Promise<UpgradeChanceResponseDto> {
    return this.adminUpgradeService.updateUpgradeChance(dto);
  }

  @Put('multiplier')
  @ApiOperation({
    summary: 'Edit multiplier value (change the multiplier itself)',
  })
  @ApiResponse({
    status: 200,
    description: 'Multiplier edited successfully',
    type: UpgradeChanceResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Old multiplier not found',
  })
  @ApiResponse({
    status: 400,
    description: 'New multiplier already exists',
  })
  async editMultiplier(
    @Body() dto: EditMultiplierDto,
  ): Promise<UpgradeChanceResponseDto> {
    return this.adminUpgradeService.editMultiplier(dto);
  }

  @Delete('chance/:id')
  @ApiOperation({ summary: 'Delete upgrade chance by ID' })
  @ApiResponse({
    status: 200,
    description: 'Upgrade chance deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Upgrade chance not found',
  })
  async deleteUpgradeChance(
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    return this.adminUpgradeService.deleteUpgradeChance({ id: parseInt(id) });
  }
}
