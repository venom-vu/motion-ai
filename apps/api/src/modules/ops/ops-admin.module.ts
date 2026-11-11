import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BackupService } from './backup.service.js';
import { BreakerService } from './breaker.service.js';
import { OpsController } from './ops.controller.js';
import { OpsModule } from './ops.module.js';

/** Phần của ops cần TasksService (ngắt mạch, route trạng thái); tách khỏi OpsModule để tránh vòng phụ thuộc. */
@Module({
  imports: [OpsModule, TasksModule, StorageModule, AuthModule, AuditModule],
  controllers: [OpsController],
  providers: [BreakerService, BackupService],
  exports: [BreakerService, BackupService],
})
export class OpsAdminModule {}
