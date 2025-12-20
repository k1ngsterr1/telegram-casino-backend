import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CaseItemResponseDto {
  @ApiProperty({ description: 'Item ID', example: 1 })
  id: number;

  @ApiProperty({ description: 'Item name', example: 'Gold Coin' })
  name: string;

  @ApiProperty({ description: 'Drop chance (0-1)', example: 0.5 })
  chance: number;

  @ApiProperty({ description: 'Prize ID', example: 1 })
  prizeId: number;

  @ApiProperty({
    description: 'Prize details',
    example: { id: 1, name: 'Gold Coin', amount: 100, url: 'https://...' },
  })
  prize: {
    id: number;
    name: string;
    amount: number;
    url: string;
  };
}

export class CaseResponseDto {
  @ApiProperty({ description: 'Case ID', example: 1 })
  id: number;

  @ApiProperty({ description: 'Case name', example: 'Gold Box' })
  name: string;

  @ApiProperty({ description: 'Case price in coins', example: 100 })
  price: number;

  @ApiProperty({
    description: 'Case preview image URL',
    example: 'https://example.com/case.png',
  })
  preview: string;

  @ApiProperty({ description: 'Whether this is a free case', example: false })
  isFree: boolean;

  @ApiPropertyOptional({
    description: 'Items in the case (only in detailed view)',
    type: [CaseItemResponseDto],
  })
  items?: CaseItemResponseDto[];

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-01-01T00:00:00.000Z',
  })
  createdAt: Date;
}

export class SubscriptionRequirementDto {
  @ApiProperty({
    description: 'Telegram chat/channel ID',
    example: '@mychannel',
  })
  chatId: string;

  @ApiProperty({
    description: 'Chat/channel title',
    example: 'My Awesome Channel',
  })
  title: string;

  @ApiProperty({
    description: 'Whether user is subscribed',
    example: true,
  })
  isSubscribed: boolean;

  @ApiPropertyOptional({
    description: 'Invite link to the chat/channel',
    example: 'https://t.me/mychannel',
  })
  inviteLink?: string;
}

export class FreeCaseCooldownDto {
  @ApiProperty({
    description: 'Whether user can open the free case',
    example: true,
  })
  canOpen: boolean;

  @ApiPropertyOptional({
    description: 'Seconds remaining until case can be opened (null if can open)',
    example: 3600,
  })
  secondsRemaining: number | null;

  @ApiPropertyOptional({
    description: 'Time when case was last opened (null if never opened)',
    example: '2025-01-01T00:00:00.000Z',
  })
  lastOpenedAt: Date | null;

  @ApiPropertyOptional({
    description: 'Time when case can be opened next (null if can open now)',
    example: '2025-01-02T00:00:00.000Z',
  })
  nextAvailableAt: Date | null;

  @ApiPropertyOptional({
    description: 'Subscription requirements status (only for free cases)',
    type: [SubscriptionRequirementDto],
  })
  subscriptions?: SubscriptionRequirementDto[];

  @ApiPropertyOptional({
    description: 'Whether all subscription requirements are met',
    example: true,
  })
  allSubscriptionsMet?: boolean;
}
