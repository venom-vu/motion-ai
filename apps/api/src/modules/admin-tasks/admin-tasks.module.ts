import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AdminTasksController } from './admin-tasks.controller.js';
import { AdminTasksService } from './admin-tasks.service.js';

@Module({
  imports: [AuthModule, TasksModule, StorageModule, AuditModule],
  controllers: [AdminTasksController],
  providers: [AdminTasksService],
})
export class AdminTasksModule {}
