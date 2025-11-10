import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum CaseSortBy {
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME_ASC = 'name_asc',
  NAME_DESC = 'name_desc',
  CREATED_ASC = 'created_asc',
  CREATED_DESC = 'created_desc',
}

export class GetCasesCursorDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (case ID to start from)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cursor?: number;

  @ApiPropertyOptional({
    description: 'Number of items to return',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort cases by field',
    enum: CaseSortBy,
    example: CaseSortBy.PRICE_ASC,
  })
  @IsOptional()
  @IsEnum(CaseSortBy)
  sortBy?: CaseSortBy = CaseSortBy.PRICE_ASC;
}
