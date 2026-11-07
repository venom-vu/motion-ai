import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module.js';
import { TopupsController } from './topups.controller.js';
import { TopupSweeperService } from './topup-sweeper.service.js';
import { TopupsService } from './topups.service.js';

@Module({
  imports: [AuthModule, ScheduleModule.forRoot()],
  controllers: [TopupsController],
  providers: [TopupsService, TopupSweeperService],
  exports: [TopupsService],
})
export class TopupsModule {}
