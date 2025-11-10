import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({
    description: 'Admin login',
    example: 'admin',
  })
  @IsString()
  login: string;

  @ApiProperty({
    description: 'Admin password',
    example: 'password123',
  })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({
    description: 'Admin telegram ID',
    example: '123456789',
  })
  @IsString()
  telegramId: string;
}
