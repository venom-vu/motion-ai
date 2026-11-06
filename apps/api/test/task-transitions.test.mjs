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
import { TasksService } from '../dist/modules/tasks/index.js';
import { RedisService } from '../dist/infra/redis.service.js';

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



const queueCalls = [];
Queue.prototype.add = async function (name, data, opts) {
  queueCalls.push({ name, data, opts });
  return { id: opts?.jobId };
};
const removed = [];
const getJobMode = { value: 'ok' }; // 'ok' | 'throw' | 'remove-throws'
Queue.prototype.getJob = async function (id) {
  if (getJobMode.value === 'throw') throw new Error('getJob down');
  if (getJobMode.value === 'remove-throws') {
    return { remove: async () => { throw new Error('remove down'); } };
  }
  return { remove: async () => { removed.push(id); } };
};

describe('Story 2.4: [BE] Máy trạng thái Task bằng compare-and-set', () => {
  let app, baseUrl, pool, prisma, jwt, svc;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];

  async function newUser(balance = 500) {
    const n = users.length;
    const u = await prisma.user.create({
      data: { googleId: `tr-${runId}-${n}`, email: `tr-${runId}-${n}@motionai.vn`, tosVersion: 'tos-v7' },
    });
    users.push(u.id);
    if (balance > 0) await prisma.$transaction((t) => new WalletService().grant(t, u.id, balance));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function createTask(user) {
    const keys = [];
    for (let i = 0; i < 2; i++) {
      const uuid = crypto.randomUUID();
      await prisma.upload.create({
        data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind: 'image', mimeType: 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}` },
      });
      keys.push(`in/${user.id}/${uuid}`);
    }
    const res = await fetch(`${baseUrl}/tasks/face-swap`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKey: keys[0], targetKey: keys[1], consent: true }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).id;
  }
  async function runningTask(user) {
    const id = await createTask(user);
    const r = await svc.transition(id, 'queued', 'running');
    assert.equal(r.applied, true);
    return id;
  }
  const api = (user, method, p) =>
    fetch(`${baseUrl}${p}`, { method, headers: { Authorization: `Bearer ${user.token}` } });
  const wal = (u) => prisma.user.findUnique({ where: { id: u.id } });
  const entries = (taskId, type) => prisma.ledgerEntry.findMany({ where: { taskId, type } });
  const resultKey = (u) => `out/${u.id}/${crypto.randomUUID()}`;

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
    svc = app.get(TasksService);
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

  it('migration: result_key và hai CHECK', async () => {
    const u = await newUser(0);
    const ins = (status, rk) =>
      pool.query(
        `INSERT INTO tasks (id,user_id,pipeline,status,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,result_key,updated_at)
         VALUES (gen_random_uuid(),$1,'face_swap',$2,'{}',true,'t','{}','{}',100,$3,now())`,
        [u.id, status, rk],
      );
    await assert.rejects(ins('succeeded', null), /tasks_succeeded_result_key_chk/);
    await assert.rejects(ins('queued', 'out/x/y'), /tasks_result_key_only_succeeded_chk/);
  });

  it('running -> succeeded: một CAPTURED, held giảm, result_key ghi', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    assert.equal((await wal(u)).held, 100n);
    const rk = resultKey(u);
    assert.deepEqual(await svc.transition(id, 'running', 'succeeded', null, { resultKey: rk }), { applied: true });
    assert.equal((await entries(id, 'CAPTURED')).length, 1);
    const w = await wal(u);
    assert.equal(w.held, 0n);
    assert.equal(w.balance, 400n);
    const row = await prisma.task.findUnique({ where: { id } });
    assert.equal(row.resultKey, rk);
    const res = await api(u, 'GET', `/tasks/${id}`);
    const t = await res.json();
    assert.equal(TaskSchema.safeParse(t).success, true);
    assert.equal(t.status, 'succeeded');
    assert.equal(t.resultKey, rk);
  });

  it('failed / timed_out: một RELEASED, hoàn balance', async () => {
    const u = await newUser();
    const a = await runningTask(u);
    assert.equal((await svc.transition(a, 'running', 'failed', 'NO_FACE')).applied, true);
    const b = await createTask(u);
    assert.equal((await svc.transition(b, 'queued', 'timed_out', 'FREE_WAIT_EXPIRED')).applied, true);
    for (const id of [a, b]) {
      const r = await entries(id, 'RELEASED');
      assert.equal(r.length, 1);
      assert.equal(r[0].amount, 100n);
    }
    const w = await wal(u);
    assert.equal(w.balance, 500n);
    assert.equal(w.held, 0n);
    const t = await (await api(u, 'GET', `/tasks/${a}`)).json();
    assert.equal(t.reasonCode, 'NO_FACE');
    assert.equal(t.queuePosition ?? null, null);
    assert.equal(TaskSchema.safeParse(t).success, true);
  });

  it('kết quả đến muộn: applied=false, sổ cái không đổi', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    await svc.transition(id, 'running', 'timed_out', 'RH_TIMEOUT');
    const r = await svc.transition(id, 'running', 'succeeded', null, { resultKey: resultKey(u) });
    assert.deepEqual(r, { applied: false });
    assert.equal((await entries(id, 'CAPTURED')).length, 0);
    assert.equal((await entries(id, 'RELEASED')).length, 1);
    assert.equal((await prisma.task.findUnique({ where: { id } })).status, 'timed_out');
  });

  it('hai bên kết thúc song song: đúng một bên thắng', async () => {
    for (let i = 0; i < 5; i++) {
      const u = await newUser();
      const id = await runningTask(u);
      const rs = await Promise.all([
        svc.transition(id, 'running', 'succeeded', null, { resultKey: resultKey(u) }),
        svc.transition(id, 'running', 'timed_out', 'RH_TIMEOUT'),
      ]);
      assert.equal(rs.filter((r) => r.applied).length, 1);
      const c = (await entries(id, 'CAPTURED')).length;
      const rl = (await entries(id, 'RELEASED')).length;
      assert.equal(c + rl, 1);
    }
  });

  it('chuyển ngoài bảng và reasonCode sai bị từ chối trước DB', async () => {
    const u = await newUser();
    const id = await createTask(u);
    const before = await prisma.task.findUnique({ where: { id } });
    const bad = [
      ['succeeded', 'running', null],
      ['queued', 'succeeded', null],
      ['running', 'queued', null],
      ['running', 'failed', null],
      ['queued', 'cancelled', 'NO_FACE'],
      ['running', 'failed', 'PREP_TIMEOUT'],
      ['queued', 'running', 'NO_FACE'],
      ['running', 'timed_out', 'NO_FACE'],
      ['queued', 'failed', 'USER_CANCEL'],
    ];
    for (const [f, t, rc] of bad) {
      await assert.rejects(svc.transition(id, f, t, rc), Error, `${f}->${t}/${rc}`);
    }
    await assert.rejects(svc.transition(id, 'running', 'succeeded'), Error);
    const after = await prisma.task.findUnique({ where: { id } });
    assert.deepEqual(after, before);
  });

  it('resultKey rác hoặc của người khác bị từ chối, rollback, chưa capture', async () => {
    const u = await newUser();
    const other = await newUser(0);
    const id = await runningTask(u);
    const bad = ['garbage', `out/${'-'.repeat(36)}/${'-'.repeat(36)}`, resultKey(other)];
    for (const k of bad) {
      await assert.rejects(svc.transition(id, 'running', 'succeeded', null, { resultKey: k }), Error, k);
    }
    const row = await prisma.task.findUnique({ where: { id } });
    assert.equal(row.status, 'running');
    assert.equal(row.resultKey, null);
    assert.equal((await entries(id, 'CAPTURED')).length, 0);
    assert.equal((await wal(u)).held, 100n);
  });

  it('khóa Redis chỉ đặt sau commit và khi applied=true', async () => {
    const u = await newUser();
    const redis = app.get(RedisService);
    const id = await runningTask(u);
    await redis.client.del(`task:terminal:${id}`);
    await assert.rejects(svc.transition(id, 'running', 'succeeded', null, { resultKey: resultKey(await newUser(0)) }));
    assert.equal(await redis.client.exists(`task:terminal:${id}`), 0);
    await svc.transition(id, 'running', 'failed', 'RH_ERROR');
    await redis.client.del(`task:terminal:${id}`);
    assert.equal((await svc.transition(id, 'running', 'timed_out', 'RH_TIMEOUT')).applied, false);
    assert.equal(await redis.client.exists(`task:terminal:${id}`), 0);
    const id2 = await runningTask(u);
    await svc.transition(id2, 'running', 'failed', 'RH_ERROR');
    // Khóa được ghi nền (không chờ) nên đợi tới khi xuất hiện.
    for (let i = 0; i < 50 && (await redis.client.exists(`task:terminal:${id2}`)) === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(await redis.client.exists(`task:terminal:${id2}`), 1);
  });

  it('Redis treo: chuyển trạng thái không bị trễ', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    const redis = app.get(RedisService);
    const orig = redis.client.set;
    redis.client.set = () => new Promise(() => {});
    try {
      const t0 = Date.now();
      assert.equal((await svc.transition(id, 'running', 'failed', 'RH_ERROR')).applied, true);
      assert.ok(Date.now() - t0 < 1000, `mất ${Date.now() - t0}ms`);
    } finally {
      redis.client.set = orig;
    }
    assert.equal((await entries(id, 'RELEASED')).length, 1);
  });

  it('resultKey với đích không phải succeeded bị từ chối', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    await assert.rejects(
      svc.transition(id, 'running', 'failed', 'RH_ERROR', { resultKey: resultKey(u) }),
      /resultKey chỉ dùng khi chuyển sang succeeded/,
    );
    const row = await prisma.task.findUnique({ where: { id } });
    assert.equal(row.status, 'running');
    assert.equal(row.resultKey, null);
    assert.equal((await entries(id, 'RELEASED')).length, 0);
    assert.equal((await wal(u)).held, 100n);
  });

  it('queued -> failed(INTERNAL_ERROR): RELEASED và hoàn credit', async () => {
    const u = await newUser();
    const id = await createTask(u);
    assert.deepEqual(await svc.transition(id, 'queued', 'failed', 'INTERNAL_ERROR'), { applied: true });
    const row = await prisma.task.findUnique({ where: { id } });
    assert.equal(row.status, 'failed');
    assert.equal(row.reasonCode, 'INTERNAL_ERROR');
    const r = await entries(id, 'RELEASED');
    assert.equal(r.length, 1);
    assert.equal(r[0].amount, 100n);
    const w = await wal(u);
    assert.equal(w.balance, 500n);
    assert.equal(w.held, 0n);
  });

  for (const mode of ['throw', 'remove-throws']) {
    it(`hủy vẫn thành công khi xóa job lỗi (${mode})`, async () => {
      const u = await newUser();
      const id = await createTask(u);
      getJobMode.value = mode;
      try {
        const res = await api(u, 'POST', `/tasks/${id}/cancel`);
        assert.equal(res.status, 200);
        const t = await res.json();
        assert.equal(t.status, 'cancelled');
        assert.equal(t.reasonCode, 'USER_CANCEL');
      } finally {
        getJobMode.value = 'ok';
      }
      assert.equal((await prisma.task.findUnique({ where: { id } })).status, 'cancelled');
      assert.equal((await entries(id, 'RELEASED')).length, 1);
    });
  }

  it('Redis lỗi hoặc khóa mồ côi không chặn chuyển', async () => {
    const u = await newUser();
    const a = await runningTask(u);
    const redis = app.get(RedisService);
    await redis.client.set(`task:terminal:${a}`, '1', 'EX', 30);
    assert.equal((await svc.transition(a, 'running', 'failed', 'RH_ERROR')).applied, true);
    assert.equal((await entries(a, 'RELEASED')).length, 1);

    const b = await runningTask(u);
    const orig = redis.client.set;
    redis.client.set = async () => { throw new Error('redis down'); };
    try {
      assert.equal((await svc.transition(b, 'running', 'failed', 'RH_ERROR')).applied, true);
    } finally {
      redis.client.set = orig;
    }
    assert.equal((await entries(b, 'RELEASED')).length, 1);
  });

  it('lỗi ví rollback cả UPDATE', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    // Bút toán RELEASED có sẵn khiến wallet.release ném WalletConflict sau khi UPDATE đã chạy.
    await pool.query(
      `INSERT INTO ledger_entries (user_id, type, amount, task_id) VALUES ($1, 'RELEASED', 100, $2)`,
      [u.id, id],
    );
    await assert.rejects(svc.transition(id, 'running', 'failed', 'RH_ERROR'));
    const row = await prisma.task.findUnique({ where: { id } });
    assert.equal(row.status, 'running');
    assert.equal(row.reasonCode, null);
  });

  it('hủy Task queued: 200, RELEASED, xóa job', async () => {
    const u = await newUser();
    const id = await createTask(u);
    removed.length = 0;
    const res = await api(u, 'POST', `/tasks/${id}/cancel`);
    assert.equal(res.status, 200);
    const t = await res.json();
    assert.equal(t.status, 'cancelled');
    assert.equal(t.reasonCode, 'USER_CANCEL');
    assert.equal(TaskSchema.safeParse(t).success, true);
    assert.equal((await entries(id, 'RELEASED')).length, 1);
    assert.deepEqual(removed, [id]);
    assert.equal((await wal(u)).balance, 500n);
    const again = await api(u, 'POST', `/tasks/${id}/cancel`);
    assert.equal(again.status, 409);
  });

  it('hủy Task running -> CONFLICT, không đổi', async () => {
    const u = await newUser();
    const id = await runningTask(u);
    const res = await api(u, 'POST', `/tasks/${id}/cancel`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, ApiErrorCode.CONFLICT);
    assert.equal((await prisma.task.findUnique({ where: { id } })).status, 'running');
  });

  it('Task người khác hoặc không tồn tại -> NOT_FOUND', async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await createTask(a);
    for (const [m, p] of [
      ['POST', `/tasks/${id}/cancel`],
      ['GET', `/tasks/${id}`],
      ['GET', `/tasks/${crypto.randomUUID()}`],
      ['GET', `/tasks/not-a-uuid`],
    ]) {
      const res = await api(b, m, p);
      assert.equal(res.status, 404, `${m} ${p}`);
      assert.equal((await res.json()).code, ApiErrorCode.NOT_FOUND);
    }
    assert.equal((await prisma.task.findUnique({ where: { id } })).status, 'queued');
    assert.equal((await fetch(`${baseUrl}/tasks/${id}`)).status, 401);
  });

  it('GET Task queued: queuePosition theo FIFO', async () => {
    const u = await newUser(1000);
    const x = await createTask(u);
    const y = await createTask(u);
    const tx = await (await api(u, 'GET', `/tasks/${x}`)).json();
    const ty = await (await api(u, 'GET', `/tasks/${y}`)).json();
    assert.equal(TaskSchema.safeParse(tx).success, true);
    assert.equal(tx.status, 'queued');
    assert.ok(ty.queuePosition > tx.queuePosition);
    assert.equal(ty.queuePosition - tx.queuePosition, 1);
  });
});
