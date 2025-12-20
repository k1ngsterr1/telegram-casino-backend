import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsString,
  IsOptional,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SubscriptionItemDto {
  @ApiProperty({
    description: 'Telegram chat/channel ID (username like @channelname or numeric ID)',
    example: '@mychannel',
  })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'Display title for the chat/channel',
    example: 'My Awesome Channel',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({
    description: 'Invite link to the chat/channel',
    example: 'https://t.me/mychannel',
  })
  @IsString()
  @IsOptional()
  inviteLink?: string;
}

export class UpdateSubscriptionsDto {
  @ApiProperty({
    description: 'Array of subscription requirements for free case',
    type: [SubscriptionItemDto],
    example: [
      {
        chatId: '@mychannel',
        title: 'My Channel',
        inviteLink: 'https://t.me/mychannel',
      },
      {
        chatId: '-1001234567890',
        title: 'My Group',
        inviteLink: 'https://t.me/+abcd1234',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionItemDto)
  subscriptions: SubscriptionItemDto[];
}

export class SubscriptionResponseDto {
  @ApiProperty({
    description: 'Telegram chat/channel ID',
    example: '@mychannel',
  })
  chatId: string;

  @ApiProperty({
    description: 'Display title for the chat/channel',
    example: 'My Awesome Channel',
  })
  title: string;

  @ApiPropertyOptional({
    description: 'Invite link to the chat/channel',
    example: 'https://t.me/mychannel',
  })
  inviteLink?: string;

  @ApiPropertyOptional({
    description: 'Chat info from Telegram (if available)',
  })
  chatInfo?: {
    id: number;
    title?: string;
    type: string;
    username?: string;
  };
}

export class VerifySubscriptionDto {
  @ApiProperty({
    description: 'Telegram chat/channel ID to verify',
    example: '@mychannel',
  })
  @IsString()
  @IsNotEmpty()
  chatId: string;
}
