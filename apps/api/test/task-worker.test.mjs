import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService, TaskWorkerService, WORKER_CONCURRENCY } from '../dist/modules/tasks/index.js';
import { ResultIngestorService } from '../dist/modules/tasks/result-ingestor.js';
import { RunningHubError, RunningHubNetworkError } from '../dist/ports/index.js';
import { RedisService } from '../dist/infra/redis.service.js';

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




const realAdd = Queue.prototype.add;
Queue.prototype.add = async function (name, data, opts) { return { id: opts?.jobId }; };
Queue.prototype.getJob = async function () { return null; };

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('Story 2.5: [BE] Worker xử lý Task qua RunningHub', () => {
  let app, baseUrl, pool, prisma, jwt, svc, worker;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const savedCap = process.env.RH_MAX_CONCURRENT;
  let calls, outputsQueue, submitImpl, ingestCalls, ingestImpl, getObjectImpl;

  function reset() {
    calls = { upload: 0, submit: 0, outputs: 0 };
    outputsQueue = [{ status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 3 }];
    submitImpl = async () => 'rh-1';
    ingestCalls = [];
    ingestImpl = async () => {};
    getObjectImpl = async () => Buffer.from('img');
  }

  async function newUser(balance = 5000) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `w-${runId}-${n}`, email: `w-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    await prisma.$transaction((t) => new WalletService().grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function createTask(user) {
    const keys = [];
    for (let i = 0; i < 2; i++) {
      const uuid = crypto.randomUUID();
      await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` } });
      keys.push(`in/${user.id}/${uuid}`);
    }
    const res = await fetch(`${baseUrl}/tasks/face-swap`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey: keys[0], targetKey: keys[1] }) });
    assert.equal(res.status, 201);
    return (await res.json()).id;
  }
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const upd = (id, set) => pool.query(`UPDATE tasks SET ${set} WHERE id=$1`, [id]);
  const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });
  // Chỉ dọn Task của user test; slot do dữ liệu ngoài chiếm được tính để cổng luôn còn đúng 2 slot cho test.
  async function clearGate() {
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    await pool.query(`UPDATE tasks SET rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND rh_orphan_until IS NOT NULL`, [users]);
    const foreign = await svc.countGateOccupied();
    process.env.RH_MAX_CONCURRENT = String(foreign + 2);
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    process.env.RH_POLL_INTERVAL_MS = '20';
    process.env.RH_GATE_RETRY_MS = '30';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    svc = app.get(TasksService);
    worker = app.get(TaskWorkerService);
    worker.rh = {
      uploadFile: async () => { calls.upload++; return `f${calls.upload}`; },
      submit: async (...a) => { calls.submit++; return submitImpl(...a); },
      outputs: async () => { calls.outputs++; const n = outputsQueue.length > 1 ? outputsQueue.shift() : outputsQueue[0]; if (n instanceof Error) throw n; return n; },
    };
    worker.storage = { getObject: (...a) => getObjectImpl(...a) };
    worker.ingestor = { ingest: async (t, url, money, sig) => { ingestCalls.push({ t, url, money }); await ingestImpl(t, url, money, sig); } };
  });

  after(async () => {
    if (savedCap === undefined) delete process.env.RH_MAX_CONCURRENT; else process.env.RH_MAX_CONCURRENT = savedCap;
    if (prisma) {
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('migration: đủ 9 cột; finished_at đặt ở trạng thái kết thúc', async () => {
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='tasks'`)).rows.map((r) => r.column_name);
    for (const c of ['running_at', 'prep_deadline_at', 'deadline_at', 'submit_started_at', 'finished_at', 'rh_orphan_until', 'gate_deadline', 'runninghub_task_id', 'gpu_coins']) assert.ok(cols.includes(c), c);
    reset(); await clearGate();
    const u = await newUser();
    const id = await createTask(u);
    await svc.transition(id, 'queued', 'running');
    const r = await row(id);
    assert.ok(r.running_at && r.prep_deadline_at && r.gate_deadline);
    assert.equal(r.finished_at, null);
    const d = (r.prep_deadline_at - r.running_at) / 1000;
    assert.ok(d > 119 && d < 121);
    await svc.transition(id, 'running', 'failed', 'RH_ERROR', { gpuCoins: 7, orphanForMs: 60000 });
    const f = await row(id);
    assert.ok(f.finished_at);
    assert.equal(f.gpu_coins, 7);
    assert.ok(f.rh_orphan_until > new Date());
  });

  it('thành công: id/deadline/submit_started đặt, ingest một lần, ingestor giả => OUTPUT_UPLOAD_ERROR RELEASED', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'RUNNING' }, { status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 3 }];
    const u = await newUser();
    const id = await createTask(u);
    ingestImpl = async (t) => { await svc.transition(t.id, 'running', 'failed', 'OUTPUT_UPLOAD_ERROR'); };
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.runninghub_task_id, 'rh-1');
    assert.ok(r.deadline_at && r.submit_started_at && r.running_at);
    assert.equal(calls.submit, 1);
    assert.equal(calls.upload, 2);
    assert.equal(ingestCalls.length, 1);
    assert.equal(ingestCalls[0].url, 'http://x/y.png');
    assert.equal(r.status, 'failed');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal((await ledger(id, 'CAPTURED')).length, 0);
  });

  it('ingestor thật: SUCCESS mà tải lỗi => failed/OUTPUT_UPLOAD_ERROR, gpu_coins lưu', async () => {
    reset(); await clearGate();
    const real = app.get(TaskWorkerService);
    const ingestor = app.get(ResultIngestorService);
    const savedIngestor = real.ingestor;
    const savedFetch = ingestor.fetchFn;
    const savedRetry = process.env.RH_OUTPUT_RETRY_MS;
    real.ingestor = ingestor;
    ingestor.fetchFn = async () => { throw new Error('mạng lỗi'); };
    process.env.RH_OUTPUT_RETRY_MS = '1';
    try {
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
      assert.equal(r.gpu_coins, 3);
      assert.equal((await ledger(id, 'CAPTURED')).length, 0);
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
    } finally {
      real.ingestor = savedIngestor;
      ingestor.fetchFn = savedFetch;
      if (savedRetry === undefined) delete process.env.RH_OUTPUT_RETRY_MS; else process.env.RH_OUTPUT_RETRY_MS = savedRetry;
    }
  });

  it('giao lại có id: không upload, không submit, poll tiếp', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const id = await createTask(u);
    await svc.transition(id, 'queued', 'running');
    await upd(id, `deadline_at=now()+interval '3 minutes', submit_started_at=now(), runninghub_task_id='rh-9'`);
    await worker.processTask(id);
    assert.equal(calls.upload, 0);
    assert.equal(calls.submit, 0);
    assert.equal(calls.outputs >= 1, true);
    assert.equal(ingestCalls.length, 1);
  });

  it('submit không có id => RH_SUBMIT_UNKNOWN + orphan', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const id = await createTask(u);
    await svc.transition(id, 'queued', 'running');
    await upd(id, `deadline_at=now()+interval '3 minutes', submit_started_at=now()`);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'RH_SUBMIT_UNKNOWN');
    const m = (r.rh_orphan_until - Date.now()) / 60000;
    assert.ok(m > 9 && m < 10.1);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal(calls.submit, 0);
  });

  it('chạy lại giữa chừng: giữ nguyên deadline_at, chạy lại từ upload', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const id = await createTask(u);
    await svc.transition(id, 'queued', 'running');
    await upd(id, `deadline_at=now()+interval '100 seconds'`);
    const before = (await row(id)).deadline_at.getTime();
    await worker.processTask(id);
    assert.equal(calls.upload, 2);
    assert.equal((await row(id)).deadline_at.getTime(), before);
  });

  it('quá hạn khôi phục: RH_TIMEOUT và PREP_TIMEOUT', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const a = await createTask(u);
    await svc.transition(a, 'queued', 'running');
    await upd(a, `deadline_at=now()-interval '1 second'`);
    await worker.processTask(a);
    assert.equal((await row(a)).reason_code, 'RH_TIMEOUT');
    const b = await createTask(u);
    await svc.transition(b, 'queued', 'running');
    await upd(b, `prep_deadline_at=now()-interval '1 second'`);
    await worker.processTask(b);
    const rb = await row(b);
    assert.equal(rb.status, 'timed_out');
    assert.equal(rb.reason_code, 'PREP_TIMEOUT');
    assert.equal((await ledger(b, 'RELEASED')).length, 1);
    assert.equal(calls.upload, 0);
  });

  it('Task đã kết thúc: bỏ job, không gọi RH', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const id = await createTask(u);
    await svc.transition(id, 'queued', 'cancelled', 'USER_CANCEL');
    await worker.processTask(id);
    assert.deepEqual(calls, { upload: 0, submit: 0, outputs: 0 });
  });

  it('cổng đầy: Task thứ ba chờ; có slot thì chạy; orphan tính vào cổng', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const a = await createTask(u), b = await createTask(u), c = await createTask(u);
    for (const x of [a, b]) {
      await svc.transition(x, 'queued', 'running');
      await upd(x, `deadline_at=now()+interval '3 minutes', submit_started_at=now(), runninghub_task_id='held'`);
    }
    const p = worker.processTask(c);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.upload, 0);
    assert.equal((await row(c)).deadline_at, null);
    // a kết thúc nhưng còn orphan: vẫn chiếm slot
    await svc.transition(a, 'running', 'failed', 'RH_ERROR', { orphanForMs: 60000 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(calls.upload, 0);
    await upd(a, `rh_orphan_until=NULL`);
    await p;
    assert.equal(calls.upload, 2);
    assert.equal(ingestCalls.length, 1);
    await clearGate();
  });

  it('quá gate_deadline => RH_GATE_TIMEOUT', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const a = await createTask(u), b = await createTask(u), c = await createTask(u);
    for (const x of [a, b]) {
      await svc.transition(x, 'queued', 'running');
      await upd(x, `deadline_at=now()+interval '3 minutes', submit_started_at=now(), runninghub_task_id='held'`);
    }
    await svc.transition(c, 'queued', 'running');
    await upd(c, `gate_deadline=now()+interval '200 milliseconds'`);
    await worker.processTask(c);
    const r = await row(c);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'RH_GATE_TIMEOUT');
    assert.equal(calls.upload, 0);
    await clearGate();
  });

  it('RH FAILED: ánh xạ lý do + gpu_coins', async () => {
    const cases = [['NO_FACE detected', 'NO_FACE'], ['NO_POSE x', 'NO_POSE'], ['Insufficient balance', 'RH_BUDGET'], ['boom', 'RH_ERROR']];
    for (const [msg, reason] of cases) {
      reset(); await clearGate();
      outputsQueue = [{ status: 'FAILED', errorMessage: msg, consumeMoney: 2 }];
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, reason);
      assert.equal(r.gpu_coins, 2);
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
    }
  });

  it('lỗi mạng submit: retry một lần / hai lần / đã gửi', async () => {
    const run = async (impl) => {
      reset(); await clearGate(); submitImpl = impl;
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      return row(id);
    };
    let n = 0;
    let r = await run(async () => { if (n++ === 0) throw new RunningHubNetworkError('x', false); return 'rh-ok'; });
    assert.equal(calls.submit, 2);
    assert.equal(r.runninghub_task_id, 'rh-ok');
    r = await run(async () => { throw new RunningHubNetworkError('x', false); });
    assert.equal(calls.submit, 2);
    assert.equal(r.reason_code, 'RH_ERROR');
    r = await run(async () => { throw new RunningHubNetworkError('x', true); });
    assert.equal(calls.submit, 1);
    assert.equal(r.reason_code, 'RH_SUBMIT_UNKNOWN');
    assert.ok(r.rh_orphan_until);
  });

  it('poll gặp RunningHubError => RH_ERROR + RELEASED + orphan giữ slot cổng', async () => {
    reset(); await clearGate();
    outputsQueue = [new RunningHubError('api lỗi')];
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'RH_ERROR');
    const m = (r.rh_orphan_until - Date.now()) / 60000;
    assert.ok(m > 9 && m < 10.1);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('upload RunningHub lỗi => failed/RH_ERROR + RELEASED, không submit', async () => {
    reset(); await clearGate();
    const orig = worker.rh.uploadFile;
    worker.rh.uploadFile = async () => { throw new RunningHubError('upload hỏng'); };
    try {
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'RH_ERROR');
      assert.equal(calls.submit, 0);
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
    } finally {
      worker.rh.uploadFile = orig;
    }
  });

  it('submit: RunningHubError => RH_ERROR; Error lạ => RH_SUBMIT_UNKNOWN + orphan', async () => {
    reset(); await clearGate();
    const u = await newUser();
    submitImpl = async () => { throw new RunningHubError('từ chối'); };
    let id = await createTask(u);
    await worker.processTask(id);
    let r = await row(id);
    assert.equal(r.reason_code, 'RH_ERROR');
    assert.equal(r.rh_orphan_until, null);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);

    submitImpl = async () => { throw new Error('timeout lạ'); };
    id = await createTask(u);
    await worker.processTask(id);
    r = await row(id);
    assert.equal(r.reason_code, 'RH_SUBMIT_UNKNOWN');
    assert.ok(r.rh_orphan_until);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('poll: lỗi mạng tạm thời rồi SUCCESS => vẫn tới ingest', async () => {
    reset(); await clearGate();
    outputsQueue = [new RunningHubNetworkError('mạng', false), { status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 3 }];
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    assert.equal(ingestCalls.length, 1);
    assert.ok(calls.outputs >= 2);
  });

  it('ingest ném lỗi => OUTPUT_UPLOAD_ERROR + RELEASED', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 3.4 }];
    ingestImpl = async () => { throw new Error('ingest hỏng'); };
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
    assert.equal(r.gpu_coins, 3);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('prepare được áp dụng trước upload', async () => {
    reset(); await clearGate();
    const { PIPELINE_CONFIGS } = await import('../dist/modules/pipelines/index.js');
    const cfg = PIPELINE_CONFIGS.face_swap;
    const seen = [];
    const origUpload = worker.rh.uploadFile;
    worker.rh.uploadFile = async (bytes) => { seen.push(bytes.toString()); calls.upload++; return `f${calls.upload}`; };
    Object.defineProperty(cfg, 'prepare', {
      configurable: true,
      value: async ({ row, storage, signal }) => {
        const keys = row.inputKeys;
        return Object.fromEntries(
          await Promise.all(Object.entries(keys).map(async ([k, key]) => [k, Buffer.from(`P-${await storage.getObject(key, signal)}`)])),
        );
      },
    });
    try {
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      assert.deepEqual(seen, ['P-img', 'P-img']);
    } finally {
      delete cfg.prepare;
      worker.rh.uploadFile = origUpload;
    }
  });

  it('prepare ném PrepareError(FFMPEG_ERROR) => failed/FFMPEG_ERROR, RELEASED, không gọi RunningHub', async () => {
    reset(); await clearGate();
    const { PIPELINE_CONFIGS } = await import('../dist/modules/pipelines/index.js');
    const { PrepareError } = await import('../dist/modules/tasks/video-trim.service.js');
    const cfg = PIPELINE_CONFIGS.face_swap;
    Object.defineProperty(cfg, 'prepare', { configurable: true, value: async () => { throw new PrepareError('FFMPEG_ERROR'); } });
    try {
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'FFMPEG_ERROR');
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
      assert.deepEqual(calls, { upload: 0, submit: 0, outputs: 0 });
    } finally {
      delete cfg.prepare;
    }
  });

  it('prepare bị ctx.signal hủy khi quá prep_deadline_at => timed_out/PREP_TIMEOUT, RELEASED', async () => {
    reset(); await clearGate();
    const { PIPELINE_CONFIGS } = await import('../dist/modules/pipelines/index.js');
    const cfg = PIPELINE_CONFIGS.face_swap;
    Object.defineProperty(cfg, 'prepare', {
      configurable: true,
      value: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
    });
    try {
      const u = await newUser();
      const id = await createTask(u);
      await svc.transition(id, 'queued', 'running');
      await upd(id, `prep_deadline_at=now()+interval '300 milliseconds'`);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'timed_out');
      assert.equal(r.reason_code, 'PREP_TIMEOUT');
      assert.equal((await ledger(id, 'RELEASED')).length, 1);
      assert.equal(calls.upload, 0);
    } finally {
      delete cfg.prepare;
    }
  });

  it('Task bị đổi khi poll: dừng im lặng, sổ cái không đổi', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'RUNNING' }];
    const u = await newUser();
    const id = await createTask(u);
    const p = worker.processTask(id);
    await new Promise((r) => setTimeout(r, 200));
    await svc.transition(id, 'running', 'timed_out', 'RH_TIMEOUT');
    await p;
    const r = await row(id);
    assert.equal(r.reason_code, 'RH_TIMEOUT');
    assert.equal(ingestCalls.length, 0);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('poll quá deadline_at => RH_TIMEOUT + orphan', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'RUNNING' }];
    const u = await newUser();
    const id = await createTask(u);
    const p = worker.processTask(id);
    await new Promise((r) => setTimeout(r, 200));
    await upd(id, `deadline_at=now()-interval '1 second'`);
    await p;
    const r = await row(id);
    assert.equal(r.reason_code, 'RH_TIMEOUT');
    assert.ok(r.rh_orphan_until);
  });

  it('loadInputs truyền signal của Task vào storage.getObject', async () => {
    reset(); await clearGate();
    const seen = [];
    getObjectImpl = async (_k, signal) => { seen.push(signal); return Buffer.from('img'); };
    const u = await newUser();
    const id = await createTask(u);
    const ac = new AbortController();
    await worker.processTask(id, ac.signal);
    assert.ok(seen.length >= 2);
    assert.ok(seen.every((s) => s === ac.signal));
  });

  it('không đọc được input => INPUT_FETCH_ERROR', async () => {
    reset(); await clearGate();
    getObjectImpl = async () => { throw new Error('r2 down'); };
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.reason_code, 'INPUT_FETCH_ERROR');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal(calls.upload, 0);
  });

  it('finished_at đặt cả với timed_out, cancelled, succeeded', async () => {
    reset(); await clearGate();
    const u = await newUser();
    const a = await createTask(u);
    await svc.transition(a, 'queued', 'cancelled', 'USER_CANCEL');
    const b = await createTask(u);
    await svc.transition(b, 'queued', 'running');
    await svc.transition(b, 'running', 'timed_out', 'RH_TIMEOUT');
    const c = await createTask(u);
    await svc.transition(c, 'queued', 'running');
    assert.equal((await svc.transition(c, 'running', 'succeeded', null, { resultKey: `out/${u.id}/${crypto.randomUUID()}` })).applied, true);
    for (const id of [a, b, c]) assert.ok((await row(id)).finished_at, id);
  });

  it('ingestor trả về mà Task còn running => OUTPUT_UPLOAD_ERROR + RELEASED', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 3.4 }];
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(ingestCalls.length, 1);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
    assert.equal(r.gpu_coins, 3);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('SUCCESS thiếu fileUrl => không gọi ingestor, OUTPUT_UPLOAD_ERROR + RELEASED', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'SUCCESS', fileUrl: '', consumeMoney: 3.4 }];
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(ingestCalls.length, 0);
    assert.equal(r.reason_code, 'OUTPUT_UPLOAD_ERROR');
    assert.equal(r.gpu_coins, 3);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('FAILED với consumeMoney 5e9 => kẹp int4, Task vẫn failed + RELEASED', async () => {
    reset(); await clearGate();
    outputsQueue = [{ status: 'FAILED', errorMessage: 'boom', consumeMoney: 5000000000 }];
    const u = await newUser();
    const id = await createTask(u);
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.gpu_coins, 2147483647);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('thiếu biến môi trường workflow => failed/RH_ERROR, không upload', async () => {
    reset(); await clearGate();
    const saved = process.env.RUNNINGHUB_WORKFLOW_FACESWAP;
    delete process.env.RUNNINGHUB_WORKFLOW_FACESWAP;
    try {
      const u = await newUser();
      const id = await createTask(u);
      await worker.processTask(id);
      const r = await row(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.reason_code, 'RH_ERROR');
      assert.equal(calls.upload, 0);
    } finally { process.env.RUNNINGHUB_WORKFLOW_FACESWAP = saved; }
  });

  it('wiring thật: onModuleInit tạo Worker, xử lý job, bỏ job không có taskId', async () => {
    reset(); await clearGate();
    assert.equal(WORKER_CONCURRENCY, 2);
    const savedRole = process.env.MOTION_PROCESS_ROLE;
    process.env.MOTION_PROCESS_ROLE = 'worker';
    const { getQueueToken } = await import('@nestjs/bullmq');
    const queue = app.get(getQueueToken('tasks'));
    try {
      assert.equal(worker.worker, null);
      await worker.onModuleInit();
      assert.ok(worker.worker);
      assert.equal(worker.worker.opts.concurrency, 2);
      const u = await newUser();
      const id = await createTask(u);
      await realAdd.call(queue, 'process', {}, { removeOnComplete: true, removeOnFail: true });
      await realAdd.call(queue, 'process', { taskId: id }, { jobId: id, removeOnComplete: true, removeOnFail: true });
      const t0 = Date.now();
      while (Date.now() - t0 < 10000 && (await row(id)).status === 'queued') await new Promise((r) => setTimeout(r, 50));
      assert.notEqual((await row(id)).status, 'queued');
      assert.equal(ingestCalls.length, 1);
    } finally {
      const w = worker.worker;
      worker.worker = null;
      await w?.close();
      if (savedRole === undefined) delete process.env.MOTION_PROCESS_ROLE; else process.env.MOTION_PROCESS_ROLE = savedRole;
    }
  });

  it('5 job cùng lúc qua BullMQ Worker: không quá 2 xử lý đồng thời', async () => {
    reset(); await clearGate();
    const { Worker } = await import('bullmq');
    ingestImpl = async (t) => { await svc.transition(t.id, 'running', 'failed', 'OUTPUT_UPLOAD_ERROR'); };
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await createTask(await newUser()));
    const c1 = app.get(RedisService).createWorkerConnection();
    const c2 = app.get(RedisService).createWorkerConnection();
    let cur = 0, max = 0;
    const orig = worker.processTask.bind(worker);
    const queueName = 'tasks-test-' + runId;
    const w = new Worker(queueName, async (job) => {
      cur++; max = Math.max(max, cur);
      try { await orig(job.data.taskId); } finally { cur--; }
    }, { connection: c1, concurrency: 2 });
    const q = new (await import('bullmq')).Queue(queueName, { connection: c2 });
    // Queue.add đã bị giả: gọi trực tiếp qua processor bằng cách thêm job vào hàng thật.
    const { Job } = await import('bullmq');
    for (const id of ids) await Job.create(q, 'process', { taskId: id }, { jobId: id });
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const rs = await Promise.all(ids.map((i) => row(i)));
      if (rs.every((r) => r.status !== 'queued' && r.status !== 'running')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await w.close(); await q.obliterate({ force: true }).catch(() => {}); await q.close(); c1.disconnect(); c2.disconnect();
    assert.ok(max <= 2, `max=${max}`);
    assert.ok(max >= 1);
    for (const i of ids) assert.notEqual((await row(i)).status, 'queued');
    await clearGate();
  });
});
