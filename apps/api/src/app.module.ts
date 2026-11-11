import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { InfraModule } from './infra/index.js';
import { AdminUsersModule } from './modules/admin-users/admin-users.module.js';
import { AdminStatsModule } from './modules/admin-stats/admin-stats.module.js';
import { AdminTasksModule } from './modules/admin-tasks/admin-tasks.module.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { OpsModule } from './modules/ops/index.js';
import { OpsAdminModule } from './modules/ops/ops-admin.module.js';
import { PipelinesModule } from './modules/pipelines/index.js';
import { StorageModule } from './modules/storage/index.js';
import { TasksModule } from './modules/tasks/index.js';
import { TopupsModule } from './modules/topups/index.js';
import { WalletModule } from './modules/wallet/index.js';

@Module({
  imports: [
    InfraModule,
    AuthModule,
    WalletModule,
    TasksModule,
    PipelinesModule,
    TopupsModule,
    StorageModule,
    OpsModule,
    OpsAdminModule,
    AuditModule,
    AdminUsersModule,
    AdminTasksModule,
    AdminStatsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
