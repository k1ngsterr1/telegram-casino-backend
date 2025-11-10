import { ApiProperty } from '@nestjs/swagger';
import { IsDecimal, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { UpgradeMultiplier } from '../../../upgrade/dto/execute-upgrade.dto';

export class UpdateUpgradeChanceDto {
  @ApiProperty({
    description: 'Multiplier to update',
    example: 'X2',
    enum: UpgradeMultiplier,
  })
  multiplier: UpgradeMultiplier;

  @ApiProperty({
    description: 'Success chance as decimal (0.0 - 1.0)',
    example: 0.5,
    minimum: 0,
    maximum: 1,
  })
  @IsDecimal()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  chance: number;
}
