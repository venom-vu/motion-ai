import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OpsStatusResponseSchema, SystemStatusResponseSchema } from '@flowvis/contracts';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { BreakerService } from '../dist/modules/ops/breaker.service.js';
import { CREATES_TASK_KEY, IntakeOpenGuard } from '../dist/modules/ops/intake-open.guard.js';
import { TasksController } from '../dist/modules/tasks/tasks.controller.js';
import { TasksService } from '../dist/modules/tasks/tasks.service.js';
import { WalletService } from '../dist/modules/wallet/index.js';
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
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d', '--wait', ...services], { cwd: repoRoot, stdio: 'inherit' });
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit',
  });
}

describe('Story 6.2: [BE] Ngắt mạch và chặn tạo Task khi tạm dừng', () => {
  let app, baseUrl, pool, prisma, jwt, breaker, tasks, sweeper, wallet;
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  const alerts = [];
  let admin, user;
  const SNAP = JSON.stringify({ tier: 'free', priority: 10, maxVideoSeconds: 5 });

  async function mkUser(role = 'user') {
    const n = userIds.length;
    const u = await prisma.user.create({ data: { googleId: `ob-${runId}-${n}`, email: `ob-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', role } });
    userIds.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role }) };
  }
  async function addTask(status, reason, agoMs = 1000, absolute = false) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,reason_code,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,result_key,finished_at,updated_at)
       VALUES ($1,$2,'face_swap',$3,$4,$5::jsonb,true,'t','{}'::jsonb,'{}'::jsonb,100,$6,now() + ($8::int * interval '1 millisecond') - ($7::int * interval '1 millisecond'),now())`,
      [id, user.id, status, reason, SNAP, status === 'succeeded' ? `out/${user.id}/${id}` : null, agoMs, absolute ? 0 : 3600e3],
    );
    return id;
  }
  /** Task running thật có HOLD, để gọi tasks.transition (CAS + RELEASED). */
  async function liveTask() {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,running_at,updated_at)
       VALUES ($1,$2,'face_swap','running',$3::jsonb,true,'t','{}'::jsonb,'{}'::jsonb,100,now(),now())`,
      [id, user.id, SNAP],
    );
    await prisma.$transaction(async (tx) => {
      await wallet.grant(tx, user.id, 100);
      await wallet.hold(tx, user.id, id, 100);
    });
    return id;
  }
  /** 19 Task đủ điều kiện (16 succeeded, 3 lỗi cũ hơn): dưới ngưỡng 20 và không có chuỗi lỗi cuối. */
  async function seedBelowThreshold() {
    for (let i = 0; i < 3; i++) await addTask('failed', 'RH_ERROR', 10_000 + i);
    for (let i = 0; i < 16; i++) await addTask('succeeded', null, 1000 + i);
  }
  const flag = async (k) => (await pool.query('SELECT value FROM settings WHERE key=$1', [k])).rows[0]?.value;
  async function reset() {
    await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(`UPDATE settings SET value='false'::jsonb WHERE key IN ('intake_paused','rh_budget_exhausted')`);
    await pool.query(`UPDATE settings SET value='null'::jsonb WHERE key IN ('breaker_reset_at','last_breaker_trigger')`);
    alerts.length = 0;
  }
  const call = (who, method, url, body) =>
    fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // Dọn Task cũ của các test khác (finished_at trong 30 phút) bằng mốc reset để chỉ đếm dữ liệu của test này.
  const isolate = () => pool.query(`UPDATE settings SET value=to_jsonb(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE key='breaker_reset_at'`);

  before(async () => {
    delete process.env.OPS_BREAKER_DISABLED;
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
    breaker = app.get(BreakerService);
    tasks = app.get(TasksService);
    sweeper = app.get(TaskSweeperService);
    wallet = app.get(WalletService);
    breaker.notifier = { notify: async (e) => { alerts.push(e); } };
    admin = await mkUser('admin');
    user = await mkUser('user');
    await reset();
  });

  after(async () => {
    process.env.OPS_BREAKER_DISABLED = '1';
    if (pool) {
      await reset();
      await pool.query('DELETE FROM admin_audit WHERE admin_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('migration: bảng settings có bốn khóa mặc định', async () => {
    const r = await pool.query(`SELECT key FROM settings WHERE key IN ('intake_paused','rh_budget_exhausted','breaker_reset_at','last_breaker_trigger')`);
    assert.equal(r.rows.length, 4);
  });

  it('đúng 15% (3/20) không kích hoạt; 4/20 kích hoạt, một cảnh báo, last_breaker_trigger đầy đủ', async () => {
    await reset(); await isolate();
    for (let i = 0; i < 17; i++) await addTask('succeeded', null);
    for (let i = 0; i < 3; i++) await addTask('failed', 'RH_ERROR');
    // xen kẽ để chuỗi liên tiếp < 5
    assert.equal(await breaker.evaluate(), false);
    assert.equal(await flag('intake_paused'), false);
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', result_key=NULL WHERE id = (SELECT id FROM tasks WHERE user_id=$1 AND status='succeeded' LIMIT 1)`, [user.id]);
    assert.equal(await breaker.evaluate(), true);
    assert.equal(await flag('intake_paused'), true);
    assert.equal(alerts.length, 1);
    const t = await flag('last_breaker_trigger');
    assert.equal(t.rule, 'ERROR_RATE_15_PERCENT_20_TASKS_30_MIN');
    assert.equal(t.metrics.eligibleTasks, 20);
    assert.equal(t.metrics.systemFailures, 4);
    assert.ok(t.at);
    assert.equal(await breaker.evaluate(), false);
    await sweeper.sweep();
    assert.equal(alerts.length, 1);
  });

  it('5 lỗi hệ thống liên tiếp kích hoạt dù < 20 Task; succeeded cắt chuỗi', async () => {
    await reset(); await isolate();
    for (let i = 0; i < 4; i++) await addTask('failed', 'INTERNAL_ERROR', 5000 + i);
    await addTask('succeeded', null, 4000);
    await addTask('timed_out', 'RH_TIMEOUT', 3000);
    await addTask('failed', 'RH_ERROR', 2500);
    await addTask('failed', 'NO_POSE', 2200); // không cắt chuỗi
    await addTask('failed', 'FFMPEG_ERROR', 2000);
    await addTask('timed_out', 'PREP_TIMEOUT', 1500);
    assert.equal(await breaker.evaluate(), false); // chuỗi 4
    await addTask('failed', 'RH_SUBMIT_UNKNOWN', 1000);
    assert.equal(await breaker.evaluate(), true);
    assert.equal((await flag('last_breaker_trigger')).rule, 'CONSECUTIVE_5_SYSTEM_FAILURES');
    assert.equal(alerts.length, 1);
  });

  it('lỗi người dùng/nội dung không đếm', async () => {
    await reset(); await isolate();
    for (let i = 0; i < 15; i++) await addTask('failed', 'NO_POSE');
    for (let i = 0; i < 15; i++) await addTask('failed', 'CONTENT_BLOCKED');
    for (const r of ['NO_FACE', 'USER_CANCEL', 'FREE_WAIT_EXPIRED', 'RH_BUDGET', 'RH_GATE_TIMEOUT']) await addTask('failed', r);
    assert.equal(await breaker.evaluate(), false);
    assert.equal(alerts.length, 0);
  });

  it('gửi cảnh báo lỗi không làm hỏng đánh giá; tín hiệu sau transition không làm hỏng transition', async () => {
    await reset(); await isolate();
    breaker.notifier = { notify: async () => { throw new Error('discord down'); } };
    for (let i = 0; i < 5; i++) await addTask('failed', 'RH_ERROR');
    assert.equal(await breaker.evaluate(), true);
    assert.equal(await flag('intake_paused'), true);
    breaker.notifier = { notify: async (e) => { alerts.push(e); } };
    await reset();
    const throwing = async () => { throw new Error('boom'); };
    tasks.onTerminal(throwing);
    try {
      const id = await liveTask();
      const res = await tasks.transition(id, 'running', 'failed', 'RH_ERROR');
      assert.equal(res.applied, true);
      assert.equal((await pool.query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status, 'failed');
      await tasks.emitTerminal();
    } finally {
      tasks.terminalListeners.splice(tasks.terminalListeners.indexOf(throwing), 1);
    }
  });

  it('chuỗi thật: tasks.transition -> emitTerminal -> BreakerService.evaluate kích hoạt đúng một cảnh báo', async () => {
    await reset(); await isolate();
    await seedBelowThreshold();
    assert.equal(await flag('intake_paused'), false);
    const id = await liveTask();
    assert.equal((await tasks.transition(id, 'running', 'failed', 'RH_ERROR')).applied, true);
    // Tín hiệu do transition tự phát (không gọi emitTerminal ở đây); chờ đánh giá bất đồng bộ xong.
    for (let i = 0; i < 100 && (await flag('intake_paused')) !== true; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(await flag('intake_paused'), true);
    assert.equal(alerts.length, 1);
  });

  it('chuỗi thật qua bộ quét worker: scheduledSweep kích hoạt đúng một cảnh báo', async () => {
    await reset(); await isolate();
    await seedBelowThreshold();
    await addTask('failed', 'RH_ERROR', 500); // Task thứ 20 đã kết thúc; chỉ bộ quét đánh giá
    assert.equal(await flag('intake_paused'), false);
    const prev = process.env.MOTION_PROCESS_ROLE;
    process.env.MOTION_PROCESS_ROLE = 'worker';
    try {
      await sweeper.scheduledSweep();
    } finally {
      if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prev;
    }
    assert.equal(await flag('intake_paused'), true);
    assert.equal(alerts.length, 1);
  });

  it('cửa sổ 30 phút: lỗi kết thúc 31 phút trước không được đếm', async () => {
    await reset();
    await pool.query(`UPDATE settings SET value=to_jsonb(to_char((now() - interval '2 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE key='breaker_reset_at'`);
    const old = 31 * 60_000;
    for (let i = 0; i < 6; i++) await addTask('failed', 'RH_ERROR', old + i, true);
    for (let i = 0; i < 14; i++) await addTask('succeeded', null, old + 100 + i, true);
    const s = await tasks.breakerWindowStats(30 * 60_000, await breaker.settings.getBreakerResetAt());
    assert.equal(s.eligible, 0);
    assert.equal(s.consecutiveFailures, 0);
    assert.equal(await breaker.evaluate(), false);
    assert.equal(await flag('intake_paused'), false);
    assert.equal(alerts.length, 0);
  });

  it('tạm dừng: ba route tạo Task trả 503 PAUSED; route khác vẫn chạy; GET /system/status công khai', async () => {
    await reset();
    await pool.query(`UPDATE settings SET value='true'::jsonb WHERE key='intake_paused'`);
    for (const [url, body] of [
      ['/tasks/face-swap', { sourceKey: 'x', targetKey: 'y' }],
      ['/tasks/body-retouch', {}],
      ['/tasks/motion', {}],
    ]) {
      const res = await call(user, 'POST', url, body);
      assert.equal(res.status, 503, url);
      assert.equal((await res.json()).code, 'PAUSED');
    }
    const held = await pool.query(`SELECT count(*)::int n FROM ledger_entries WHERE user_id=$1`, [user.id]);
    assert.equal(held.rows[0].n, 0);
    assert.equal((await call(user, 'GET', '/tasks')).status, 200);
    const st = await call(null, 'GET', '/system/status');
    assert.equal(st.status, 200);
    assert.deepEqual(SystemStatusResponseSchema.parse(await st.json()), { intakePaused: true });
  });

  it('resume: 401/403/200, tắt hai cờ, đặt breaker_reset_at, ghi admin_audit, không kích hoạt lại ngay', async () => {
    await reset(); await pool.query(`UPDATE settings SET value='true'::jsonb WHERE key IN ('intake_paused','rh_budget_exhausted')`);
    for (let i = 0; i < 6; i++) await addTask('failed', 'RH_ERROR');
    assert.equal((await call(null, 'POST', '/admin/ops/resume')).status, 401);
    assert.equal((await call(user, 'POST', '/admin/ops/resume')).status, 403);
    assert.equal((await call(user, 'GET', '/admin/ops/status')).status, 403);
    assert.equal((await call(null, 'GET', '/admin/ops/status')).status, 401);
    const s0 = OpsStatusResponseSchema.parse(await (await call(admin, 'GET', '/admin/ops/status')).json());
    assert.equal(s0.intakePaused, true);
    assert.equal(s0.rhBalance, null);
    await pool.query(`UPDATE tasks SET finished_at = now() - interval '1 minute' WHERE user_id=$1`, [user.id]);
    const res = await call(admin, 'POST', '/admin/ops/resume');
    assert.equal(res.status, 200);
    const body = OpsStatusResponseSchema.parse(await res.json());
    assert.equal(body.intakePaused, false);
    assert.equal(body.rhBudgetExhausted, false);
    assert.ok(await flag('breaker_reset_at'));
    assert.equal(await breaker.evaluate(), false);
    assert.equal(await flag('intake_paused'), false);
    const a = await pool.query(`SELECT * FROM admin_audit WHERE action='ops.resume' AND admin_id=$1`, [admin.id]);
    assert.equal(a.rows.length, 1);
  });

  it('route đánh dấu "tạo Task" bắt buộc có IntakeOpenGuard', () => {
    const reflector = new Reflector();
    const proto = TasksController.prototype;
    const marked = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor' && typeof proto[n] === 'function' && reflector.get(CREATES_TASK_KEY, proto[n]),
    );
    assert.deepEqual(marked.sort(), ['createBodyRetouch', 'createFaceSwap', 'createMotion']);
    for (const n of marked) {
      const guards = Reflect.getMetadata('__guards__', proto[n]) ?? [];
      assert.ok(guards.includes(IntakeOpenGuard), `${n} thiếu IntakeOpenGuard`);
    }
    // mọi handler POST của TasksController có tên bắt đầu bằng create phải được đánh dấu
    for (const n of Object.getOwnPropertyNames(proto)) {
      if (/^create(FaceSwap|BodyRetouch|Motion)/.test(n)) assert.ok(marked.includes(n), `${n} chưa đánh dấu @CreatesTask`);
    }
  });
});
