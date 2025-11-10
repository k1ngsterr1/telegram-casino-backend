import { Module } from '@nestjs/common';
import { AdminStatisticsController } from './admin-statistics.controller';
import { AdminStatisticsService } from './admin-statistics.service';

@Module({
  controllers: [AdminStatisticsController],
  providers: [AdminStatisticsService],
})
export class AdminStatisticsModule {}
