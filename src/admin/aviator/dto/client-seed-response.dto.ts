import { ApiProperty } from '@nestjs/swagger';

export class ClientSeedResponseDto {
  @ApiProperty({
    description: 'Client seed (32 hex characters)',
    example: 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
  })
  clientSeed: string;

  @ApiProperty({
    description: 'Timestamp of generation',
    example: '2025-11-10T12:00:00.000Z',
  })
  timestamp: string;
}
