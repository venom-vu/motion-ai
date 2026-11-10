import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { PipelinesModule, PIPELINE_CONFIGS } from '../dist/modules/pipelines/index.js';
import { ApiErrorCode, MotionCreateResponseSchema, ValidationDetailsSchema, motionPrice } from '@flowvis/contracts';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TaskWorkerService, TasksService } from '../dist/modules/tasks/index.js';

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




const queueCalls = [];
Queue.prototype.add = async function (name, data, opts) { queueCalls.push({ name, data, opts }); return { id: opts?.jobId }; };
Queue.prototype.getJob = async function () { return null; };

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('Story 5.3: [BE] Tạo Task Motion Control', () => {
  let app, baseUrl, pool, prisma, jwt, worker, tasksSvc;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];

  async function newUser({ balance = 5000, locked = false, tierPack = null } = {}) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `mc-${runId}-${n}`, email: `mc-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', lockedAt: locked ? new Date() : null, tierPack } });
    users.push(u.id);
    if (balance > 0) await prisma.$transaction((t) => new WalletService().grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function img(user) {
    const uuid = crypto.randomUUID();
    await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` } });
    return `in/${user.id}/${uuid}`;
  }
  async function vid(user, durationSeconds = 20, extra = {}) {
    const uuid = crypto.randomUUID();
    await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'video', mimeType: 'video/mp4', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}`, durationSeconds, confirmedAt: new Date(), ...extra } });
    return `in/${user.id}/${uuid}`;
  }
  const post = (user, body) => fetch(`${baseUrl}/tasks/motion`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const countFor = async (u) => ({
    tasks: (await pool.query('SELECT count(*)::int n FROM tasks WHERE user_id=$1', [u.id])).rows[0].n,
    ledger: (await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE user_id=$1', [u.id])).rows[0].n,
  });
  async function expectReason(res, reason, cap) {
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.code, ApiErrorCode.VALIDATION_FAILED);
    const d = ValidationDetailsSchema.parse(j.details);
    assert.equal(d.reason, reason);
    if (cap !== undefined) assert.equal(d.cap, cap);
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    worker = app.get(TaskWorkerService);
    tasksSvc = app.get(TasksService);
  });
  after(async () => {
    if (prisma) {
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('giá mọi độ dài 3..20 giây (Creator): HOLD = motionPrice, params khớp, jobId = taskId', async () => {
    const u = await newUser({ balance: 100000, tierPack: 'creator' });
    const v = await vid(u, 21);
    const c = await img(u);
    for (let s = 3; s <= 20; s++) {
      await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now() WHERE user_id=$1 AND status IN ('queued','running')`, [u.id]);
      queueCalls.length = 0;
      const res = await post(u, { characterKey: c, videoKey: v, trimStart: 1, trimEnd: 1 + s });
      assert.equal(res.status, 201, String(s));
      const t = MotionCreateResponseSchema.parse(await res.json());
      assert.equal(t.price, motionPrice(s));
      assert.equal(t.creditCost, motionPrice(s));
      const r = await row(t.id);
      assert.deepEqual(r.params, { trimStart: 1, trimEnd: 1 + s, seconds: s, price: motionPrice(s) });
      assert.equal(r.hold_amount, motionPrice(s));
      assert.equal(r.status, 'queued');
      assert.deepEqual(r.input_keys, { characterKey: c, videoKey: v });
      const holds = await prisma.ledgerEntry.findMany({ where: { taskId: t.id, type: 'HOLD' } });
      assert.equal(Number(holds[0].amount), -motionPrice(s));
      assert.equal(queueCalls[0].opts.jobId, t.id);
    }
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now() WHERE user_id=$1 AND status IN ('queued','running')`, [u.id]);
    const res = await post(u, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 21 });
    await expectReason(res, 'TRIM_EXCEEDS_CAP', 20);
    const ok20 = await post(u, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 20 });
    assert.equal(ok20.status, 201);
    assert.equal((await ok20.json()).price, 1000);
  });

  it('Cap theo Tier: FREE 5 ok / 6 bị từ chối; Starter 12; Creator 20 ok', async () => {
    const free = await newUser({ balance: 1000 });
    const v = await vid(free, 20); const c = await img(free);
    let res = await post(free, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 5 });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).price, 250);
    const free2 = await newUser({ balance: 1000 });
    res = await post(free2, { characterKey: await img(free2), videoKey: await vid(free2, 20), trimStart: 0, trimEnd: 6 });
    await expectReason(res, 'TRIM_EXCEEDS_CAP', 5);
    assert.deepEqual(await countFor(free2), { tasks: 0, ledger: 1 }, 'chỉ còn bút toán cấp credit, không HOLD');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ledger_entries WHERE user_id=$1 AND type='HOLD'`, [free2.id])).rows[0].n, 0);
    assert.equal(Number((await pool.query(`SELECT balance, held FROM users WHERE id=$1`, [free2.id])).rows[0].balance), 1000);

    const st = await newUser({ tierPack: 'starter' });
    res = await post(st, { characterKey: await img(st), videoKey: await vid(st, 20), trimStart: 0, trimEnd: 12 });
    await expectReason(res, 'TRIM_EXCEEDS_CAP', 10);
    const cr = await newUser({ tierPack: 'creator' });
    res = await post(cr, { characterKey: await img(cr), videoKey: await vid(cr, 20), trimStart: 0, trimEnd: 20 });
    assert.equal(res.status, 201);
  });

  it('Tier đổi sau khi tải video: Pro rơi về FREE, trim 8 s => cap 5', async () => {
    const u = await newUser({ tierPack: 'pro' });
    const v = await vid(u, 20); const c = await img(u);
    await pool.query(`UPDATE users SET tier_pack=NULL WHERE id=$1`, [u.id]);
    await expectReason(await post(u, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 8 }), 'TRIM_EXCEEDS_CAP', 5);
  });

  it('Trim sai: không HOLD, không Task', async () => {
    const u = await newUser({ tierPack: 'creator' });
    const v = await vid(u, 10); const c = await img(u);
    const p = (trimStart, trimEnd) => post(u, { characterKey: c, videoKey: v, trimStart, trimEnd });
    await expectReason(await p(0, 4.5), 'TRIM_NOT_WHOLE_SECOND');
    await expectReason(await p(0.5, 5), 'TRIM_NOT_WHOLE_SECOND');
    await expectReason(await p(-1, 4), 'TRIM_OUT_OF_VIDEO');
    await expectReason(await p(2, 11), 'TRIM_OUT_OF_VIDEO');
    await expectReason(await p(0, 2), 'TRIM_TOO_SHORT');
    await expectReason(await p(5, 5), 'TRIM_TOO_SHORT');
    await expectReason(await p(6, 4), 'TRIM_TOO_SHORT');
    assert.deepEqual(await countFor(u), { tasks: 0, ledger: 1 });
  });

  it('body trimStart/trimEnd sai kiểu: reason từng ca', async () => {
    const u = await newUser({ tierPack: 'creator' });
    const v = await vid(u, 10); const c = await img(u);
    const base = { characterKey: c, videoKey: v };
    const plain = async (body) => {
      const res = await post(u, { ...base, ...body });
      assert.equal(res.status, 400);
      const j = await res.json();
      assert.equal(j.code, ApiErrorCode.VALIDATION_FAILED);
      assert.equal(j.details, undefined);
    };
    await plain({ trimStart: '1', trimEnd: 5 });
    await plain({ trimStart: null, trimEnd: 5 });
    await plain({ trimStart: 0 });
    await expectReason(await post(u, { ...base, trimStart: 0, trimEnd: 1.5 }), 'TRIM_NOT_WHOLE_SECOND');
    await expectReason(await post(u, { ...base, trimStart: -1, trimEnd: 5 }), 'TRIM_OUT_OF_VIDEO');
    assert.deepEqual(await countFor(u), { tasks: 0, ledger: 1 });
  });

  it('Cap không hợp lệ trong snapshot: không tạo Task, rollback HOLD', async () => {
    const u = await newUser({ tierPack: 'creator' });
    const v = await vid(u, 10); const c = await img(u);
    const wallet = app.get(WalletService);
    const orig = wallet.hold;
    wallet.hold = async (...a) => ({ ...(await orig.apply(wallet, a)), maxVideoSeconds: Number.NaN });
    try {
      const res = await post(u, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 4 });
      assert.equal(res.status, 500);
    } finally {
      wallet.hold = orig;
    }
    assert.equal((await pool.query(`SELECT count(*)::int n FROM tasks WHERE user_id=$1`, [u.id])).rows[0].n, 0);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM ledger_entries WHERE user_id=$1 AND type='HOLD'`, [u.id])).rows[0].n, 0);
  });

  it('khóa sai: người khác, ảnh làm video, video làm ảnh, chưa xác nhận, hết hạn, trùng khóa', async () => {
    const a = await newUser(); const b = await newUser();
    const c = await img(a); const v = await vid(a, 10);
    const ok = { trimStart: 0, trimEnd: 4 };
    const bad = async (body) => {
      const res = await post(a, { ...ok, ...body });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    };
    await bad({ characterKey: c, videoKey: await vid(b, 10) });
    await bad({ characterKey: await img(b), videoKey: v });
    await bad({ characterKey: c, videoKey: await img(a) });
    await bad({ characterKey: v, videoKey: v });
    const pendUuid = crypto.randomUUID();
    await prisma.upload.create({ data: { userId: a.id, key: `in-raw/${a.id}/${pendUuid}`, kind: 'video', mimeType: 'video/mp4', declaredBytes: 10, status: 'pending' } });
    await bad({ characterKey: c, videoKey: `in-raw/${a.id}/${pendUuid}` });
    await bad({ characterKey: c, videoKey: `in/${a.id}/${crypto.randomUUID()}` });
    await bad({ characterKey: c, videoKey: await vid(a, 10, { confirmedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }) });
    assert.deepEqual(await countFor(a), { tasks: 0, ledger: 1 });
  });

  it('lỗi nghiệp vụ: bị khóa / thiếu credit / TASK_LIMIT', async () => {
    const locked = await newUser({ locked: true });
    let res = await post(locked, { characterKey: await img(locked), videoKey: await vid(locked), trimStart: 0, trimEnd: 4 });
    assert.equal((await res.json()).code, ApiErrorCode.ACCOUNT_LOCKED);
    const poor = await newUser({ balance: 199 });
    res = await post(poor, { characterKey: await img(poor), videoKey: await vid(poor), trimStart: 0, trimEnd: 4 });
    assert.equal((await res.json()).code, ApiErrorCode.INSUFFICIENT_CREDIT);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM tasks WHERE user_id=$1`, [poor.id])).rows[0].n, 0);
    const busy = await newUser({ balance: 5000 });
    const c = await img(busy); const v = await vid(busy);
    for (let i = 0; i < 3; i++) assert.equal((await post(busy, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 3 })).status, 201);
    res = await post(busy, { characterKey: c, videoKey: v, trimStart: 0, trimEnd: 3 });
    assert.equal((await res.json()).code, ApiErrorCode.TASK_LIMIT);
  });

  describe('Story 5.5: worker gửi Task motion lên RunningHub', () => {
    let calls, outputsQueue, submitImpl, ingestCalls, saved;
    const envKeys = ['RH_POLL_INTERVAL_MS', 'RH_GATE_RETRY_MS', 'RH_MAX_CONCURRENT'];
    const upd = (id, set) => pool.query(`UPDATE tasks SET ${set} WHERE id=$1`, [id]);
    const motionCfg = () => PIPELINE_CONFIGS.motion_control;
    let origPrepare, prepareSeen, uploadHook;

    async function mkTask(tierPack = 'starter') {
      const u = await newUser({ tierPack });
      const res = await post(u, { characterKey: await img(u), videoKey: await vid(u), trimStart: 0, trimEnd: 7 });
      assert.equal(res.status, 201);
      return (await res.json()).id;
    }
    async function clearGate() {
      await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
      const foreign = await tasksSvc.countGateOccupied();
      process.env.RH_MAX_CONCURRENT = String(foreign + 2);
    }
    const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });

    function reset() {
      calls = { upload: 0, submit: 0, outputs: 0 };
      outputsQueue = [{ status: 'SUCCESS', fileUrl: 'http://x/y.mp4', consumeMoney: 3 }];
      submitImpl = async () => 'rh-m1';
      ingestCalls = [];
      prepareSeen = 0;
    }

    before(() => {
      saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
      process.env.RH_POLL_INTERVAL_MS = '20';
      process.env.RH_GATE_RETRY_MS = '30';
      worker.rh = {
        uploadFile: async () => { calls.upload++; if (calls.upload === 1) calls.deadlineAtUpload = await uploadHook?.(); return `f${calls.upload}`; },
        submit: async (...a) => { calls.submit++; calls.nodes = a; return submitImpl(...a); },
        outputs: async () => { calls.outputs++; const n = outputsQueue.length > 1 ? outputsQueue.shift() : outputsQueue[0]; if (n instanceof Error) throw n; return n; },
      };
      worker.ingestor = { ingest: async (t, url, money) => { ingestCalls.push({ t, url, money }); await tasksSvc.transition(t.id, 'running', 'failed', 'OUTPUT_UPLOAD_ERROR'); } };
      origPrepare = motionCfg().prepare;
      Object.defineProperty(motionCfg(), 'prepare', {
        configurable: true, writable: true,
        value: async () => { prepareSeen++; return { characterKey: Buffer.from('C'), videoKey: Buffer.from('V') }; },
      });
    });
    after(() => {
      Object.defineProperty(motionCfg(), 'prepare', { configurable: true, writable: true, value: origPrepare });
      for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    });

    it('thành công: upload 2 file, submit một lần với node đã ánh xạ, deadline_at ~ +360s sau prepare', async () => {
      reset(); await clearGate();
      const id = await mkTask();
      const before = await row(id);
      assert.equal(before.deadline_at, null);
      let deadlineAtPrepare = 'unset';
      uploadHook = async () => (await row(id)).deadline_at;
      const savedOverride = process.env.RH_DEADLINE_MS; delete process.env.RH_DEADLINE_MS;
      motionCfg().prepare = async () => { deadlineAtPrepare = (await row(id)).deadline_at; prepareSeen++; return { characterKey: Buffer.from('C'), videoKey: Buffer.from('V') }; };
      const t0 = Date.now();
      try { await worker.processTask(id); } finally { if (savedOverride !== undefined) process.env.RH_DEADLINE_MS = savedOverride; uploadHook = undefined; }
      assert.equal(deadlineAtPrepare, null, 'deadline_at chưa đặt khi đang chuẩn bị');
      assert.ok(calls.deadlineAtUpload, 'deadline_at đã đặt trước khi upload file đầu tiên');
      const r = await row(id);
      const d = (r.deadline_at.getTime() - t0) / 1000;
      assert.ok(d > 355 && d < 365, String(d));
      assert.ok(r.deadline_at.getTime() - 360_000 <= r.submit_started_at.getTime(), 'submit sau thời điểm đặt deadline_at');
      assert.equal(prepareSeen, 1);
      assert.equal(calls.upload, 2);
      assert.equal(calls.submit, 1);
      assert.equal(r.runninghub_task_id, 'rh-m1');
      assert.deepEqual(calls.nodes[1], [
        { nodeId: '1', fieldName: 'image', fieldValue: 'f1' },
        { nodeId: '2', fieldName: 'video', fieldValue: 'f2' },
      ]);
      assert.equal(ingestCalls.length, 1);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
    });

    it('Face Swap vẫn 180s', async () => {
      reset(); await clearGate();
      const { deadlineMs } = await import('../dist/modules/tasks/task-worker.service.js');
      const saved = process.env.NODE_ENV; delete process.env.NODE_ENV;
      try {
        assert.equal(deadlineMs('face_swap'), 180_000);
        assert.equal(deadlineMs('body_retouch'), 180_000);
        assert.equal(deadlineMs('motion_control'), 360_000);
      } finally { if (saved !== undefined) process.env.NODE_ENV = saved; }
    });

    for (const [prefix, reason] of [['NO_POSE', 'NO_POSE'], ['NO_FACE', 'NO_FACE']]) {
      it(`${prefix} => failed/${reason}, RELEASED 100%, lưu gpu_coins`, async () => {
        reset(); await clearGate();
        outputsQueue = [{ status: 'FAILED', errorMessage: `${prefix}: không thấy`, consumeMoney: 4 }];
        const id = await mkTask();
        await worker.processTask(id);
        const r = await row(id);
        assert.equal(r.status, 'failed');
        assert.equal(r.reason_code, reason);
        assert.equal(Number(r.gpu_coins), 4);
        const rel = await ledger(id, 'RELEASED');
        assert.equal(rel.length, 1);
        assert.equal(Number(rel[0].amount), 350);
        assert.equal((await ledger(id, 'CAPTURED')).length, 0);
      });
    }

    it('quá deadline_at khi poll => timed_out/RH_TIMEOUT, orphan, kết quả muộn bị bỏ qua', async () => {
      reset(); await clearGate();
      outputsQueue = [{ status: 'RUNNING' }];
      const id = await mkTask();
      await tasksSvc.transition(id, 'queued', 'running');
      await upd(id, `deadline_at=now()+interval '300 milliseconds', submit_started_at=now(), runninghub_task_id='rh-late'`);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'timed_out');
      assert.equal(r.reason_code, 'RH_TIMEOUT');
      assert.ok(r.rh_orphan_until > new Date());
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
      assert.equal(ingestCalls.length, 0);
    });

    it('khởi động lại có runninghub_task_id: poll tiếp, không prepare/upload/submit lại', async () => {
      reset(); await clearGate();
      const id = await mkTask();
      await tasksSvc.transition(id, 'queued', 'running');
      await upd(id, `deadline_at=now()+interval '5 minutes', submit_started_at=now(), runninghub_task_id='rh-9'`);
      await worker.processTask(id);
      assert.equal(prepareSeen, 0);
      assert.equal(calls.upload, 0);
      assert.equal(calls.submit, 0);
      assert.ok(calls.outputs >= 1);
      assert.equal(ingestCalls.length, 1);
    });
  });

  it('migration: CHECK pipeline nhận motion_control', async () => {
    const chk = await pool.query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='tasks_pipeline_valid_chk'`);
    assert.match(chk.rows[0].def, /motion_control/);
  });

  it('thiếu RUNNINGHUB_WORKFLOW_MOTION => khởi động thất bại, nêu tên biến', async () => {
    const saved = process.env.RUNNINGHUB_WORKFLOW_MOTION;
    delete process.env.RUNNINGHUB_WORKFLOW_MOTION;
    try {
      await assert.rejects(
        NestFactory.createApplicationContext(PipelinesModule, { logger: false, abortOnError: false }),
        /RUNNINGHUB_WORKFLOW_MOTION/,
      );
    } finally {
      if (saved === undefined) delete process.env.RUNNINGHUB_WORKFLOW_MOTION;
      else process.env.RUNNINGHUB_WORKFLOW_MOTION = saved;
    }
  });
});
