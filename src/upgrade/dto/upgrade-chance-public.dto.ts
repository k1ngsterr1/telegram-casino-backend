import { ApiProperty } from '@nestjs/swagger';

export class UpgradeChancePublicDto {
  @ApiProperty({
    description: 'Multiplier value',
    example: 2,
  })
  multiplier: number;

  @ApiProperty({
    description: 'Success chance as decimal (0.0 - 1.0)',
    example: 0.5,
  })
  chance: number;

  @ApiProperty({
    description: 'Success chance as percentage',
    example: 50,
  })
  chancePercent: number;
}
