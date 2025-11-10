import { IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStarsPaymentDto {
  @ApiProperty({
    description: 'Amount of Telegram Stars to purchase',
    example: 100,
  })
  @IsNumber()
  amount: number;
}
