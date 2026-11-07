import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { TopupNotifierService } from './topup-notifier.service.js';
import { AdminTopupsController } from './admin-topups.controller.js';
import { TopupsController } from './topups.controller.js';
import { TopupSweeperService } from './topup-sweeper.service.js';
import { TopupsService } from './topups.service.js';

@Module({
  imports: [AuthModule, OpsModule, WalletModule, AuditModule, ScheduleModule.forRoot()],
  controllers: [TopupsController, AdminTopupsController],
  providers: [TopupsService, TopupNotifierService, TopupSweeperService],
  exports: [TopupsService],
})
export class TopupsModule {}
