import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService, TaskWorkerService } from '../dist/modules/tasks/index.js';
import { TaskSweeperService } from '../dist/modules/tasks/task-sweeper.service.js';

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




describe('Story 2.7: [BE] Bộ quét Task treo và hạn chót', () => {
  let app, baseUrl, pool, prisma, jwt, svc, worker, sweeper, queue;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const taskIds = [];

  async function newUser(balance = 5000) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `s-${runId}-${n}`, email: `s-${runId}-${n}@motionai.vn`, tosVersion: 'tos-v7' } });
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
    const id = (await res.json()).id;
    taskIds.push(id);
    await queue.remove(id).catch(() => {});
    return id;
  }
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const upd = (id, set) => pool.query(`UPDATE tasks SET ${set} WHERE id=$1`, [id]);
  const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });
  async function clean() {
    for (const id of taskIds) await queue.remove(id).catch(() => {});
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    await pool.query(`UPDATE tasks SET rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[])`, [users]);
  }
  async function running(user) {
    const id = await createTask(user);
    await svc.transition(id, 'queued', 'running');
    return id;
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    process.env.RH_POLL_INTERVAL_MS = '20';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    svc = app.get(TasksService);
    worker = app.get(TaskWorkerService);
    sweeper = app.get(TaskSweeperService);
    queue = svc.queue;
  });

  after(async () => {
    if (queue) for (const id of taskIds) await queue.remove(id).catch(() => {});
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

  it('Queued mất job: enqueue lại với jobId=taskId, enqueue_attempts+1, giữ queued_at', async () => {
    await clean();
    const id = await createTask(await newUser());
    await upd(id, `queued_at = now() - interval '2 minutes'`);
    const before = await row(id);
    await sweeper.sweep();
    const job = await queue.getJob(id);
    assert.ok(job);
    assert.equal(job.opts.priority, 10);
    const after = await row(id);
    assert.equal(after.status, 'queued');
    assert.equal(after.enqueue_attempts, before.enqueue_attempts + 1);
    assert.equal(after.queued_at.getTime(), before.queued_at.getTime());
    await sweeper.sweep();
    assert.equal((await row(id)).enqueue_attempts, before.enqueue_attempts + 1, 'đã có job thì không tăng');
    await queue.remove(id);
  });

  it('Queued còn mới (dưới 30 giây) không bị đụng', async () => {
    await clean();
    const id = await createTask(await newUser());
    await sweeper.sweep();
    assert.equal(await queue.getJob(id), undefined);
    assert.equal((await row(id)).enqueue_attempts, 0);
  });

  it('Redis lỗi khi enqueue: giữ queued, chu kỳ sau thử lại', async () => {
    await clean();
    const id = await createTask(await newUser());
    await upd(id, `queued_at = now() - interval '2 minutes'`);
    const orig = queue.add;
    queue.add = async () => { throw new Error('redis down'); };
    try { await sweeper.sweep(); } finally { queue.add = orig; }
    assert.equal((await row(id)).status, 'queued');
    await sweeper.sweep();
    assert.ok(await queue.getJob(id));
    await queue.remove(id);
  });

  it('Đạt 5 lần mà vẫn thiếu job: failed/INTERNAL_ERROR, đúng một RELEASED', async () => {
    await clean();
    const id = await createTask(await newUser());
    await upd(id, `queued_at = now() - interval '2 minutes', enqueue_attempts = 5`);
    await sweeper.sweep();
    await sweeper.sweep();
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'INTERNAL_ERROR');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal((await ledger(id, 'CAPTURED')).length, 0);
  });

  it('Running quá deadline_at (job chết): timed_out/RH_TIMEOUT, orphan ~10 phút, RELEASED', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `deadline_at = now() - interval '1 second'`);
    await sweeper.sweep();
    const r = await row(id);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'RH_TIMEOUT');
    const ms = r.rh_orphan_until.getTime() - Date.now();
    assert.ok(ms > 9 * 60_000 && ms <= 10 * 60_000 + 5000, String(ms));
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal((await ledger(id, 'CAPTURED')).length, 0);
  });

  it('Running quá deadline_at (job còn sống): timed_out, job bị xóa, signal bị hủy', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `deadline_at = now() - interval '1 second'`);
    await queue.add('process', { taskId: id }, { jobId: id, delay: 600_000 });
    const ctrl = new AbortController();
    worker.controllers.set(id, ctrl);
    try {
      await sweeper.sweep();
    } finally { worker.controllers.delete(id); }
    assert.equal((await row(id)).status, 'timed_out');
    assert.equal(await queue.getJob(id), undefined);
    assert.equal(ctrl.signal.aborted, true);
  });

  it('Running quá prep, job chết: timed_out/PREP_TIMEOUT, không orphan', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `prep_deadline_at = now() - interval '1 second'`);
    await sweeper.sweep();
    const r = await row(id);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'PREP_TIMEOUT');
    assert.equal(r.rh_orphan_until, null);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('Running chờ cổng, job active: không đổi; quá gate_deadline: RH_GATE_TIMEOUT', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `prep_deadline_at = now() - interval '1 second'`);
    const orig = queue.getJob;
    queue.getJob = async () => ({ getState: async () => 'active', remove: async () => {} });
    try {
      await sweeper.sweep();
      assert.equal((await row(id)).status, 'running');
      await upd(id, `gate_deadline = now() - interval '1 second'`);
      await sweeper.sweep();
    } finally { queue.getJob = orig; }
    const r = await row(id);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'RH_GATE_TIMEOUT');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('Running chưa có deadline_at, prep/gate còn hạn, mất job: enqueue job khôi phục', async () => {
    await clean();
    const id = await running(await newUser());
    const r0 = await row(id);
    assert.equal(r0.deadline_at, null);
    assert.ok(r0.prep_deadline_at > new Date() && r0.gate_deadline > new Date());
    await sweeper.sweep();
    assert.ok(await queue.getJob(id));
    assert.equal((await row(id)).status, 'running');
    await queue.remove(id);
  });

  it('scheduledSweep chỉ gọi sweep khi MOTION_PROCESS_ROLE=worker', async () => {
    let calls = 0;
    const orig = sweeper.sweep;
    sweeper.sweep = async () => void (calls += 1);
    const prev = process.env.MOTION_PROCESS_ROLE;
    try {
      delete process.env.MOTION_PROCESS_ROLE;
      await sweeper.scheduledSweep();
      assert.equal(calls, 0);
      process.env.MOTION_PROCESS_ROLE = 'api';
      await sweeper.scheduledSweep();
      assert.equal(calls, 0);
      process.env.MOTION_PROCESS_ROLE = 'worker';
      await sweeper.scheduledSweep();
      assert.equal(calls, 1);
    } finally {
      sweeper.sweep = orig;
      if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prev;
    }
  });

  it('Running mất job, chưa quá hạn: enqueue job khôi phục, vẫn running', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `deadline_at = now() + interval '2 minutes'`);
    await sweeper.sweep();
    assert.ok(await queue.getJob(id));
    assert.equal((await row(id)).status, 'running');
    await queue.remove(id);
  });

  it('Kết quả muộn: Task đã timed_out thì worker bỏ qua, không CAPTURED', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `deadline_at = now() - interval '1 second', runninghub_task_id = 'rh-1'`);
    await sweeper.sweep();
    let outputsCalled = 0;
    worker.rh = { outputs: async () => { outputsCalled++; return { status: 'SUCCESS', fileUrl: 'http://x/y.png' }; } };
    await worker.processTask(id);
    assert.equal(outputsCalled, 0);
    assert.equal((await ledger(id, 'CAPTURED')).length, 0);
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('abortTask dừng ingest đang chờ putObject', async () => {
    await clean();
    const id = await running(await newUser());
    await upd(id, `deadline_at = now() + interval '2 minutes', runninghub_task_id = 'rh-1'`);
    let started;
    const startedP = new Promise((r) => (started = r));
    worker.rh = { outputs: async () => ({ status: 'SUCCESS', fileUrl: 'http://x/y.png' }) };
    worker.ingestor = {
      ingest: async (_t, _u, _m, signal) => {
        started();
        await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }));
      },
    };
    const ctrl = new AbortController();
    worker.controllers.set(id, ctrl);
    const p = worker.processTask(id, ctrl.signal);
    await startedP;
    await upd(id, `deadline_at = now() - interval '1 second'`);
    await sweeper.sweep();
    await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('processTask không dừng')), 3000))]);
    worker.controllers.delete(id);
    assert.equal(ctrl.signal.aborted, true);
    assert.equal((await row(id)).status, 'timed_out');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('sweep không chạy chồng chu kỳ', async () => {
    sweeper.running = true;
    const orig = svc.sweepQueued;
    let called = 0;
    svc.sweepQueued = async () => { called++; return []; };
    try { await sweeper.sweep(); } finally { svc.sweepQueued = orig; sweeper.running = false; }
    assert.equal(called, 0);
  });
});
