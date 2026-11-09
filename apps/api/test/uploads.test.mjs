import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import sharp from 'sharp';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { S3StorageAdapter } from '../dist/modules/storage/index.js';
import { UploadsExpiryService, UploadsService } from '../dist/modules/storage/index.js';
import { StoragePreconditionFailedError } from '../dist/ports/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function tcp(host, port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(1000);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host);
  });
}

async function ensureInfra() {
  const u = new URL(DB_URL);
  const r = new URL(REDIS_URL);
  const services = [];
  if (!(await tcp(u.hostname || 'localhost', Number(u.port || 5432)))) services.push('postgres-16');
  if (!(await tcp(r.hostname || 'localhost', Number(r.port || 6379)))) services.push('redis-7');
  if (services.length) {
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d', '--wait', ...services], {
      cwd: repoRoot, stdio: 'inherit',
    });
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit',
  });
}

/** StoragePort giả trong bộ nhớ: gắn đè lên prototype của adapter S3. */
class FakeStorage {
  objects = new Map();
  etagBump = false; // mô phỏng ETag đổi giữa HEAD và Copy
  calls = [];
  etag(buf) { return `"${crypto.createHash('md5').update(buf).digest('hex')}"`; }
  async presignPut(input) {
    this.calls.push(['presignPut', input]);
    return {
      url: `https://r2.example.test/${input.key}?sig=x&len=${input.contentLength}`,
      headers: { 'Content-Type': input.contentType },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }
  async head(key) {
    this.calls.push(['head', key]);
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.length, etag: this.etag(o) } : null;
  }
  async getObject(key) { this.calls.push(['getObject', key]); return this.objects.get(key); }
  async putObject(key, body) { this.calls.push(['putObject', key]); this.objects.set(key, body); return this.etag(body); }
  async copyIfMatch(src, dst, etag) {
    this.calls.push(['copy', src, dst]);
    const o = this.objects.get(src);
    if (this.etagBump || !o || this.etag(o) !== etag) throw new StoragePreconditionFailedError();
    this.objects.set(dst, o);
  }
  async delete(key) { this.calls.push(['delete', key]); this.objects.delete(key); }
}

const fake = new FakeStorage();
for (const m of ['presignPut', 'head', 'getObject', 'putObject', 'copyIfMatch', 'delete']) {
  S3StorageAdapter.prototype[m] = function (...a) { return fake[m](...a); };
}

async function img(w, h, format = 'jpeg') {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } })[format]().toBuffer();
}

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';

describe('Story 2.2: [BE] Tải ảnh lên R2 an toàn', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];

  async function newUser() {
    const n = users.length;
    const u = await prisma.user.create({
      data: { googleId: `up-${runId}-${n}`, email: `up-${runId}-${n}@flowvis.vn`, tosVersion: 't' },
    });
    users.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  const post = (user, p, body) =>
    fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  async function createUpload(user, buf, mimeType = 'image/jpeg', declared = buf.length) {
    const res = await post(user, '/uploads', { mimeType, sizeBytes: declared });
    assert.equal(res.status, 201);
    const json = await res.json();
    fake.objects.set(json.key, buf);
    return json;
  }
  const confirm = (user, key) => post(user, `/uploads/${encodeURIComponent(key)}/confirm`);

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
  });

  after(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('migration: CHECK kind/status và key unique', async () => {
    const u = await newUser();
    const ins = (kind, status, key) =>
      pool.query(
        `INSERT INTO uploads (user_id, key, kind, status, mime_type, declared_bytes) VALUES ($1,$2,$3,$4,'image/jpeg',1)`,
        [u.id, key, kind, status],
      );
    await assert.rejects(ins('audio', 'pending', `k-${runId}-1`), /uploads_kind_valid_chk/);
    await assert.rejects(ins('image', 'done', `k-${runId}-2`), /uploads_status_valid_chk/);
    await ins('image', 'pending', `k-${runId}-3`);
    await assert.rejects(ins('image', 'pending', `k-${runId}-3`), /uploads_key_key/);
  });

  it('cần đăng nhập', async () => {
    const res = await fetch(`${baseUrl}/uploads`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('tạo URL hợp lệ', async () => {
    const u = await newUser();
    const res = await post(u, '/uploads', { mimeType: 'image/jpeg', sizeBytes: 2 * 1024 * 1024 });
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.match(j.key, new RegExp(`^in-raw/${u.id}/[0-9a-f-]{36}$`));
    assert.equal(j.method, 'PUT');
    const call = fake.calls.filter((c) => c[0] === 'presignPut').at(-1)[1];
    assert.equal(call.contentLength, 2 * 1024 * 1024);
    assert.equal(call.expiresInSeconds, 600);
    const rows = await prisma.upload.findMany({ where: { userId: u.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
  });

  it('khai báo sai không cấp URL, không ghi bản ghi', async () => {
    const u = await newUser();
    for (const body of [
      { mimeType: 'image/gif', sizeBytes: 100 },
      { mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 },
    ]) {
      const res = await post(u, '/uploads', body);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, 'VALIDATION_FAILED');
    }
    assert.equal(await prisma.upload.count({ where: { userId: u.id } }), 0);
  });

  it('lần thứ 11 bị từ chối; pending quá 24h hết hạn thì tạo tiếp được', async () => {
    const u = await newUser();
    for (let i = 0; i < 10; i++) {
      assert.equal((await post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 })).status, 201);
    }
    const res = await post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.code, 'VALIDATION_FAILED');
    assert.match(j.message, /tạm/);

    await pool.query(
      `UPDATE uploads SET created_at = now() - interval '25 hours' WHERE id IN (SELECT id FROM uploads WHERE user_id=$1 LIMIT 1)`,
      [u.id],
    );
    // Bản ghi quá 24h không còn được tính ngay cả trước khi job chạy.
    assert.equal((await post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 })).status, 201);
    const n = await app.get(UploadsService).expireStalePending();
    assert.ok(n >= 1);
    const expired = await prisma.upload.count({ where: { userId: u.id, status: 'expired' } });
    assert.equal(expired, 1);
  });

  it('hai request song song không vượt giới hạn', async () => {
    const u = await newUser();
    for (let i = 0; i < 8; i++) await post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 });
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 })),
    );
    const ok = rs.filter((r) => r.status === 201).length;
    assert.equal(ok, 2);
    assert.equal(await prisma.upload.count({ where: { userId: u.id, status: 'pending' } }), 10);
  });

  it('confirm hợp lệ', async () => {
    const u = await newUser();
    const buf = await img(1000, 800);
    const up = await createUpload(u, buf);
    const res = await confirm(u, up.key);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.key, up.key.replace('in-raw/', 'in/'));
    assert.equal(j.image.width, 1000);
    assert.ok(fake.objects.has(j.key));
    const row = await prisma.upload.findUnique({ where: { key: up.key } });
    assert.equal(row.status, 'confirmed');
    assert.equal(row.sizeBytes, buf.length);
    assert.ok(row.etag && row.confirmedAt);
    assert.equal(row.width, 1000);
    assert.equal(row.height, 800);
    assert.equal(row.durationSeconds, null);
    // Confirm lặp
    const again = await confirm(u, up.key);
    assert.equal(again.status, 409);
  });

  it('ảnh lớn được resize về 2048 trước khi copy', async () => {
    const u = await newUser();
    const up = await createUpload(u, await img(4000, 3000));
    const res = await confirm(u, up.key);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.image.width, 2048);
    assert.equal(j.image.height, 1536);
    const meta = await sharp(fake.objects.get(j.key)).metadata();
    assert.equal(meta.width, 2048);
    const row = await prisma.upload.findUnique({ where: { key: up.key } });
    assert.equal([row.width, row.height].join('x'), '2048x1536');
    assert.equal(row.sizeBytes, fake.objects.get(j.key).length);
  });

  it('khóa của người khác và khóa lạ', async () => {
    const a = await newUser();
    const b = await newUser();
    const up = await createUpload(a, await img(800, 800));
    fake.calls.length = 0;
    const res = await confirm(b, up.key);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'FORBIDDEN');
    assert.equal(fake.calls.filter((c) => c[0] !== 'presignPut').length, 0);
    const ghost = `in-raw/${b.id}/${crypto.randomUUID()}`;
    const nf = await confirm(b, ghost);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).code, 'NOT_FOUND');
  });

  it('ảnh không hợp lệ bị xóa và bản ghi expired', async () => {
    const u = await newUser();
    const cases = {
      sizeMismatch: async () => createUpload(u, await img(800, 800), 'image/jpeg', (await img(800, 800)).length + 5),
      notImage: async () => createUpload(u, Buffer.from('hello world not an image'), 'image/png'),
      shortSide: async () => createUpload(u, await img(400, 600)),
      ratio: async () => createUpload(u, await img(1500, 600)),
    };
    for (const [name, mk] of Object.entries(cases)) {
      const up = await mk();
      const res = await confirm(u, up.key);
      assert.equal(res.status, 400, name);
      assert.equal((await res.json()).code, 'VALIDATION_FAILED', name);
      assert.equal(fake.objects.has(up.key), false, `${name}: đã xóa in-raw`);
      assert.equal(fake.objects.has(up.key.replace('in-raw/', 'in/')), false);
      const row = await prisma.upload.findUnique({ where: { key: up.key } });
      assert.equal(row.status, 'expired', name);
    }
  });

  it('ETag đổi giữa HEAD và Copy: CONFLICT, không có khóa in/', async () => {
    const u = await newUser();
    const up = await createUpload(u, await img(800, 800));
    fake.etagBump = true;
    try {
      const res = await confirm(u, up.key);
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'CONFLICT');
    } finally {
      fake.etagBump = false;
    }
    assert.equal(fake.objects.has(up.key.replace('in-raw/', 'in/')), false);
    const row = await prisma.upload.findUnique({ where: { key: up.key } });
    assert.equal(row.status, 'pending');
  });

  it('ảnh có orientation 6 được xoay đúng khi resize (4000x3000 -> 1536x2048)', async () => {
    const u = await newUser();
    const buf = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#808080' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const up = await createUpload(u, buf);
    const res = await confirm(u, up.key);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.image.width, 1536);
    assert.equal(j.image.height, 2048);
    const meta = await sharp(fake.objects.get(j.key)).metadata();
    assert.equal(`${meta.width}x${meta.height}`, '1536x2048');
  });

  it('scheduledExpire chỉ chạy ở worker', async () => {
    const u = await newUser();
    await post(u, '/uploads', { mimeType: 'image/png', sizeBytes: 10 });
    await pool.query(`UPDATE uploads SET created_at = now() - interval '25 hours' WHERE user_id=$1`, [u.id]);
    const svc = app.get(UploadsExpiryService);
    const prev = process.env.MOTION_PROCESS_ROLE;
    try {
      process.env.MOTION_PROCESS_ROLE = 'api';
      await svc.scheduledExpire();
      assert.equal(await prisma.upload.count({ where: { userId: u.id, status: 'pending' } }), 1);
      process.env.MOTION_PROCESS_ROLE = 'worker';
      await svc.scheduledExpire();
      assert.equal(await prisma.upload.count({ where: { userId: u.id, status: 'expired' } }), 1);
    } finally {
      if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prev;
    }
  });

  it('confirm trước khi PUT: 400 VALIDATION_FAILED, bản ghi vẫn pending', async () => {
    const u = await newUser();
    const r = await post(u, '/uploads', { mimeType: 'image/jpeg', sizeBytes: 100 });
    const { key } = await r.json();
    const res = await confirm(u, key);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'VALIDATION_FAILED');
    const row = await prisma.upload.findUnique({ where: { key } });
    assert.equal(row.status, 'pending');
  });

  it('hai confirm song song cùng khóa: một 200, một 409', async () => {
    const u = await newUser();
    const up = await createUpload(u, await img(800, 800));
    const rs = await Promise.all([confirm(u, up.key), confirm(u, up.key)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  });
});
