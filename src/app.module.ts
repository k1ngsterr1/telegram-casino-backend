import { Module } from '@nestjs/common';
import { SharedModule } from './shared/shared.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { UserModule } from './user/user.module';
import { AdminUserModule } from './admin/user/admin-user.module';
import { AdminPrizeModule } from './admin/prize/admin-prize.module';
import { AdminCaseModule } from './admin/case/admin-case.module';
import { AdminAviatorModule } from './admin/aviator/admin-aviator.module';
import { AdminStatisticsModule } from './admin/statistics/admin-statistics.module';
import { AdminUpgradeModule } from './admin/upgrade/admin-upgrade.module';
import { CaseModule } from './case/case.module';
import { UpgradeModule } from './upgrade/upgrade.module';
import { WebsocketModule } from './websocket/websocket.module';
import { SystemModule } from './system/system.module';
import { PaymentModule } from './payment/payment.module';
import { AuthModule } from './auth/auth.module';
import { UploadModule } from './upload/upload.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { GiftModule } from './gift/gift.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    ScheduleModule.forRoot(),
    SharedModule,
    // AuthModule,
    // UserModule,
    // AdminUserModule,
    // AdminPrizeModule,
    // AdminCaseModule,
    // AdminAviatorModule,
    // AdminStatisticsModule,
    // AdminUpgradeModule,
    // CaseModule,
    // UpgradeModule,
    // WebsocketModule,
    // SystemModule,
    // PaymentModule,
    // UploadModule,
    // LeaderboardModule,
    // GiftModule,
  ],
})
export class AppModule {}
