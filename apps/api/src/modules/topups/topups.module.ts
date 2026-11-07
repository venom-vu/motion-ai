import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { TopupNotifierService } from './topup-notifier.service.js';
import { TopupsController } from './topups.controller.js';
import { TopupSweeperService } from './topup-sweeper.service.js';
import { TopupsService } from './topups.service.js';

@Module({
  imports: [AuthModule, OpsModule, ScheduleModule.forRoot()],
  controllers: [TopupsController],
  providers: [TopupsService, TopupNotifierService, TopupSweeperService],
  exports: [TopupsService],
})
export class TopupsModule {}
