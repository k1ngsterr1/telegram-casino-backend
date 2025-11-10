import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { UpgradeMultiplier } from '@prisma/client';

export { UpgradeMultiplier };

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
