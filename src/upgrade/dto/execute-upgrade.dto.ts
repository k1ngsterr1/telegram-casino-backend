import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum UpgradeMultiplier {
  X1_5 = 'X1_5',
  X2 = 'X2',
  X3 = 'X3',
  X5 = 'X5',
  X10 = 'X10',
}

export class ExecuteUpgradeDto {
  @ApiProperty({
    description: 'ID of the inventory item to upgrade',
    example: 1,
  })
  @IsInt()
  @Type(() => Number)
  inventoryItemId: number;

  @ApiProperty({
    description: 'Target multiplier for the upgrade',
    example: 'X2',
    enum: UpgradeMultiplier,
  })
  @IsEnum(UpgradeMultiplier)
  multiplier: UpgradeMultiplier;
}
