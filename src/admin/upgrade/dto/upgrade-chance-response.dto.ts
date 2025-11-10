import { ApiProperty } from '@nestjs/swagger';
import { UpgradeMultiplier } from '../../../upgrade/dto/execute-upgrade.dto';

export class UpgradeChanceResponseDto {
  @ApiProperty({
    description: 'Upgrade chance ID',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Multiplier',
    example: 'X2',
    enum: UpgradeMultiplier,
  })
  multiplier: UpgradeMultiplier;

  @ApiProperty({
    description: 'Success chance as decimal (0.0 - 1.0)',
    example: 0.5,
  })
  chance: string;

  @ApiProperty({
    description: 'Created at',
    example: '2025-11-10T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Updated at',
    example: '2025-11-10T12:00:00Z',
  })
  updatedAt: Date;
}
