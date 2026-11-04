import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { S3StorageAdapter } from '../dist/modules/storage/index.js';
import { StoragePreconditionFailedError } from '../dist/ports/index.js';

function adapterWith(send) {
  const a = new S3StorageAdapter();
  a.client = { send };
  return a;
}

describe('S3StorageAdapter (client giả)', () => {
  it('head: NotFound/404 -> null, thành công -> size + etag', async () => {
    const byName = adapterWith(async () => { throw Object.assign(new Error('x'), { name: 'NotFound' }); });
    assert.equal(await byName.head('k'), null);
    const byStatus = adapterWith(async () => { throw Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }); });
    assert.equal(await byStatus.head('k'), null);
    const ok = adapterWith(async () => ({ ContentLength: 5, ETag: '"e"' }));
    assert.deepEqual(await ok.head('k'), { sizeBytes: 5, etag: '"e"', contentType: undefined });
    const boom = adapterWith(async () => { throw new Error('boom'); });
    await assert.rejects(boom.head('k'), /boom/);
  });

  it('putObject trả ETag của phản hồi', async () => {
    const a = adapterWith(async () => ({ ETag: '"abc"' }));
    assert.equal(await a.putObject('k', Buffer.from('x'), 'image/png'), '"abc"');
  });

  it('copyIfMatch: 412/PreconditionFailed -> lỗi riêng, mã hóa CopySource', async () => {
    process.env.R2_BUCKET = 'bkt';
    let input;
    const a = adapterWith(async (cmd) => { input = cmd.input; });
    await a.copyIfMatch('in-raw/u 1/a+b', 'in/u/x', '"e"');
    assert.equal(input.CopySource, 'bkt/in-raw/u%201/a%2Bb');
    assert.equal(input.CopySourceIfMatch, '"e"');
    assert.equal(input.Key, 'in/u/x');
    const byName = adapterWith(async () => { throw Object.assign(new Error('x'), { name: 'PreconditionFailed' }); });
    await assert.rejects(byName.copyIfMatch('a', 'b', 'e'), StoragePreconditionFailedError);
    const byStatus = adapterWith(async () => { throw Object.assign(new Error('x'), { $metadata: { httpStatusCode: 412 } }); });
    await assert.rejects(byStatus.copyIfMatch('a', 'b', 'e'), StoragePreconditionFailedError);
    const other = adapterWith(async () => { throw new Error('boom'); });
    await assert.rejects(other.copyIfMatch('a', 'b', 'e'), /boom/);
  });

  it('presignPut ký content-length và content-type', async () => {
    Object.assign(process.env, {
      R2_ENDPOINT: 'https://r2.example.test',
      R2_ACCESS_KEY_ID: 'AKIATEST',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bkt',
    });
    const r = await new S3StorageAdapter().presignPut({
      key: 'in-raw/u/x',
      contentType: 'image/jpeg',
      contentLength: 1234,
      expiresInSeconds: 600,
    });
    const u = new URL(r.url);
    const signed = u.searchParams.get('X-Amz-SignedHeaders').split(';');
    assert.ok(signed.includes('content-length'), signed.join());
    assert.ok(signed.includes('content-type'), signed.join());
    assert.equal(u.searchParams.get('X-Amz-Expires'), '600');
    assert.equal(r.headers['Content-Type'], 'image/jpeg');
  });
});
