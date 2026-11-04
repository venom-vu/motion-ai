import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { TasksController } from './tasks.controller.js';
import { TASKS_QUEUE, TasksService } from './tasks.service.js';

@Module({
  imports: [
    AuthModule,
    WalletModule,
    StorageModule,
    BullModule.registerQueue({ name: TASKS_QUEUE }),
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
