import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { AdminWebsocketController } from './admin-websocket.controller';
import { AviatorService } from '../admin/aviator/aviator.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AdminWebsocketController],
  providers: [WebsocketGateway, AviatorService],
  exports: [WebsocketGateway, AviatorService],
})
export class WebsocketModule {}
