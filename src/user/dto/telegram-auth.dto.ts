import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramAuthDto {
  @ApiProperty({
    description: 'Telegram Web App initData string',
    example:
      'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A99281932%2C%22first_name%22%3A%22Andrew%22%2C%22last_name%22%3A%22Rogue%22%2C%22username%22%3A%22rogue%22%2C%22language_code%22%3A%22en%22%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2',
  })
  @IsString()
  @IsNotEmpty()
  initData: string;
}
