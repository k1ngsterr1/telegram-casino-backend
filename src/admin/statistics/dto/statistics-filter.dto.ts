import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsDateString } from 'class-validator';

export class StatisticsFilterDto {
  @ApiProperty({
    description: 'Start date for statistics (ISO 8601)',
    example: '2025-11-01T00:00:00.000Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'End date for statistics (ISO 8601)',
    example: '2025-11-10T23:59:59.999Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
