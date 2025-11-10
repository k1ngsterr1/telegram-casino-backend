import { Module } from '@nestjs/common';
import { AdminAviatorController } from './admin-aviator.controller';
import { AviatorService } from './aviator.service';

@Module({
  controllers: [AdminAviatorController],
  providers: [AviatorService],
  exports: [AviatorService],
})
export class AdminAviatorModule {}
