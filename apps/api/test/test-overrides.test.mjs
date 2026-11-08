import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { isPublicHttpUrl } from '../dist/modules/tasks/result-ingestor.js';
import { deadlineMs } from '../dist/modules/tasks/task-worker.service.js';
import { createRunningHubPort, RunningHubHttpAdapter } from '../dist/modules/tasks/runninghub-http.adapter.js';
import { UnconfiguredRunningHubAdapter } from '../dist/modules/tasks/runninghub-unconfigured.adapter.js';
import { qrTtlMs, topupClock } from '../dist/modules/topups/topups.service.js';
import { topupSweepIntervalMs } from '../dist/modules/topups/topup-sweeper.service.js';
import { createR2Client } from '../dist/modules/storage/s3-storage.adapter.js';

const KEYS = ['NODE_ENV', 'TOPUP_QR_TTL_MS', 'TOPUP_FAKE_NOW', 'TOPUP_SWEEP_INTERVAL', 'RH_DEADLINE_MS', 'RESULT_URL_ALLOW_HOSTS', 'RUNNINGHUB_BASE_URL', 'R2_ENDPOINT', 'R2_ACCOUNT_ID'];
const URL_TEST = 'http://host.docker.internal:3197/files/result.png';

describe('Story 2.14: biến ghi đè kiểm thử chỉ có tác dụng khi NODE_ENV=test', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.RH_DEADLINE_MS = '3000';
    process.env.RESULT_URL_ALLOW_HOSTS = 'host.docker.internal';
    process.env.RUNNINGHUB_BASE_URL = 'http://host.docker.internal:3197';
    process.env.R2_ENDPOINT = 'http://host.docker.internal:3198';
    process.env.R2_ACCOUNT_ID = 'acc';
    process.env.TOPUP_QR_TTL_MS = '5000';
    process.env.TOPUP_FAKE_NOW = '2030-01-01T16:30:00.000Z';
    process.env.TOPUP_SWEEP_INTERVAL = '1000';
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('NODE_ENV=test: các ghi đè có hiệu lực', async () => {
    process.env.NODE_ENV = 'test';
    assert.equal(deadlineMs(), 3000);
    assert.equal(qrTtlMs(), 5000);
    assert.equal(topupClock().toISOString(), '2030-01-01T16:30:00.000Z');
    assert.equal(topupSweepIntervalMs(), 1000);
    assert.equal(isPublicHttpUrl(URL_TEST), true);
    assert.equal(isPublicHttpUrl('http://127.0.0.1/a'), false, 'chỉ host được liệt kê mới được phép');
    assert.ok(createRunningHubPort() instanceof RunningHubHttpAdapter);
    const c = createR2Client();
    assert.equal((await c.config.endpoint()).hostname, 'host.docker.internal');
    assert.equal(c.config.forcePathStyle, true);
  });

  for (const env of ['production', undefined, 'development']) {
    it(`NODE_ENV=${env}: các ghi đè bị bỏ qua`, async () => {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      assert.equal(deadlineMs(), 180_000);
      assert.equal(qrTtlMs(), 15 * 60 * 1000);
      assert.ok(Math.abs(topupClock().getTime() - Date.now()) < 5000, 'TOPUP_FAKE_NOW bị bỏ qua');
      assert.equal(topupSweepIntervalMs(), 30_000);
      assert.equal(isPublicHttpUrl(URL_TEST), false);
      assert.ok(createRunningHubPort() instanceof UnconfiguredRunningHubAdapter);
      const c = createR2Client();
      // R2_ENDPOINT luôn được tôn trọng (ghi đè production tùy chọn); chỉ forcePathStyle bị khóa theo test.
      assert.equal((await c.config.endpoint()).hostname, 'host.docker.internal');
      assert.ok(!c.config.forcePathStyle);
    });
  }
});
