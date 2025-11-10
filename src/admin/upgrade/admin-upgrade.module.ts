import { Module } from '@nestjs/common';
import { AdminUpgradeController } from './admin-upgrade.controller';
import { AdminUpgradeService } from './admin-upgrade.service';

@Module({
  controllers: [AdminUpgradeController],
  providers: [AdminUpgradeService],
})
export class AdminUpgradeModule {}
