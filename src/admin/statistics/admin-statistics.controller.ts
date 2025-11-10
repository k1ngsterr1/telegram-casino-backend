import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { AdminStatisticsService } from './admin-statistics.service';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AdminGuard } from 'src/shared/guards/admin.guard';
import { AuthGuard } from '@nestjs/passport';
import { StatisticsFilterDto } from './dto/statistics-filter.dto';
import { AnalyticsResponseDto } from './dto/analytics-response.dto';
import { TransactionsResponseDto } from './dto/transaction-response.dto';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';

@Controller('admin/statistics')
@ApiTags('Admin - Statistics')
@ApiBearerAuth('JWT')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminStatisticsController {
  private readonly logger = new Logger(AdminStatisticsController.name);

  constructor(private adminStatisticsService: AdminStatisticsService) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Get analytics and metrics' })
  @ApiResponse({
    status: 200,
    description: 'Analytics retrieved successfully',
    type: AnalyticsResponseDto,
  })
  async getAnalytics(@Query() filter: StatisticsFilterDto) {
    try {
      return await this.adminStatisticsService.getAnalytics(filter);
    } catch (error) {
      this.logger.error('Failed to get analytics: ', error);
      throw error;
    }
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get all transactions with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Transactions retrieved successfully',
    type: TransactionsResponseDto,
  })
  async getTransactions(@Query() query: TransactionsQueryDto) {
    try {
      return await this.adminStatisticsService.getTransactions(query);
    } catch (error) {
      this.logger.error('Failed to get transactions: ', error);
      throw error;
    }
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get top players by bets and winnings' })
  @ApiResponse({
    status: 200,
    description: 'Leaderboard retrieved successfully',
    type: LeaderboardResponseDto,
  })
  async getLeaderboard(@Query() filter: StatisticsFilterDto) {
    try {
      return await this.adminStatisticsService.getLeaderboard(filter);
    } catch (error) {
      this.logger.error('Failed to get leaderboard: ', error);
      throw error;
    }
  }
}
