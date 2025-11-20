import { ApiProperty } from '@nestjs/swagger';

export class ReferralLinkDto {
  @ApiProperty({
    description: 'Referral link for sharing',
    example:
      'https://t.me/YourBot?start=ref_c354c4c4-f424-469b-8a1b-6eb690112f2d',
  })
  referralLink: string;

  @ApiProperty({
    description: 'Referral code for the user',
    example: 'ref_c354c4c4-f424-469b-8a1b-6eb690112f2d',
  })
  referralCode: string;
}

export class ReferralStatsDto {
  @ApiProperty({
    description: 'Number of users referred',
    example: 5,
  })
  totalReferrals: number;

  @ApiProperty({
    description: 'Total earnings from referrals in XTR',
    example: 150,
  })
  totalEarnings: number;

  @ApiProperty({
    description: 'Earnings from first deposits (10%)',
    example: 120,
  })
  firstDepositEarnings: number;

  @ApiProperty({
    description: 'Earnings from subsequent deposits (3%)',
    example: 30,
  })
  subsequentDepositEarnings: number;

  @ApiProperty({
    description: 'Number of referrals who made deposits',
    example: 3,
  })
  activeReferrals: number;
}

export class ReferralEarningDto {
  @ApiProperty({
    description: 'Earning record ID',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'User who made the deposit',
    example: 'user123',
  })
  referredUserId: string;

  @ApiProperty({
    description: 'Commission amount in XTR',
    example: 10,
  })
  amount: number;

  @ApiProperty({
    description: 'Commission percentage',
    example: 0.1,
  })
  percentage: number;

  @ApiProperty({
    description: 'Was this from first deposit',
    example: true,
  })
  isFirstDeposit: boolean;

  @ApiProperty({
    description: 'When the earning was created',
    example: '2025-01-01T00:00:00.000Z',
  })
  createdAt: Date;
}
