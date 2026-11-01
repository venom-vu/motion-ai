import { Module } from '@nestjs/common';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { OpsModule } from './modules/ops/index.js';
import { PipelinesModule } from './modules/pipelines/index.js';
import { StorageModule } from './modules/storage/index.js';
import { TasksModule } from './modules/tasks/index.js';
import { TopupsModule } from './modules/topups/index.js';
import { WalletModule } from './modules/wallet/index.js';

@Module({
  imports: [
    AuthModule,
    WalletModule,
    TasksModule,
    PipelinesModule,
    TopupsModule,
    StorageModule,
    OpsModule,
    AuditModule,
  ],
})
export class AppModule {}
