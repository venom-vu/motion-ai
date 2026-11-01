import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppModule } from '../dist/app.module.js';
import { bootstrapApi } from '../dist/main.js';
import { AuditModule } from '../dist/modules/audit/index.js';
import { AuthModule } from '../dist/modules/auth/index.js';
import { OpsModule } from '../dist/modules/ops/index.js';
import { PipelinesModule } from '../dist/modules/pipelines/index.js';
import { StorageModule } from '../dist/modules/storage/index.js';
import { TasksModule } from '../dist/modules/tasks/index.js';
import { TopupsModule } from '../dist/modules/topups/index.js';
import { WalletModule } from '../dist/modules/wallet/index.js';
import {
  NOTIFIER_PORT,
  RUNNING_HUB_PORT,
  STORAGE_PORT,
} from '../dist/ports/index.js';
import { bootstrapWorker } from '../dist/worker.js';

describe('@motion-ai/api skeleton', () => {
  it('creates worker application context with all 8 modules without opening HTTP port', async () => {
    const ctx = await bootstrapWorker();
    assert.ok(ctx);
    assert.ok(ctx.get(AppModule));
    assert.ok(ctx.get(AuthModule));
    assert.ok(ctx.get(WalletModule));
    assert.ok(ctx.get(TasksModule));
    assert.ok(ctx.get(PipelinesModule));
    assert.ok(ctx.get(TopupsModule));
    assert.ok(ctx.get(StorageModule));
    assert.ok(ctx.get(OpsModule));
    assert.ok(ctx.get(AuditModule));
    assert.equal(typeof bootstrapApi, 'function');
    await ctx.close();
  });

  it('defines port tokens for RunningHubPort, StoragePort, NotifierPort', () => {
    assert.equal(typeof RUNNING_HUB_PORT, 'symbol');
    assert.equal(typeof STORAGE_PORT, 'symbol');
    assert.equal(typeof NOTIFIER_PORT, 'symbol');
  });
});
