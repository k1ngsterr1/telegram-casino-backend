import { ApiProperty } from '@nestjs/swagger';
import { UpgradeMultiplier } from './execute-upgrade.dto';

export class UpgradeResultDto {
  @ApiProperty({
    description: 'Whether the upgrade was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Multiplier used for the upgrade',
    example: 'X2',
    enum: UpgradeMultiplier,
  })
  multiplier: UpgradeMultiplier;

  @ApiProperty({
    description: 'Chance that was used for this upgrade attempt',
    example: 0.5,
  })
  chance: number;

  @ApiProperty({
    description: 'Source prize that was upgraded',
    example: {
      id: 1,
      name: 'Basic Item',
      amount: 100,
      url: 'https://example.com/basic.png',
    },
  })
  fromPrize: {
    id: number;
    name: string;
    amount: number;
    url: string;
  };

  @ApiProperty({
    description: 'Target prize (only if successful)',
    example: {
      id: 2,
      name: 'Premium Item',
      amount: 200,
      url: 'https://example.com/premium.png',
    },
    required: false,
  })
  toPrize?: {
    id: number;
    name: string;
    amount: number;
    url: string;
  };

  @ApiProperty({
    description: 'New inventory item ID (only if successful)',
    example: 42,
    required: false,
  })
  newInventoryItemId?: number;
}
