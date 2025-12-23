import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class OpenCaseDto {
  @ApiProperty({
    description: 'Number of cases to open (1-5)',
    example: 1,
    minimum: 1,
    maximum: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  multiplier: number;
}
