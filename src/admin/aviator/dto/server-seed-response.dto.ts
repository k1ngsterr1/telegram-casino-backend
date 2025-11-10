import { ApiProperty } from '@nestjs/swagger';

export class ServerSeedResponseDto {
  @ApiProperty({
    description: 'Current server seed',
    example: 'a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
  })
  serverSeed: string;

  @ApiProperty({
    description: 'Timestamp of retrieval',
    example: '2025-11-10T12:00:00.000Z',
  })
  timestamp: string;
}
