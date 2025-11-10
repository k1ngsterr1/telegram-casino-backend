import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class UpdateServerSeedDto {
  @ApiProperty({
    description: 'New server seed (64 hex characters)',
    example: 'a3f8b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
  })
  @IsString()
  @Length(64, 64, { message: 'Server seed must be exactly 64 hex characters' })
  serverSeed: string;
}
