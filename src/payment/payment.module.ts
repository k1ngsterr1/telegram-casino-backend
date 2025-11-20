import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { TonService } from './services/ton.service';

@Module({
  providers: [PaymentService, TonService],
  controllers: [PaymentController],
})
export class PaymentModule {}
