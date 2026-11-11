import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RESULT_INGESTOR, RUNNING_HUB_PORT } from '../../ports/index.js';
import { PipelinesModule } from '../pipelines/index.js';
import { AuthModule } from '../auth/auth.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { ResultIngestorService } from './result-ingestor.js';
import { createRunningHubPort } from './runninghub-http.adapter.js';
import { UnconfiguredRunningHubAdapter } from './runninghub-unconfigured.adapter.js';
import { RhBalanceService } from './rh-balance.service.js';
import { TaskSweeperService } from './task-sweeper.service.js';
import { TaskWorkerService } from './task-worker.service.js';
import { TasksController } from './tasks.controller.js';
import { TASKS_QUEUE, TasksService } from './tasks.service.js';

@Module({
  imports: [
    AuthModule,
    WalletModule,
    StorageModule,
    OpsModule,
    PipelinesModule,
    BullModule.registerQueue({ name: TASKS_QUEUE }),
    ScheduleModule.forRoot(),
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    UnconfiguredRunningHubAdapter,
    ResultIngestorService,
    { provide: RUNNING_HUB_PORT, useFactory: createRunningHubPort },
    { provide: RESULT_INGESTOR, useExisting: ResultIngestorService },
    TaskWorkerService,
    TaskSweeperService,
    RhBalanceService,
  ],
  exports: [TasksService],
})
export class TasksModule {}
