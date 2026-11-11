import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NOTIFIER_PORT } from '../../ports/index.js';
import { createNotifierPort } from './discord-notifier.adapter.js';
import { AlertService } from './alert.service.js';
import { IntakeOpenGuard } from './intake-open.guard.js';
import { SettingsService } from './settings.service.js';
import { ReconcileService } from './reconcile.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    { provide: NOTIFIER_PORT, useFactory: createNotifierPort },
    ReconcileService,
    SettingsService,
    AlertService,
    IntakeOpenGuard,
  ],
  exports: [NOTIFIER_PORT, AlertService, ReconcileService, SettingsService, IntakeOpenGuard],
})
export class OpsModule {}
