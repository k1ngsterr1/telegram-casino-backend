import { forwardRef, Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { CronService } from './services/cron.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { BotService } from './services/bot.service';
import { ConfigService } from '@nestjs/config';
import { ReferralService } from './services/referral.service';
import { GiftService } from './services/gift.service';
import { TelegramUserbotService } from './services/telegram-userbot.service';
import { ScheduleModule } from '@nestjs/schedule';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    PrismaService,
    BotService,
    CronService,
    JwtStrategy,
    ReferralService,
    GiftService,
    TelegramUserbotService,
  ],
  exports: [
    PrismaService,
    BotService,
    CronService,
    JwtStrategy,
    JwtModule,
    ReferralService,
    GiftService,
    TelegramUserbotService,
  ],
})
export class SharedModule {}
