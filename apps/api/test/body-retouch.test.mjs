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
import { PipelinesModule } from '../dist/modules/pipelines/index.js';
import { ApiErrorCode, TaskSchema } from '@flowvis/contracts';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService, TaskWorkerService, WORKER_CONCURRENCY } from '../dist/modules/tasks/index.js';

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


describe('Story 4.2: [BE] Tạo Task Body Retouch', () => {
  let app, baseUrl, pool, prisma, jwt, svc, worker;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  let submits, outputsQueue;

  async function newUser({ balance = 500, locked = false } = {}) {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `br-${runId}-${n}`, email: `br-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', lockedAt: locked ? new Date() : null } });
    users.push(u.id);
    if (balance > 0) await prisma.$transaction((t) => new WalletService().grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function key(user) {
    const uuid = crypto.randomUUID();
    await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` } });
    return `in/${user.id}/${uuid}`;
  }
  const post = (user, body) => fetch(`${baseUrl}/tasks/body-retouch`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const countFor = async (u) => ({
    tasks: (await pool.query('SELECT count(*)::int n FROM tasks WHERE user_id=$1', [u.id])).rows[0].n,
    ledger: (await pool.query('SELECT count(*)::int n FROM ledger_entries WHERE user_id=$1 AND type=\'HOLD\'', [u.id])).rows[0].n,
  });
  async function clearActive() {
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    process.env.RH_MAX_CONCURRENT = String((await svc.countGateOccupied()) + 2);
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
    let up = 0;
    worker.rh = {
      uploadFile: async () => `f${++up}`,
      submit: async (workflowId, nodeInfo) => { submits.push({ workflowId, nodeInfo }); return 'rh-1'; },
      outputs: async () => outputsQueue[0],
    };
    worker.storage = { getObject: async () => Buffer.from('img') };
    worker.ingestor = { ingest: async () => {} };
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

  it('tạo hợp lệ: queued, HOLD 100, params.intensity=8, enqueue jobId=taskId', async () => {
    const u = await newUser();
    queueCalls.length = 0;
    const res = await post(u, { imageKey: await key(u), intensity: 8 });
    assert.equal(res.status, 201);
    const t = TaskSchema.parse(await res.json());
    assert.equal(t.pipeline, 'body_retouch');
    assert.equal(t.status, 'queued');
    assert.equal(t.creditCost, 100);
    const r = await row(t.id);
    assert.deepEqual(r.params, { intensity: 8 });
    assert.equal(r.pipeline, 'body_retouch');
    const holds = await prisma.ledgerEntry.findMany({ where: { taskId: t.id, type: 'HOLD' } });
    assert.equal(holds.length, 1);
    assert.equal(Number(holds[0].amount), -100);
    assert.equal(queueCalls.length, 1);
    assert.equal(queueCalls[0].opts.jobId, t.id);
  });

  it('thiếu intensity => 5', async () => {
    const u = await newUser();
    const res = await post(u, { imageKey: await key(u) });
    assert.equal(res.status, 201);
    assert.deepEqual((await row((await res.json()).id)).params, { intensity: 5 });
  });

  it('intensity sai => 400 VALIDATION_FAILED, không HOLD, không Task', async () => {
    const u = await newUser();
    for (const intensity of [0, 11, 5.5, '5']) {
      const res = await post(u, { imageKey: await key(u), intensity });
      assert.equal(res.status, 400, String(intensity));
      assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    }
    assert.deepEqual(await countFor(u), { tasks: 0, ledger: 0 });
  });

  it('khóa ảnh không thuộc người dùng => VALIDATION_FAILED', async () => {
    const a = await newUser(); const b = await newUser();
    const res = await post(a, { imageKey: await key(b) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    assert.deepEqual(await countFor(a), { tasks: 0, ledger: 0 });
  });

  it('lỗi nghiệp vụ: bị khóa / thiếu số dư / TASK_LIMIT', async () => {
    const locked = await newUser({ locked: true });
    let res = await post(locked, { imageKey: await key(locked) });
    assert.equal((await res.json()).code, ApiErrorCode.ACCOUNT_LOCKED);
    assert.deepEqual(await countFor(locked), { tasks: 0, ledger: 0 });

    const poor = await newUser({ balance: 99 });
    res = await post(poor, { imageKey: await key(poor) });
    assert.equal((await res.json()).code, ApiErrorCode.INSUFFICIENT_CREDIT);
    assert.deepEqual(await countFor(poor), { tasks: 0, ledger: 0 });

    const busy = await newUser({ balance: 1000 });
    for (let i = 0; i < 3; i++) assert.equal((await post(busy, { imageKey: await key(busy) })).status, 201);
    res = await post(busy, { imageKey: await key(busy) });
    assert.equal((await res.json()).code, ApiErrorCode.TASK_LIMIT);
    assert.deepEqual(await countFor(busy), { tasks: 3, ledger: 3 });
  });

  it('worker: nodeInfoList có node ảnh và node intensity = "8", workflow body', async () => {
    await clearActive();
    submits = [];
    outputsQueue = [{ status: 'SUCCESS', fileUrl: 'http://x/y.png', consumeMoney: 1 }];
    const u = await newUser();
    const id = (await (await post(u, { imageKey: await key(u), intensity: 8 })).json()).id;
    await worker.processTask(id);
    assert.equal(submits.length, 1);
    assert.equal(submits[0].workflowId, process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE);
    const nodes = submits[0].nodeInfo;
    assert.equal(nodes.length, 2);
    assert.ok(nodes.some((n) => n.fieldName === 'image' && n.fieldValue === 'f1'));
    assert.ok(nodes.some((n) => n.fieldName === 'intensity' && n.fieldValue === '8'));
  });

  it('workflow trả NO_POSE => failed/NO_POSE, RELEASED 100%', async () => {
    await clearActive();
    submits = [];
    outputsQueue = [{ status: 'FAILED', errorMessage: 'NO_POSE not found', consumeMoney: 0 }];
    const u = await newUser();
    const id = (await (await post(u, { imageKey: await key(u) })).json()).id;
    await worker.processTask(id);
    const r = await row(id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, 'NO_POSE');
    const rel = await prisma.ledgerEntry.findMany({ where: { taskId: id, type: 'RELEASED' } });
    assert.equal(rel.length, 1);
    assert.equal(Number(rel[0].amount), 100);
  });

  it('dùng chung hàng đợi: BullMQ queue "tasks" cho cả hai pipeline', async () => {
    const u = await newUser();
    queueCalls.length = 0;
    await post(u, { imageKey: await key(u) });
    assert.equal(queueCalls[0].name, 'process');
    assert.equal(WORKER_CONCURRENCY, 2);
  });

  it('thiếu RUNNINGHUB_WORKFLOW_BODY_RESHAPE => khởi động thất bại, nêu tên biến', async () => {
    const saved = process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE;
    delete process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE;
    try {
      // api và worker cùng nạp PipelinesModule; vòng đời Nest phải tự gọi onModuleInit và làm khởi động thất bại.
      await assert.rejects(
        NestFactory.createApplicationContext(PipelinesModule, { logger: false, abortOnError: false }),
        /RUNNINGHUB_WORKFLOW_BODY_RESHAPE/,
      );
    } finally {
      if (saved === undefined) delete process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE;
      else process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE = saved;
    }
    const ctx = await NestFactory.createApplicationContext(PipelinesModule, { logger: false, abortOnError: false });
    await ctx.close();
  });
});
