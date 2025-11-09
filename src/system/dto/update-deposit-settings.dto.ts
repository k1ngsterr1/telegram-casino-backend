import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateDepositSettingsDto {
  @ApiProperty({
    description: 'Minimum deposit amount in rubles',
    example: 100,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minDeposit: number;

  @ApiProperty({
    description: 'Maximum withdrawal amount in rubles',
    example: 100000,
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxWithdrawal: number;

  @ApiProperty({
    description: 'Withdrawal commission percentage (0-100)',
    example: 5,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  withdrawalCommission: number;
}
