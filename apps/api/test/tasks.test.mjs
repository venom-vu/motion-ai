import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiErrorCode, TaskSchema } from '@motion-ai/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';

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


// Queue giả: không chạm Redis thật.
const queueCalls = [];
let queueFail = false;
Queue.prototype.add = async function (name, data, opts) {
  if (queueFail) throw new Error('redis down');
  queueCalls.push({ name, data, opts });
  return { id: opts?.jobId };
};

describe('Story 2.3: [BE] Tạo Task Face Swap và xếp vào hàng đợi', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const wallet = new WalletService();

  async function newUser({ balance = 500, locked = false } = {}) {
    const n = users.length;
    const u = await prisma.user.create({
      data: {
        googleId: `tk-${runId}-${n}`,
        email: `tk-${runId}-${n}@motionai.vn`,
        tosVersion: 'tos-v7',
        lockedAt: locked ? new Date() : null,
      },
    });
    users.push(u.id);
    if (balance > 0) await prisma.$transaction((t) => wallet.grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function confirmedKeys(user, n = 2, confirmed = true) {
    const keys = [];
    for (let i = 0; i < n; i++) {
      const uuid = crypto.randomUUID();
      const key = `in-raw/${user.id}/${uuid}`;
      const confirmedKey = `in/${user.id}/${uuid}`;
      await prisma.upload.create({
        data: {
          userId: user.id, key, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10,
          status: confirmed ? 'confirmed' : 'pending',
          confirmedKey: confirmed ? confirmedKey : null,
        },
      });
      keys.push(confirmedKey);
    }
    return keys;
  }
  const post = (user, body) =>
    fetch(`${baseUrl}/tasks/face-swap`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function validBody(user) {
    const [sourceKey, targetKey] = await confirmedKeys(user);
    return { sourceKey, targetKey, consent: true };
  }
  const wal = async (u) => prisma.user.findUnique({ where: { id: u.id } });
  const taskCount = (u) => prisma.task.count({ where: { userId: u.id } });

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
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('migration: cột, CHECK, chỉ mục và FK hoãn', async () => {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='tasks'`,
    );
    for (const c of ['id','user_id','pipeline','status','reason_code','tier_snapshot','consent','tos_version','input_keys','params','hold_amount','queued_at','enqueue_attempts','created_at','updated_at']) {
      assert.ok(cols.rows.some((r) => r.column_name === c), c);
    }
    const u = await newUser({ balance: 0 });
    const ins = (status, pipeline, consent, hold) =>
      pool.query(
        `INSERT INTO tasks (id,user_id,pipeline,status,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,updated_at)
         VALUES (gen_random_uuid(),$1,$2,$3,'{}','${'$'}{consent}','t','{}','{}',$4,now())`.replace("'${consent}'", String(consent)),
        [u.id, pipeline, status, hold],
      );
    await assert.rejects(ins('rejected', 'face_swap', true, 100), /tasks_status_valid_chk/);
    await assert.rejects(ins('queued', 'other', true, 100), /tasks_pipeline_valid_chk/);
    await assert.rejects(ins('queued', 'face_swap', false, 100), /tasks_consent_true_chk/);
    await assert.rejects(ins('queued', 'face_swap', true, 0), /tasks_hold_amount_positive_chk/);
    await ins('queued', 'face_swap', true, 100);
    const fk = await pool.query(
      `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname='ledger_entries_task_id_fkey'`,
    );
    assert.equal(fk.rows[0].condeferrable, true);
    assert.equal(fk.rows[0].condeferred, true);
    await assert.rejects(
      pool.query(`INSERT INTO ledger_entries(user_id,type,amount,task_id) VALUES($1,'HOLD',-5,gen_random_uuid())`, [u.id]),
      /ledger_entries_task_id_fkey/,
    );
    const idx = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename='tasks'`);
    assert.ok(idx.rows.some((r) => r.indexname === 'tasks_user_id_status_idx'));
    assert.ok(idx.rows.some((r) => r.indexname === 'tasks_status_queued_at_idx'));
  });

  it('cần đăng nhập', async () => {
    const res = await fetch(`${baseUrl}/tasks/face-swap`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('tạo thành công: HOLD, Task queued, job jobId=taskId', async () => {
    const u = await newUser({ balance: 500 });
    const body = await validBody(u);
    queueCalls.length = 0;
    const t0 = Date.now();
    const res = await post(u, body);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(res.status, 201);
    const task = await res.json();
    assert.equal(TaskSchema.safeParse(task).success, true);
    assert.equal(task.status, 'queued');
    assert.equal(task.creditCost, 100);
    assert.equal(task.queuePosition >= 1, true);
    const w = await wal(u);
    assert.equal(w.balance, 400n);
    assert.equal(w.held, 100n);
    const hold = await prisma.ledgerEntry.findFirst({ where: { taskId: task.id, type: 'HOLD' } });
    assert.equal(hold.amount, -100n);
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    assert.equal(row.consent, true);
    assert.equal(row.tosVersion, 'tos-v7');
    assert.equal(row.holdAmount, 100);
    assert.deepEqual(row.inputKeys, { sourceKey: body.sourceKey, targetKey: body.targetKey });
    assert.equal(row.tierSnapshot.priority, 10);
    assert.equal(queueCalls.length, 1);
    assert.equal(queueCalls[0].opts.jobId, task.id);
    assert.equal(queueCalls[0].opts.priority, 10);
    assert.equal(queueCalls[0].opts.removeOnComplete, true);
    assert.equal(queueCalls[0].opts.removeOnFail, true);
  });

  it('consent sai hoặc vắng -> CONSENT_REQUIRED; trường khác -> VALIDATION_FAILED', async () => {
    const u = await newUser();
    const body = await validBody(u);
    queueCalls.length = 0;
    for (const b of [{ ...body, consent: false }, { sourceKey: body.sourceKey, targetKey: body.targetKey }]) {
      const res = await post(u, b);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, ApiErrorCode.CONSENT_REQUIRED);
    }
    const res = await post(u, { ...body, sourceKey: 'bad' });
    assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    assert.equal(await taskCount(u), 0);
    assert.equal((await wal(u)).held, 0n);
    assert.equal(queueCalls.length, 0);
  });

  it('tài khoản khóa -> ACCOUNT_LOCKED', async () => {
    const u = await newUser({ locked: true });
    const res = await post(u, await validBody(u));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, ApiErrorCode.ACCOUNT_LOCKED);
    assert.equal(await taskCount(u), 0);
  });

  it('khóa tài khoản dưới khóa dòng user -> ACCOUNT_LOCKED, không HOLD', async () => {
    const u = await newUser({ balance: 500 });
    const body = await validBody(u);
    await pool.query('UPDATE users SET locked_at = now() WHERE id = $1', [u.id]);
    const svc = app.get((await import('../dist/modules/tasks/index.js')).TasksService);
    await assert.rejects(svc.createFaceSwap(u.id, body), (e) => e.getResponse().code === ApiErrorCode.ACCOUNT_LOCKED);
    assert.equal((await wal(u)).held, 0n);
    assert.equal(await taskCount(u), 0);
  });

  it('thiếu số dư -> INSUFFICIENT_CREDIT, số dư giữ nguyên', async () => {
    const u = await newUser({ balance: 99 });
    queueCalls.length = 0;
    const res = await post(u, await validBody(u));
    assert.equal(res.status, 402);
    assert.equal((await res.json()).code, ApiErrorCode.INSUFFICIENT_CREDIT);
    const w = await wal(u);
    assert.equal(w.balance, 99n);
    assert.equal(w.held, 0n);
    assert.equal(await taskCount(u), 0);
    assert.equal(queueCalls.length, 0);
  });

  it('đã có 3 Task hoạt động -> TASK_LIMIT, không HOLD', async () => {
    const u = await newUser({ balance: 1000 });
    for (let i = 0; i < 3; i++) {
      const r = await post(u, await validBody(u));
      assert.equal(r.status, 201);
      assert.ok((await r.json()).queuePosition >= 1);
    }
    const res = await post(u, await validBody(u));
    assert.equal(res.status, 429);
    assert.equal((await res.json()).code, ApiErrorCode.TASK_LIMIT);
    const w = await wal(u);
    assert.equal(w.held, 300n);
    assert.equal(w.balance, 700n);
    assert.equal(await taskCount(u), 3);
  });

  it('khóa không hợp lệ: của người khác / chưa confirmed / không tồn tại', async () => {
    const u = await newUser();
    const other = await newUser();
    const mine = await confirmedKeys(u, 1);
    const theirs = await confirmedKeys(other, 1);
    const pending = await confirmedKeys(u, 1, false);
    const ghost = `in/${u.id}/${crypto.randomUUID()}`;
    const inputs = [
      { sourceKey: mine[0], targetKey: theirs[0] },
      { sourceKey: mine[0], targetKey: `in/${u.id}/${pending[0].split('/')[2]}` },
      { sourceKey: mine[0], targetKey: ghost },
    ];
    for (const i of inputs) {
      const res = await post(u, { ...i, consent: true });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    }
    assert.equal(await taskCount(u), 0);
    assert.equal((await wal(u)).held, 0n);
  });

  it('ba request song song với số dư 250: đúng 2 thành công', async () => {
    const u = await newUser({ balance: 250 });
    const bodies = [await validBody(u), await validBody(u), await validBody(u)];
    const results = await Promise.all(bodies.map((b) => post(u, b)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 201, 402]);
    const w = await wal(u);
    assert.equal(w.balance, 50n);
    assert.equal(w.held, 200n);
    assert.equal(await taskCount(u), 2);
  });

  const queuedCount = async () =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE status='queued'`)).rows[0].n);
  const insertSqlTask = async (u, status, priority = 10, queuedAtSql = 'now()') => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,reason_code,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,queued_at,updated_at)
       VALUES ($1,$2,'face_swap',$3,$4,$5::jsonb,true,'t','{}','{}',100,${queuedAtSql},now())`,
      [id, u.id, status, ['failed', 'timed_out'].includes(status) ? 'RH_ERROR' : null, JSON.stringify({ tier: 'x', priority, maxVideoSeconds: 5 })],
    );
    return id;
  };

  // Dọn Task queued của các user test để vị trí chỉ phụ thuộc phần hàng đợi còn lại (foreign).
  const clearOwnQueued = () =>
    pool.query(
      `UPDATE tasks SET status='cancelled', reason_code='USER_CANCEL' WHERE status='queued' AND user_id = ANY($1::uuid[])`,
      [users],
    );

  it('queuePosition: 3 Task cùng priority nhận vị trí 1,2,3 (cộng phần hàng đợi ngoài)', async () => {
    await clearOwnQueued();
    const foreign = await queuedCount();
    const u = await newUser({ balance: 500 });
    const positions = [];
    for (let i = 0; i < 3; i++) {
      const res = await post(u, await validBody(u));
      assert.equal(res.status, 201);
      positions.push((await res.json()).queuePosition);
    }
    assert.deepEqual(positions, [foreign + 1, foreign + 2, foreign + 3]);
  });

  it('queuePosition: Task priority 1 xếp trước Task FREE tạo sau, dù queued_at muộn hơn', async () => {
    await clearOwnQueued();
    const foreign = await queuedCount();
    const a = await newUser({ balance: 0 });
    const b = await newUser({ balance: 500 });
    await insertSqlTask(a, 'queued', 1, `now() + interval '1 hour'`);
    const res = await post(b, await validBody(b));
    assert.equal(res.status, 201);
    assert.equal((await res.json()).queuePosition, foreign + 2);
  });

  it('TASK_LIMIT song song: số dư 1000, 4 request -> 3 thành công, 1 TASK_LIMIT', async () => {
    const u = await newUser({ balance: 1000 });
    const bodies = [await validBody(u), await validBody(u), await validBody(u), await validBody(u)];
    const results = await Promise.all(bodies.map((b) => post(u, b)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 201, 429]);
    const limited = results.find((r) => r.status === 429);
    assert.equal((await limited.json()).code, ApiErrorCode.TASK_LIMIT);
    const w = await wal(u);
    assert.equal(w.held, 300n);
    assert.equal(w.balance, 700n);
    assert.equal(await taskCount(u), 3);
  });

  it('TASK_LIMIT: running tính vào giới hạn, succeeded/failed không tính', async () => {
    const u = await newUser({ balance: 1000 });
    const r1 = await insertSqlTask(u, 'running');
    const r2 = await insertSqlTask(u, 'running');
    await insertSqlTask(u, 'queued');
    let res = await post(u, await validBody(u));
    assert.equal(res.status, 429);
    assert.equal((await res.json()).code, ApiErrorCode.TASK_LIMIT);
    assert.equal((await wal(u)).held, 0n);
    await pool.query(`UPDATE tasks SET status='succeeded', result_key='out/'||user_id::text||'/'||id::text WHERE id=$1`, [r1]);
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR' WHERE id=$1`, [r2]);
    res = await post(u, await validBody(u));
    assert.equal(res.status, 201);
    assert.equal((await wal(u)).held, 100n);
  });

  it('hạng trả phí: tier_pack=pro -> tier_snapshot.priority=2 và opts.priority=2', async () => {
    const u = await newUser({ balance: 500 });
    await pool.query(`UPDATE users SET tier_pack='pro' WHERE id=$1`, [u.id]);
    queueCalls.length = 0;
    const res = await post(u, await validBody(u));
    assert.equal(res.status, 201);
    const task = await res.json();
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    assert.equal(row.tierSnapshot.priority, 2);
    assert.equal(row.tierSnapshot.tier, 'Pro');
    assert.equal(queueCalls.length, 1);
    assert.equal(queueCalls[0].opts.priority, 2);
  });

  it('enqueue lỗi sau commit: vẫn 201, Task và HOLD còn trong DB', async () => {
    const u = await newUser();
    const body = await validBody(u);
    queueFail = true;
    try {
      const res = await post(u, body);
      assert.equal(res.status, 201);
      const task = await res.json();
      const row = await prisma.task.findUnique({ where: { id: task.id } });
      assert.equal(row.status, 'queued');
      assert.equal((await wal(u)).held, 100n);
    } finally {
      queueFail = false;
    }
  });
});
