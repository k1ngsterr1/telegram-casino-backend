import {
  IsString,
  IsInt,
  Min,
  IsUrl,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CaseItemDto {
  @ApiPropertyOptional({ description: 'Item name', example: 'Gold Coin' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Prize ID', example: 1 })
  @IsInt()
  prizeId: number;

  @ApiPropertyOptional({
    description: 'Chance percentage (0-100)',
    example: 25,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  chance: number;
}

export class UpdateCaseDto {
  @ApiPropertyOptional({ description: 'Case name', example: 'Gold Box' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Price in coins',
    example: 100,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: 'Whether the case is free',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({
    description: 'Case preview image URL',
    example: 'https://example.com/case.png',
  })
  @IsOptional()
  @IsUrl()
  preview?: string;

  @ApiPropertyOptional({
    description: 'List of items in the case',
    type: [CaseItemDto],
    example: [
      { name: 'Gold Coin', prizeId: 1, chance: 25 },
      { name: 'Silver Coin', prizeId: 2, chance: 75 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one prize is required' })
  @ValidateNested({ each: true })
  @Type(() => CaseItemDto)
  items?: CaseItemDto[];
}
