import { ApiProperty } from '@nestjs/swagger';
import { UpgradeMultiplier } from './execute-upgrade.dto';

export class UpgradeOptionDto {
  @ApiProperty({
    description: 'Target prize after upgrade',
    example: {
      id: 2,
      name: 'Premium Item',
      amount: 300,
      url: 'https://example.com/premium.png',
    },
  })
  targetPrize: {
    id: number;
    name: string;
    amount: number;
    url: string;
  };

  @ApiProperty({
    description: 'Multiplier for this upgrade path',
    example: 'X2',
    enum: UpgradeMultiplier,
  })
  multiplier: UpgradeMultiplier;

  @ApiProperty({
    description: 'Success chance as decimal (0.0 - 1.0)',
    example: 0.5,
  })
  chance: number;
}

export class UpgradeOptionsResponseDto {
  @ApiProperty({
    description: 'Source prize from inventory',
    example: {
      id: 1,
      name: 'Basic Item',
      amount: 100,
      url: 'https://example.com/basic.png',
    },
  })
  sourcePrize: {
    id: number;
    name: string;
    amount: number;
    url: string;
  };

  @ApiProperty({
    description: 'Available upgrade options',
    type: [UpgradeOptionDto],
  })
  options: UpgradeOptionDto[];
}
