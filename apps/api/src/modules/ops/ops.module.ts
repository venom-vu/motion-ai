import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NOTIFIER_PORT } from '../../ports/index.js';
import { LogNotifierAdapter } from './log-notifier.adapter.js';
import { ReconcileService } from './reconcile.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    LogNotifierAdapter,
    { provide: NOTIFIER_PORT, useExisting: LogNotifierAdapter },
    ReconcileService,
  ],
  exports: [NOTIFIER_PORT, ReconcileService],
})
export class OpsModule {}
