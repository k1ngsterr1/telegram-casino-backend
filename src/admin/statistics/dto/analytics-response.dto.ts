import { ApiProperty } from '@nestjs/swagger';

export class AnalyticsMetricsDto {
  @ApiProperty({
    description: 'User growth percentage',
    example: 12.5,
  })
  userGrowthPercentage: number;

  @ApiProperty({
    description: 'Average check amount per player',
    example: 2850,
  })
  averageCheck: number;

  @ApiProperty({
    description: 'Activity percentage (active players)',
    example: 57.6,
  })
  activityPercentage: number;

  @ApiProperty({
    description: 'Retention percentage (returning after 7 days)',
    example: 68.2,
  })
  retentionPercentage: number;
}

export class DailyRevenueDto {
  @ApiProperty({ description: 'Day abbreviation', example: 'Пн' })
  day: string;

  @ApiProperty({ description: 'Revenue amount', example: 350000 })
  revenue: number;

  @ApiProperty({ description: 'Payout amount', example: 70000 })
  payout: number;

  @ApiProperty({ description: 'Profit amount', example: 280000 })
  profit: number;
}

export class AnalyticsResponseDto {
  @ApiProperty({ description: 'Key metrics' })
  metrics: AnalyticsMetricsDto;

  @ApiProperty({
    description: 'Daily revenue and payout data for the last 7 days',
    type: [DailyRevenueDto],
  })
  dailyRevenue: DailyRevenueDto[];

  @ApiProperty({ description: 'Total users count', example: 1543 })
  totalUsers: number;

  @ApiProperty({ description: 'Active users count', example: 889 })
  activeUsers: number;

  @ApiProperty({ description: 'Total revenue', example: 3760000 })
  totalRevenue: number;

  @ApiProperty({ description: 'Total payouts', example: 645000 })
  totalPayouts: number;

  @ApiProperty({ description: 'Total profit', example: 3115000 })
  totalProfit: number;
}
