import { ApiProperty } from '@nestjs/swagger';

export class LeaderboardEntryDto {
  @ApiProperty({
    description: 'User identifier',
    example: '@user_12345',
  })
  user: string;

  @ApiProperty({
    description: 'Total amount (bets or winnings)',
    example: 450000,
  })
  amount: number;

  @ApiProperty({
    description: 'Rank position',
    example: 1,
  })
  rank: number;
}

export class LeaderboardResponseDto {
  @ApiProperty({
    description: 'Top players by total bets',
    type: [LeaderboardEntryDto],
  })
  topBettors: LeaderboardEntryDto[];

  @ApiProperty({
    description: 'Top players by total winnings',
    type: [LeaderboardEntryDto],
  })
  topWinners: LeaderboardEntryDto[];
}
