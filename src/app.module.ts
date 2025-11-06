import { Module } from '@nestjs/common';
import { SharedModule } from './shared/shared.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    ScheduleModule.forRoot(),
    SharedModule,
    UserModule,
  ],
})
export class AppModule {}
