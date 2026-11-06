import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import sharp from 'sharp';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService, TaskWorkerService } from '../dist/modules/tasks/index.js';
import { ResultIngestorService } from '../dist/modules/tasks/result-ingestor.js';
import { PIPELINE_CONFIGS } from '../dist/modules/pipelines/pipeline-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/motion_ai?schema=public';
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

describe('Story 2.6: [BE] Nhập kết quả về R2 và chốt tiền', () => {
  let app, baseUrl, pool, prisma, jwt, svc, worker, ingestor;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const saved = {};

  // Kho R2 giả
  let store, putCalls, deleteCalls, putImpl, putSignals, getSignals;
  // fetch giả
  let fetchCalls, fetchImpl, outputsQueue;

  function reset() {
    store = new Map();
    putCalls = 0; deleteCalls = []; putSignals = []; getSignals = [];
    putImpl = null;
    fetchCalls = 0;
    fetchImpl = async () => asResponse(await solid(40, 60, 'png'));
    outputsQueue = [{ status: 'SUCCESS', fileUrl: RH_URL, consumeMoney: 3.6 }];
  }
  const fakeStorage = {
    async getObject(key, signal) {
      getSignals.push(signal);
      const o = store.get(key);
      if (!o) throw new Error(`NoSuchKey ${key}`);
      return o.body;
    },
    async head(key) {
      const o = store.get(key);
      return o ? { sizeBytes: o.body.length, etag: '"e"', contentType: o.contentType } : null;
    },
    async putObject(key, body, contentType, signal) {
      putCalls++;
      putSignals.push(signal);
      if (putImpl) await putImpl(key, body, contentType);
      store.set(key, { body, contentType });
      return '"etag"';
    },
    async delete(key) { deleteCalls.push(key); store.delete(key); },
    async presignGet(key, ttl) { return `https://r2.example.test/${key}?X-Amz-Expires=${ttl}`; },
  };
  const outKeys = () => [...store.keys()].filter((k) => k.startsWith('out/'));

  async function newUser(balance = 5000) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `r-${runId}-${n}`, email: `r-${runId}-${n}@motionai.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    await prisma.$transaction((t) => new WalletService().grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  /** Tạo Task Face Swap qua HTTP; ảnh đích mặc định 40x60 được đặt vào kho R2 giả. */
  async function createTask(user, { target = null } = {}) {
    const keys = [];
    for (let i = 0; i < 2; i++) {
      const uuid = crypto.randomUUID();
      await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` } });
      keys.push(`in/${user.id}/${uuid}`);
    }
    const res = await fetch(`${baseUrl}/tasks/face-swap`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: keys[0], targetKey: keys[1], consent: true }) });
    assert.equal(res.status, 201);
    const id = (await res.json()).id;
    store.set(keys[0], { body: await solid(30, 30, 'png'), contentType: 'image/png' });
    store.set(keys[1], { body: target ?? (await solid(40, 60, 'png')), contentType: 'image/png' });
    return { id, sourceKey: keys[0], targetKey: keys[1], userId: user.id };
  }
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });
  async function clearGate() {
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    await pool.query(`UPDATE tasks SET rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND rh_orphan_until IS NOT NULL`, [users]);
    process.env.RH_MAX_CONCURRENT = String((await svc.countGateOccupied()) + 2);
  }
  /** Task đang running với deadline_at còn hạn, sẵn sàng cho ingest trực tiếp. */
  async function runningTask(user, opts) {
    const t = await createTask(user, opts);
    await svc.transition(t.id, 'queued', 'running');
    await pool.query(`UPDATE tasks SET deadline_at = now() + interval '3 minutes' WHERE id=$1`, [t.id]);
    return t;
  }
  const ingestArgs = (t) => ({ id: t.id, userId: t.userId, pipeline: 'face_swap' });
  const ingest = (t, url = RH_URL, money = 3.6, signal = new AbortController().signal) =>
    ingestor.ingest(ingestArgs(t), url, money, signal);

  function exifText(meta) {
    return meta.exif ? meta.exif.toString('latin1') : '';
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    for (const k of ['RH_POLL_INTERVAL_MS', 'RH_GATE_RETRY_MS', 'RH_OUTPUT_RETRY_MS', 'RH_MAX_CONCURRENT']) saved[k] = process.env[k];
    process.env.RH_POLL_INTERVAL_MS = '20';
    process.env.RH_GATE_RETRY_MS = '30';
    process.env.RH_OUTPUT_RETRY_MS = '5';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    svc = app.get(TasksService);
    worker = app.get(TaskWorkerService);
    ingestor = app.get(ResultIngestorService);
    reset();
    worker.rh = {
      uploadFile: async () => 'f',
      submit: async () => 'rh-1',
      outputs: async () => { const n = outputsQueue.length > 1 ? outputsQueue.shift() : outputsQueue[0]; if (n instanceof Error) throw n; return n; },
    };
    worker.storage = fakeStorage;
    svc.storage = fakeStorage;
    ingestor.storage = fakeStorage;
    ingestor.fetchFn = async (...a) => { fetchCalls++; return fetchImpl(...a); };
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (prisma) {
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM uploads WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  describe('thành công qua worker', () => {
    it('PNG hợp lệ: out/<userId>/<uuid>, EXIF đúng hai chuỗi, một CAPTURED, không RELEASED, gpu_coins làm tròn', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const r = await row(t.id);
      assert.equal(r.status, 'succeeded');
      assert.equal(r.reason_code, null);
      assert.match(r.result_key, OUT_RE);
      assert.ok(r.result_key.startsWith(`out/${u.id}/`));
      assert.equal(r.gpu_coins, 4);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 1);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 0);
      assert.equal(fetchCalls, 1);
      const out = store.get(r.result_key);
      assert.equal(out.contentType, 'image/png');
      const meta = await sharp(out.body).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, 40);
      assert.equal(meta.height, 60);
      const exif = exifText(meta);
      assert.ok(exif.includes('AI Generator'), 'Software');
      assert.ok(exif.includes('AI-Generated Content'), 'UserComment');
      assert.deepEqual(outKeys(), [r.result_key]);
    });

    for (const [fmt, mime] of [['jpeg', 'image/jpeg'], ['webp', 'image/webp']]) {
      it(`${fmt}: giữ định dạng + Content-Type + EXIF`, async () => {
        reset(); await clearGate();
        fetchImpl = async () => asResponse(await noisy(40, 60, fmt));
        const u = await newUser();
        const t = await runningTask(u);
        await ingest(t);
        const r = await row(t.id);
        assert.equal(r.status, 'succeeded');
        const out = store.get(r.result_key);
        assert.equal(out.contentType, mime);
        const meta = await sharp(out.body).metadata();
        assert.equal(meta.format, fmt);
        const exif = exifText(meta);
        assert.ok(exif.includes('AI Generator') && exif.includes('AI-Generated Content'));
      });
    }

    it('JPEG có EXIF orientation 6: so kích thước sau xoay với ảnh đích', async () => {
      reset(); await clearGate();
      // 60x40 điểm ảnh + orientation 6 => hiển thị 40x60, khớp ảnh đích 40x60.
      fetchImpl = async () => asResponse(await sharp(await noisy(60, 40, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer());
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'succeeded');
      const meta = await sharp(store.get(r.result_key).body).metadata();
      assert.equal(meta.width, 40);
      assert.equal(meta.height, 60);
    });

    it('consumeMoney thiếu/âm/quá lớn được kẹp 0..2147483647', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const a = await runningTask(u);
      await ingest(a, RH_URL, null);
      assert.equal((await row(a.id)).gpu_coins, null);
      const b = await runningTask(u);
      await ingest(b, RH_URL, -5);
      assert.equal((await row(b.id)).gpu_coins, 0);
      const c = await runningTask(u);
      await ingest(c, RH_URL, 9e12);
      assert.equal((await row(c.id)).gpu_coins, 2147483647);
    });
  });

  describe('lỗi tải / ghi R2 (OUTPUT_UPLOAD_ERROR)', () => {
    it('fetch ném lỗi 3 lần: failed, RELEASED 1, gpu_coins lưu, không còn out/', async () => {
      reset(); await clearGate();
      fetchImpl = async () => { throw new Error('mạng lỗi'); };
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const r = await row(t.id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal(r.gpu_coins, 4);
      assert.equal(fetchCalls, 3);
      assert.equal(putCalls, 0);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.deepEqual(outKeys(), []);
    });

    it('HTTP không ok cũng thử 3 lần; lần thứ 3 thành công thì succeeded', async () => {
      reset(); await clearGate();
      let n = 0;
      fetchImpl = async () => { n++; return n < 3 ? new Response('x', { status: 503 }) : asResponse(await solid(40, 60, 'png')); };
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      assert.equal(fetchCalls, 3);
      assert.equal((await row(t.id)).status, 'succeeded');
    });

    it('putObject ném lỗi 3 lần: failed/OUTPUT_UPLOAD_ERROR, RELEASED, không còn out/, đã gọi delete', async () => {
      reset(); await clearGate();
      putImpl = async () => { throw new Error('R2 lỗi'); };
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const r = await row(t.id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal(r.gpu_coins, 4);
      assert.equal(putCalls, 3);
      assert.equal(fetchCalls, 1);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.deepEqual(outKeys(), []);
      assert.ok(deleteCalls.some((k) => k.startsWith('out/')));
    });

    it('putObject lỗi lần đầu rồi thành công: succeeded, đúng một đối tượng out/', async () => {
      reset(); await clearGate();
      let n = 0;
      putImpl = async () => { if (++n === 1) throw new Error('tạm thời'); };
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      assert.equal((await row(t.id)).status, 'succeeded');
      assert.equal(outKeys().length, 1);
    });

    it('quá deadline_at giữa các lần thử: dừng thử, OUTPUT_UPLOAD_ERROR, RELEASED', async () => {
      reset(); await clearGate();
      process.env.RH_OUTPUT_RETRY_MS = '200';
      try {
        fetchImpl = async () => { throw new Error('mạng lỗi'); };
        const u = await newUser();
        const t = await runningTask(u);
        await pool.query(`UPDATE tasks SET deadline_at = now() + interval '100 milliseconds' WHERE id=$1`, [t.id]);
        await ingest(t);
        const r = await row(t.id);
        assert.equal(fetchCalls, 1, 'không bắt đầu lần mới sau deadline');
        assert.equal(r.status, 'failed');
        assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
        assert.equal(r.gpu_coins, 4);
        assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      } finally { process.env.RH_OUTPUT_RETRY_MS = '5'; }
    });

    it('deadline_at đã qua từ đầu: không tải, OUTPUT_UPLOAD_ERROR', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await runningTask(u);
      await pool.query(`UPDATE tasks SET deadline_at = now() - interval '1 second' WHERE id=$1`, [t.id]);
      await ingest(t);
      assert.equal(fetchCalls, 0);
      const r = await row(t.id);
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
    });

    it('chỉ chấp nhận http(s): file:// và URL hỏng không gọi fetch', async () => {
      reset(); await clearGate();
      const u = await newUser();
      for (const url of ['file:///etc/passwd', 'ftp://x/y.png', 'khong-phai-url']) {
        const t = await runningTask(u);
        await ingest(t, url);
        const r = await row(t.id);
        assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR', url);
        assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      }
      assert.equal(fetchCalls, 0);
    });

    it('vượt 20 MB (khai báo hoặc đọc luồng) => OUTPUT_UPLOAD_ERROR, không ghi R2', async () => {
      reset(); await clearGate();
      const u = await newUser();
      fetchImpl = async () => asResponse(Buffer.alloc(1), { 'content-length': String(20 * 1024 * 1024 + 1) });
      const a = await runningTask(u);
      await ingest(a);
      assert.equal((await row(a.id)).reason_code, 'OUTPUT_UPLOAD_ERROR');
      fetchImpl = async () => asResponse(Buffer.alloc(20 * 1024 * 1024 + 1, 1));
      const b = await runningTask(u);
      await ingest(b);
      assert.equal((await row(b.id)).reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal(putCalls, 0);
    });

    it('putObject và getObject (ảnh tham chiếu) nhận đúng signal của Task', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await runningTask(u);
      const ac = new AbortController();
      await ingest(t, RH_URL, 3, ac.signal);
      assert.equal(putSignals.length, 1);
      assert.equal(putSignals[0], ac.signal);
      assert.ok(getSignals.length >= 1);
      assert.ok(getSignals.every((s) => s === ac.signal));
    });

    it('fetch nhận signal có timeout 30 giây và signal hủy được truyền xuống', async () => {
      reset(); await clearGate();
      let received;
      fetchImpl = async (url, init) => { received = { url, signal: init.signal }; return asResponse(await solid(40, 60, 'png')); };
      const u = await newUser();
      const t = await runningTask(u);
      const ac = new AbortController();
      await ingest(t, RH_URL, 3, ac.signal);
      assert.equal(received.url, RH_URL);
      assert.equal(received.signal.aborted, false);
      const t2 = await runningTask(u);
      ac.abort();
      await assert.rejects(ingest(t2, RH_URL, 3, ac.signal));
      assert.equal((await row(t2.id)).status, 'running', 'signal hủy: không đổi trạng thái');
      assert.equal(fetchCalls, 1);
    });
  });

  describe('kết quả không hợp lệ (OUTPUT_INVALID, không thử lại)', () => {
    async function expectInvalid(label, body) {
      reset(); await clearGate();
      fetchImpl = async () => asResponse(body);
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const r = await row(t.id);
      assert.equal(r.status, 'failed', label);
      assert.equal(r.reason_code, 'OUTPUT_INVALID', label);
      assert.equal(r.gpu_coins, 4, label);
      assert.equal(fetchCalls, 1, `${label}: không thử lại`);
      assert.equal(putCalls, 0, `${label}: không ghi out/`);
      assert.deepEqual(outKeys(), [], label);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1, label);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0, label);
    }

    it('byte không phải ảnh', () => expectInvalid('rác', Buffer.from('đây không phải ảnh')));
    it('ảnh PNG bị cắt cụt', async () => {
      const full = await noisy(40, 60, 'png');
      await expectInvalid('cắt cụt', full.subarray(0, Math.floor(full.length / 2)));
    });
    it('ảnh rỗng', () => expectInvalid('rỗng', Buffer.alloc(0)));
    it('ảnh toàn đen', async () => expectInvalid('đen', await solid(40, 60, 'png', { r: 0, g: 0, b: 0 })));
    it('ảnh gần đen (max kênh = 8) vẫn bị loại', async () => expectInvalid('gần đen', await solid(40, 60, 'png', { r: 8, g: 8, b: 8 })));
    it('ảnh khác cỡ ảnh đích', async () => expectInvalid('lệch cỡ', await solid(41, 60, 'png')));
    it('ảnh hợp lệ nhưng định dạng không hỗ trợ (GIF): OUTPUT_INVALID', async () => {
      const gif = await sharp({
        create: { width: 40, height: 60, channels: 3, background: { r: 100, g: 100, b: 100 } },
      })
        .gif()
        .toBuffer();
      await expectInvalid('gif', gif);
    });
    it('ảnh bị xoay EXIF thành khác cỡ', async () => {
      // 40x60 điểm ảnh + orientation 6 => hiển thị 60x40, khác ảnh đích 40x60.
      const body = await sharp(await noisy(40, 60, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      await expectInvalid('xoay', body);
    });

    it('ảnh sáng một kênh (max kênh = 9) hợp lệ — ranh giới độ đen', async () => {
      reset(); await clearGate();
      fetchImpl = async () => asResponse(await solid(40, 60, 'png', { r: 9, g: 0, b: 0 }));
      const u = await newUser();
      const t = await runningTask(u);
      await ingest(t);
      assert.equal((await row(t.id)).status, 'succeeded');
    });
  });

  describe('CAS không áp dụng', () => {
    it('Task bị xử lý (failed) trong lúc ghi R2: xóa out/ vừa ghi, không đổi trạng thái, không CAPTURED', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await runningTask(u);
      putImpl = async () => { await svc.transition(t.id, 'running', 'timed_out', 'RH_TIMEOUT'); };
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'timed_out');
      assert.equal(r.result_key, null);
      assert.equal(putCalls, 1);
      assert.deepEqual(outKeys(), []);
      assert.ok(deleteCalls.some((k) => k.startsWith('out/')));
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
    });

    it('transition(succeeded) ném lỗi: xóa out/ vừa ghi, worker chốt failed/OUTPUT_UPLOAD_ERROR + RELEASED', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await createTask(u);
      const orig = svc.transition.bind(svc);
      let thrown = false;
      svc.transition = async (id, from, to, ...rest) => {
        if (to === 'succeeded' && !thrown) { thrown = true; throw new Error('db lỗi'); }
        return orig(id, from, to, ...rest);
      };
      try {
        await worker.processTask(t.id);
      } finally {
        svc.transition = orig;
      }
      assert.ok(thrown);
      const r = await row(t.id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
      assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
      assert.deepEqual(outKeys(), []);
      assert.ok(deleteCalls.some((k) => k.startsWith('out/')));
    });

    it('Task không còn running khi bắt đầu: không tải gì', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await runningTask(u);
      await svc.transition(t.id, 'running', 'failed', 'RH_ERROR');
      await ingest(t);
      assert.equal(fetchCalls, 0);
      assert.equal((await row(t.id)).reason_code, 'RH_ERROR');
    });
  });

  describe('GET /tasks/:id/result', () => {
    const get = (id, token) => fetch(`${baseUrl}/tasks/${id}/result`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    it('chủ + succeeded: hai URL ký 10 phút, không lộ link RunningHub', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const r = await row(t.id);
      const res = await get(t.id, u.token);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ['resultUrl', 'sourceUrl']);
      assert.equal(body.resultUrl, `https://r2.example.test/${r.result_key}?X-Amz-Expires=600`);
      assert.equal(body.sourceUrl, `https://r2.example.test/${t.targetKey}?X-Amz-Expires=600`);
      assert.ok(!JSON.stringify(body).includes('rh.example.test'));
    });

    it('ảnh gốc đã hết hạn (head null): sourceUrl = null', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      store.delete(t.targetKey);
      const res = await get(t.id, u.token);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.sourceUrl, null);
      assert.ok(body.resultUrl.includes('out/'));
    });

    it('storage.head ném lỗi khi kiểm ảnh gốc: sourceUrl = null, không sập 500', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const origHead = fakeStorage.head;
      fakeStorage.head = async (key) => {
        if (key === t.targetKey) throw new Error('R2 tạm thời lỗi');
        return origHead(key);
      };
      try {
        const res = await get(t.id, u.token);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.sourceUrl, null);
        assert.ok(body.resultUrl.includes('out/'));
      } finally {
        fakeStorage.head = origHead;
      }
    });

    it('người khác chủ: 403 FORBIDDEN, không URL', async () => {
      reset(); await clearGate();
      const u = await newUser();
      const other = await newUser();
      const t = await createTask(u);
      await worker.processTask(t.id);
      const res = await get(t.id, other.token);
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'FORBIDDEN');
      assert.ok(!JSON.stringify(body).includes('http'));
    });

    for (const status of ['queued', 'running', 'failed']) {
      it(`Task ${status}: 409 CONFLICT, không URL`, async () => {
        reset(); await clearGate();
        const u = await newUser();
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

    it('không đăng nhập: 401; id lạ/không hợp lệ: 404', async () => {
      const u = await newUser();
      assert.equal((await get(crypto.randomUUID())).status, 401);
      assert.equal((await get(crypto.randomUUID(), u.token)).status, 404);
      assert.equal((await get('khong-phai-uuid', u.token)).status, 404);
    });
  });

  describe('cấu hình', () => {
    it('Face Swap dùng ảnh đích làm ảnh tham chiếu', () => {
      assert.equal(PIPELINE_CONFIGS.face_swap.referenceInputKey, 'targetKey');
    });

    it('configure-bucket có lifecycle out/ 30 ngày', () => {
      const src = fs.readFileSync(path.join(apiRoot, 'src/scripts/configure-bucket.ts'), 'utf8');
      assert.match(src, /Prefix:\s*'out\/'[\s\S]*?Days:\s*30/);
    });
  });
});
