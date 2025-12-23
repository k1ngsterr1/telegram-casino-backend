import {
  IsString,
  IsInt,
  Min,
  IsUrl,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CaseItemDto {
  @ApiProperty({ description: 'Item name', example: 'Gold Coin' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Prize ID', example: 1 })
  @IsInt()
  prizeId: number;

  @ApiProperty({
    description: 'Chance percentage (0-100)',
    example: 25,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  chance: number;
}

export class CreateCaseDto {
  @ApiProperty({ description: 'Case name', example: 'Gold Box' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Price in coins', example: 100, minimum: 0 })
  @IsInt()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Whether the case is free (optional, defaults to false)',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiProperty({
    description: 'Case preview image URL',
    example: 'https://example.com/case.png',
  })
  @IsUrl()
  preview: string;

  @ApiProperty({
    description: 'List of items in the case',
    type: [CaseItemDto],
    example: [
      { name: 'Gold Coin', prizeId: 1, chance: 25 },
      { name: 'Silver Coin', prizeId: 2, chance: 75 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one prize is required' })
  @ValidateNested({ each: true })
  @Type(() => CaseItemDto)
  items: CaseItemDto[];
}
