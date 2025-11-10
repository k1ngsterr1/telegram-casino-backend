import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class GetUpgradeOptionsDto {
  @ApiProperty({
    description: 'ID of the inventory item to upgrade',
    example: 1,
  })
  @IsInt()
  @Type(() => Number)
  inventoryItemId: number;
}
