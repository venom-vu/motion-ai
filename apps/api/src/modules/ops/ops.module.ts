import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NOTIFIER_PORT } from '../../ports/index.js';
import { createNotifierPort } from './discord-notifier.adapter.js';
import { ReconcileService } from './reconcile.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    { provide: NOTIFIER_PORT, useFactory: createNotifierPort },
    ReconcileService,
  ],
  exports: [NOTIFIER_PORT, ReconcileService],
})
export class OpsModule {}
