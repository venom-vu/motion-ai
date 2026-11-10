import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import sharp from 'sharp';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService } from '../dist/modules/tasks/index.js';
import { ShareService } from '../dist/modules/storage/share.service.js';
import { ResultIngestorService } from '../dist/modules/tasks/result-ingestor.js';

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

Queue.prototype.add = async function (name, data, opts) { return { id: opts?.jobId }; };
Queue.prototype.getJob = async function () { return null; };

const OUT_RE = /^out\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const RH_URL = 'https://rh.example.test/out/result.png';

function solid(w, h, fmt, rgb = { r: 200, g: 80, b: 40 }, extra = (s) => s) {
  return extra(sharp({ create: { width: w, height: h, channels: 3, background: rgb } }))[fmt]().toBuffer();
}
/** Ảnh có nhiễu để JPEG/WebP không suy biến. */
function noisy(w, h, fmt) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37) % 251;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[fmt]().toBuffer();
}
const asResponse = (buf, headers = {}) => new Response(buf, { status: 200, headers });

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('Story 4.3: [BE] Kết quả Body Retouch', () => {
  let app, baseUrl, pool, prisma, jwt, svc, ingestor, share;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const saved = {};
  let store, fetchImpl, putCalls;

  const fakeStorage = {
    async getObject(key) {
      const o = store.get(key);
      if (!o) throw new Error(`NoSuchKey ${key}`);
      return o.body;
    },
    async head(key) {
      const o = store.get(key);
      return o ? { sizeBytes: o.body.length, etag: '"e"', contentType: o.contentType } : null;
    },
    async putObject(key, body, contentType) { putCalls++; store.set(key, { body, contentType }); return '"etag"'; },
    async delete(key) { store.delete(key); },
    async presignGet(key, ttl) { return `https://r2.example.test/${key}?X-Amz-Expires=${ttl}`; },
  };
  const outKeys = () => [...store.keys()].filter((k) => k.startsWith('out/'));

  async function newUser() {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `brr-${runId}-${n}`, email: `brr-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    await prisma.$transaction((t) => new WalletService().grant(t, u.id, 5000));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  /** Tạo Task body_retouch qua HTTP; ảnh đầu vào đặt vào kho R2 giả. */
  async function createTask(user, image = null) {
    const uuid = crypto.randomUUID();
    await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` } });
    const imageKey = `in/${user.id}/${uuid}`;
    const res = await fetch(`${baseUrl}/tasks/body-retouch`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ imageKey, intensity: 5 }) });
    assert.equal(res.status, 201);
    const id = (await res.json()).id;
    store.set(imageKey, { body: image ?? (await solid(40, 60, 'png')), contentType: 'image/png' });
    return { id, imageKey, userId: user.id };
  }
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });
  async function runningTask(user, image) {
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    process.env.RH_MAX_CONCURRENT = String((await svc.countGateOccupied()) + 2);
    const t = await createTask(user, image);
    await svc.transition(t.id, 'queued', 'running');
    await pool.query(`UPDATE tasks SET deadline_at = now() + interval '3 minutes' WHERE id=$1`, [t.id]);
    return t;
  }
  const ingest = (t, url = RH_URL, money = 3.6) =>
    ingestor.ingest({ id: t.id, userId: t.userId, pipeline: 'body_retouch' }, url, money, new AbortController().signal);
  /** Chạy ingest rồi trả Task succeeded. */
  async function succeeded(user) {
    const t = await runningTask(user);
    await ingest(t);
    assert.equal((await row(t.id)).status, 'succeeded');
    return t;
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    for (const k of ['RH_OUTPUT_RETRY_MS', 'RH_MAX_CONCURRENT', 'AUTH_THROTTLE_LIMIT', 'SHARE_THROTTLE_LIMIT']) saved[k] = process.env[k];
    process.env.RH_OUTPUT_RETRY_MS = '5';
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.SHARE_THROTTLE_LIMIT = '1000';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    svc = app.get(TasksService);
    ingestor = app.get(ResultIngestorService);
    share = app.get(ShareService);
    store = new Map(); putCalls = 0;
    fetchImpl = async () => asResponse(await solid(40, 60, 'png'));
    svc.storage = fakeStorage;
    share.storage = fakeStorage;
    ingestor.storage = fakeStorage;
    ingestor.fetchFn = async (...a) => fetchImpl(...a);
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (prisma) {
      await pool.query('DELETE FROM share_tokens WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM uploads WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  beforeEach(() => {
    store = new Map(); putCalls = 0;
    fetchImpl = async () => asResponse(await solid(40, 60, 'png'));
  });

  describe('nhập kết quả', () => {
    it('cùng kích thước: succeeded, EXIF đúng, gpu_coins, một CAPTURED, không RELEASED', async () => {
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'succeeded');
      assert.match(r.result_key, OUT_RE);
      assert.ok(r.result_key.startsWith(`out/${u.id}/`));
      assert.equal(r.gpu_coins, 4);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 1);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 0);
      const meta = await sharp(store.get(r.result_key).body).metadata();
      assert.equal(meta.width, 40);
      assert.equal(meta.height, 60);
      const exif = meta.exif ? meta.exif.toString('latin1') : '';
      assert.ok(exif.includes('AI Generator'));
    });

    it('lệch kích thước: failed/OUTPUT_INVALID, một RELEASED, không còn out/', async () => {
      fetchImpl = async () => asResponse(await solid(41, 60, 'png'));
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_INVALID');
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.equal(putCalls, 0);
      assert.deepEqual(outKeys(), []);
    });

    it('ảnh đầu vào EXIF orientation 6, kết quả khớp kích thước sau xoay: succeeded', async () => {
      // 60x40 điểm ảnh + orientation 6 => hiển thị 40x60.
      const input = await sharp(await noisy(60, 40, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      const u = await newUser();
      const t = await runningTask(u, input);
      await ingest(t);
      assert.equal((await row(t.id)).status, 'succeeded');
    });

    it('kết quả tải về có EXIF orientation 6: ảnh lưu đã xoay (40x60), không còn thẻ orientation', async () => {
      const tagged = await sharp(await noisy(60, 40, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      fetchImpl = async () => asResponse(tagged);
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'succeeded');
      const meta = await sharp(store.get(r.result_key).body).metadata();
      assert.equal(meta.width, 40);
      assert.equal(meta.height, 60);
      assert.ok(!meta.orientation || meta.orientation === 1);
      assert.ok(meta.exif && meta.exif.toString('latin1').includes('AI Generator'), 'EXIF Software phải còn sau khi xoay');
    });

    it('ảnh đầu vào EXIF orientation 6, kết quả 60x40 (kích thước thô, chưa xoay): failed/OUTPUT_INVALID', async () => {
      const input = await sharp(await noisy(60, 40, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      fetchImpl = async () => asResponse(await solid(60, 40, 'png'));
      const u = await newUser();
      const t = await runningTask(u, input);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_INVALID');
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.equal(putCalls, 0);
      assert.deepEqual(outKeys(), []);
    });
  });

  describe('GET /tasks/:id/result', () => {
    const get = (id, token) => fetch(`${baseUrl}/tasks/${id}/result`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    it('chủ + succeeded, ảnh gốc còn: resultUrl và sourceUrl là URL ký', async () => {
      const u = await newUser();
      const t = await succeeded(u);
      const r = await row(t.id);
      const res = await get(t.id, u.token);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.resultUrl, `https://r2.example.test/${r.result_key}?X-Amz-Expires=600`);
      assert.equal(body.sourceUrl, `https://r2.example.test/${t.imageKey}?X-Amz-Expires=600`);
    });

    it('ảnh gốc quá hạn (head null): sourceUrl = null, resultUrl hợp lệ', async () => {
      const u = await newUser();
      const t = await succeeded(u);
      store.delete(t.imageKey);
      const body = await (await get(t.id, u.token)).json();
      assert.equal(body.sourceUrl, null);
      assert.ok(body.resultUrl.includes('out/'));
    });

    it('người khác chủ: 404 NOT_FOUND, không URL', async () => {
      const u = await newUser();
      const other = await newUser();
      const t = await succeeded(u);
      const res = await get(t.id, other.token);
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.code, 'NOT_FOUND');
      assert.ok(!JSON.stringify(body).includes('http'));
    });

    for (const status of ['queued', 'running', 'failed']) {
      it(`Task ${status}: 409 CONFLICT`, async () => {
        const u = await newUser();
        await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
        process.env.RH_MAX_CONCURRENT = String((await svc.countGateOccupied()) + 2);
        const t = await createTask(u);
        if (status !== 'queued') await svc.transition(t.id, 'queued', 'running');
        if (status === 'failed') await svc.transition(t.id, 'running', 'failed', 'RH_ERROR');
        const res = await get(t.id, u.token);
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.code, 'CONFLICT');
        assert.ok(!JSON.stringify(body).includes('http'));
      });
    }
  });

  describe('chia sẻ', () => {
    const call = (method, p, user) =>
      fetch(`${baseUrl}${p}`, { method, redirect: 'manual', headers: user ? { Authorization: `Bearer ${user.token}` } : {} });

    it('GET /s/<token>: 302 tới URL ký out/, không lộ ảnh gốc; thu hồi thì 404', async () => {
      const u = await newUser();
      const t = await succeeded(u);
      const r = await row(t.id);
      const created = await call('POST', `/tasks/${t.id}/share`, u);
      assert.equal(created.status, 201);
      const { token } = await created.json();
      const open = await call('GET', `/s/${token}`);
      assert.equal(open.status, 302);
      const loc = open.headers.get('location');
      assert.equal(loc, `https://r2.example.test/${r.result_key}?X-Amz-Expires=300`);
      assert.ok(!loc.includes('in/'));
      assert.ok(!loc.includes(t.imageKey));
      assert.equal((await call('DELETE', `/tasks/${t.id}/share`, u)).status, 200);
      assert.equal((await call('GET', `/s/${token}`)).status, 404);
    });
  });
});
