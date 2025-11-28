import { ApiProperty } from '@nestjs/swagger';

export class TonInfoResponseDto {
  @ApiProperty({
    description: 'Current TON price in USD',
    example: 5.42,
  })
  tonPriceUsd: number;

  @ApiProperty({
    description: 'Equivalent amount in Telegram Stars for 1 TON',
    example: 416.92,
  })
  tonPriceInStars: number;

  @ApiProperty({
    description: 'Telegram Stars to USD conversion rate',
    example: 0.013,
  })
  starsToUsdRate: number;
}
