import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAviatorSettingsDto {
  @ApiProperty({
    description: 'Minimum multiplier value',
    example: 1.0,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minMultiplier: number;

  @ApiProperty({
    description: 'Maximum multiplier value',
    example: 100000,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxMultiplier: number;

  @ApiProperty({
    description: 'Minimum bet amount in coins',
    example: 25,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minBet: number;

  @ApiProperty({
    description: 'Maximum bet amount in coins',
    example: 10000,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxBet: number;

  @ApiProperty({
    description: 'Target RTP (Return to Player) ratio',
    example: 0.89,
  })
  @IsNumber()
  @Min(0.01)
  @Max(0.99)
  @Type(() => Number)
  targetRtp: number;

  @ApiProperty({
    description: 'Probability of instant crash at 1.00x',
    example: 0.01,
  })
  @IsNumber()
  @Min(0)
  @Max(0.5)
  @Type(() => Number)
  instantCrashP: number;
}
