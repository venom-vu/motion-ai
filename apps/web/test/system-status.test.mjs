import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiErrorCode, MOCK_SYSTEM_STATUS_PAUSED } from '@flowvis/contracts';
import { MotionApiClientError, createMotionApiClient } from '../utils/api-client.ts';
import { isPausedError, resolveIntakePaused } from '../utils/system-status.ts';

describe('Story 6.9 - trạng thái hệ thống', () => {
  it('getSystemStatus parse phản hồi', async () => {
    const client = createMotionApiClient({
      baseUrl: 'http://t.example',
      fetchImpl: async () => new Response(JSON.stringify(MOCK_SYSTEM_STATUS_PAUSED), { status: 200 }),
    });
    assert.deepEqual(await client.getSystemStatus(), { intakePaused: true });
  });
  it('lỗi mạng giữ trạng thái trước', async () => {
    const fail = async () => { throw new Error('net'); };
    assert.equal(await resolveIntakePaused(fail, false), false);
    assert.equal(await resolveIntakePaused(fail, true), true);
  });
  it('bình thường và tạm dừng', async () => {
    assert.equal(await resolveIntakePaused(async () => ({ intakePaused: true }), false), true);
    assert.equal(await resolveIntakePaused(async () => ({ intakePaused: false }), true), false);
  });
  it('503 PAUSED nhận diện được', () => {
    assert.ok(isPausedError(new MotionApiClientError({ status: 503, code: ApiErrorCode.PAUSED })));
    assert.ok(!isPausedError(new MotionApiClientError({ status: 500, code: 'INTERNAL' })));
  });
});
