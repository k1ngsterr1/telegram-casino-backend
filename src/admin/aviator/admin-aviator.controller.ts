import { Controller, Get, Put, Body, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../../shared/guards/admin.guard';
import { AviatorService } from './aviator.service';
import { UpdateAviatorSettingsDto } from './dto/update-aviator-settings.dto';
import { UpdateServerSeedDto } from './dto/update-server-seed.dto';
import { ServerSeedResponseDto } from './dto/server-seed-response.dto';
import { ClientSeedResponseDto } from './dto/client-seed-response.dto';
import { PrismaService } from '../../shared/services/prisma.service';
import { SystemKey } from '@prisma/client';
import { HttpException } from '@nestjs/common';

@ApiTags('Admin - Aviator')
@Controller('admin/aviator')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@ApiBearerAuth('JWT')
export class AdminAviatorController {
  private readonly logger = new Logger(AdminAviatorController.name);

  constructor(
    private readonly aviatorService: AviatorService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get aviator settings' })
  @ApiResponse({
    status: 200,
    description: 'Returns current aviator settings',
  })
  public getSettings() {
    return {
      settings: this.aviatorService.getAviatorSettings(),
      timestamp: new Date().toISOString(),
    };
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update aviator settings' })
  @ApiResponse({
    status: 200,
    description: 'Aviator settings updated successfully',
  })
  async updateSettings(@Body() dto: UpdateAviatorSettingsDto) {
    try {
      // Validate settings
      if (dto.minMultiplier >= dto.maxMultiplier) {
        throw new HttpException(
          'minMultiplier must be less than maxMultiplier',
          400,
        );
      }

      if (dto.minBet >= dto.maxBet) {
        throw new HttpException('minBet must be less than maxBet', 400);
      }

      if (dto.targetRtp <= 0 || dto.targetRtp >= 1) {
        throw new HttpException('targetRtp must be between 0 and 1', 400);
      }

      if (dto.instantCrashP < 0 || dto.instantCrashP > 0.5) {
        throw new HttpException('instantCrashP must be between 0 and 0.5', 400);
      }

      // Update in database
      const updated = await this.prisma.system.upsert({
        where: { key: SystemKey.AVIATOR },
        update: { value: JSON.stringify(dto) },
        create: {
          key: SystemKey.AVIATOR,
          value: JSON.stringify(dto),
        },
      });

      // Reload settings in service
      await this.aviatorService.reloadAviatorSettings();

      return {
        key: updated.key,
        settings: JSON.parse(updated.value),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update aviator settings', error);
      throw new HttpException('Failed to update aviator settings', 500);
    }
  }

  @Get('server-seed')
  @ApiOperation({ summary: 'Get current server seed' })
  @ApiResponse({
    status: 200,
    description: 'Returns current server seed',
    type: ServerSeedResponseDto,
  })
  public getServerSeed(): ServerSeedResponseDto {
    return {
      serverSeed: this.aviatorService.getServerSeed(),
      timestamp: new Date().toISOString(),
    };
  }

  @Put('server-seed')
  @ApiOperation({ summary: 'Update server seed' })
  @ApiResponse({
    status: 200,
    description: 'Server seed updated successfully',
    type: ServerSeedResponseDto,
  })
  async updateServerSeed(
    @Body() dto: UpdateServerSeedDto,
  ): Promise<ServerSeedResponseDto> {
    try {
      // Validate hex format
      const hexPattern = /^[0-9a-f]{64}$/i;
      if (!hexPattern.test(dto.serverSeed)) {
        throw new HttpException(
          'Server seed must be 64 hexadecimal characters',
          400,
        );
      }

      // Update in database
      await this.prisma.system.upsert({
        where: { key: SystemKey.AVIATOR_SERVER_SEED },
        update: { value: dto.serverSeed },
        create: {
          key: SystemKey.AVIATOR_SERVER_SEED,
          value: dto.serverSeed,
        },
      });

      // Reload server seed in service
      await this.aviatorService.reloadServerSeed();

      this.logger.log('Server seed updated successfully');

      return {
        serverSeed: dto.serverSeed,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to update server seed', error);
      throw new HttpException('Failed to update server seed', 500);
    }
  }

  @Get('client-seed')
  @ApiOperation({ summary: 'Generate new client seed' })
  @ApiResponse({
    status: 200,
    description: 'Returns newly generated client seed',
    type: ClientSeedResponseDto,
  })
  public generateClientSeed(): ClientSeedResponseDto {
    return {
      clientSeed: this.aviatorService.generateClientSeed(),
      timestamp: new Date().toISOString(),
    };
  }
}
