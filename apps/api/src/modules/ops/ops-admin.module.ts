import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { BreakerService } from './breaker.service.js';
import { OpsController } from './ops.controller.js';
import { OpsModule } from './ops.module.js';

/** Phần của ops cần TasksService (ngắt mạch, route trạng thái); tách khỏi OpsModule để tránh vòng phụ thuộc. */
@Module({
  imports: [OpsModule, TasksModule, AuthModule, AuditModule],
  controllers: [OpsController],
  providers: [BreakerService],
  exports: [BreakerService],
})
export class OpsAdminModule {}
