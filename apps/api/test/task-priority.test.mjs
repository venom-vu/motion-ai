import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Worker } from 'bullmq';
import { RedisService } from '../dist/infra/redis.service.js';
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




process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';

describe('Story 2.8: [BE] Ưu tiên theo Tier và hết hạn hàng đợi FREE', () => {
  let app, baseUrl, pool, prisma, jwt, svc, sweeper, queue;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const taskIds = [];

  async function newUser(balance = 5000, pack = null) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `p-${runId}-${n}`, email: `p-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    if (pack) await pool.query('UPDATE users SET tier_pack=$1 WHERE id=$2', [pack, u.id]);
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

  it('Redis thật: Priority nhỏ chạy trước, cùng Priority FIFO, FREE sau cùng, job đang chạy không bị ngắt', async () => {
    await clean();
    const free = await newUser(5000);
    const p3 = await newUser(5000, 'starter');
    const p1 = await newUser(5000, 'creator');
    const blocker = await createTask(free);
    const tFree = await createTask(await newUser(5000));
    const t3a = await createTask(p3);
    const t1 = await createTask(p1);
    const t3b = await createTask(p3);
    for (const id of [blocker, tFree, t3a, t1, t3b]) await queue.remove(id).catch(() => {});
    assert.equal((await row(t1)).tier_snapshot.priority, 1);
    assert.equal((await row(t3a)).tier_snapshot.priority, 3);
    // blocker vào trước, chiếm Lane; các job còn lại vào hàng đợi theo thứ tự tạo
    const order = [];
    let release;
    const hold = new Promise((r) => (release = r));
    const redis = app.get(RedisService);
    const add = (id, prio) => queue.add('process', { taskId: id }, { jobId: id, priority: prio, removeOnComplete: true, removeOnFail: true });
    await add(blocker, 10);
    const w = new Worker('tasks', async (job) => {
      order.push(job.data.taskId);
      if (job.data.taskId === blocker) await hold;
    }, { connection: redis.getWorkerConnectionOptions(), concurrency: 1 });
    try {
      for (let i = 0; i < 100 && order.length < 1; i++) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(order, [blocker]);
      await add(tFree, 10); await add(t3a, 3); await add(t1, 1); await add(t3b, 3);
      assert.deepEqual(order, [blocker], 'job ưu tiên cao đến không ngắt job đang chạy');
      release();
      for (let i = 0; i < 100 && order.length < 5; i++) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(order, [blocker, t1, t3a, t3b, tFree]);
    } finally {
      release();
      await w.close();
    }
  });

  it('Task FREE queued quá 15 phút: timed_out/FREE_WAIT_EXPIRED, một RELEASED, job bị xóa', async () => {
    await clean();
    const id = await createTask(await newUser());
    await queue.add('process', { taskId: id }, { jobId: id, priority: 10 });
    await upd(id, `queued_at = now() - interval '16 minutes'`);
    await sweeper.sweep();
    const r = await row(id);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'FREE_WAIT_EXPIRED');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
    assert.equal(await queue.getJob(id), undefined);
    await sweeper.sweep();
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('Task FREE dưới 15 phút và Task trả phí quá 15 phút không bị hết hạn', async () => {
    await clean();
    const a = await createTask(await newUser());
    const b = await createTask(await newUser(5000, 'starter'));
    await upd(a, `queued_at = now() - interval '14 minutes'`);
    await upd(b, `queued_at = now() - interval '30 minutes'`);
    await sweeper.sweep();
    assert.equal((await row(a)).status, 'queued');
    assert.equal((await row(b)).status, 'queued');
  });

  it('Tier đổi sau khi tạo Task: Task giữ Priority của snapshot', async () => {
    await clean();
    const u = await newUser();
    const id = await createTask(u);
    await pool.query(`UPDATE users SET tier_pack='creator' WHERE id=$1`, [u.id]);
    await upd(id, `queued_at = now() - interval '16 minutes'`);
    await sweeper.sweep();
    const r = await row(id);
    assert.equal(r.tier_snapshot.priority, 10);
    assert.equal(r.reason_code, 'FREE_WAIT_EXPIRED');
  });

  it('Xử lý theo lô LIMIT: hơn một lô vẫn hết hạn dần, lỗi một Task không chặn Task khác', async () => {
    await clean();
    const a = await createTask(await newUser());
    const b = await createTask(await newUser());
    await upd(a, `queued_at = now() - interval '20 minutes'`);
    await upd(b, `queued_at = now() - interval '20 minutes'`);
    const orig = svc.transition.bind(svc);
    svc.transition = async (id, ...rest) => { if (id === a) throw new Error('boom'); return orig(id, ...rest); };
    try { await sweeper.sweep(); } finally { svc.transition = orig; }
    assert.equal((await row(b)).status, 'timed_out');
    assert.equal((await row(a)).status, 'queued');
  });

  it('Worker không chạy Task FREE đã chờ quá 15 phút: timed_out/FREE_WAIT_EXPIRED', async () => {
    await clean();
    const id = await createTask(await newUser());
    await upd(id, `queued_at = now() - interval '16 minutes'`);
    await app.get(TaskWorkerService).processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'timed_out');
    assert.equal(r.reason_code, 'FREE_WAIT_EXPIRED');
    assert.equal((await ledger(id, 'RELEASED')).length, 1);
  });

  it('Job running còn trong hàng (waiting) quá prep: không PREP_TIMEOUT', async () => {
    await clean();
    const id = await createTask(await newUser());
    await svc.transition(id, 'queued', 'running');
    await queue.add('process', { taskId: id }, { jobId: id, priority: 10, delay: 60_000 });
    await upd(id, `prep_deadline_at = now() - interval '1 second'`);
    await sweeper.sweep();
    assert.equal((await row(id)).status, 'running');
    await queue.remove(id);
  });
});
