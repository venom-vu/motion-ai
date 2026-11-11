import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Queue } from 'bullmq';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TaskSweeperService } from '../dist/modules/tasks/task-sweeper.service.js';
import { TaskWorkerService } from '../dist/modules/tasks/index.js';
import { RhBalanceService } from '../dist/modules/tasks/rh-balance.service.js';
import { AlertService } from '../dist/modules/ops/alert.service.js';
import { SettingsService } from '../dist/modules/ops/settings.service.js';
import { RunningHubError } from '../dist/ports/index.js';
import { UnconfiguredRunningHubAdapter } from '../dist/modules/tasks/runninghub-unconfigured.adapter.js';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

Queue.prototype.add = async function (name, data, opts) { return { id: opts?.jobId }; };
Queue.prototype.getJob = async function () { return null; };

describe('Story 6.3: [BE] Hết ngân sách RunningHub và cảnh báo số dư', () => {
  let app, pool, prisma, worker, alertSvc, balance, settings, calls, sent, outputsImpl, uploadImpl, balanceImpl;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const SNAP = JSON.stringify({ tier: 'PRO', priority: 1 });

  const flag = async (k) => (await pool.query('SELECT value FROM settings WHERE key=$1', [k])).rows[0]?.value;
  async function reset() {
    await pool.query(`UPDATE settings SET value='false'::jsonb WHERE key IN ('intake_paused','rh_budget_exhausted')`);
    await pool.query(`DELETE FROM settings WHERE key LIKE 'alert:%' OR key IN ('rh_balance','rh_balance_state')`);
    calls = { upload: 0, submit: 0, outputs: 0 };
    sent = [];
    alertSvc.notifier = { notify: async (e) => { sent.push(e); } };
    outputsImpl = async () => ({ status: 'RUNNING' });
    uploadImpl = async () => 'f1';
    balanceImpl = async () => 50000;
  }
  async function mkTask(status = 'queued', extra = '') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,queued_at,updated_at ${extra ? ',' + extra.split('=')[0] : ''})
       VALUES ($1,$2,'face_swap',$3,$4::jsonb,true,'t','{"sourceKey":"in/a","targetKey":"in/b"}'::jsonb,'{}'::jsonb,100,now(),now() ${extra ? ',' + extra.split('=')[1] : ''})`,
      [id, users[0], status, SNAP],
    );
    await prisma.$transaction(async (tx) => {
      const w = new WalletService();
      await w.grant(tx, users[0], 100);
      await w.hold(tx, users[0], id, 100);
    });
    return id;
  }
  const status = (id) => pool.query('SELECT status, reason_code FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const released = (id) => prisma.ledgerEntry.findMany({ where: { taskId: id, type: 'RELEASED' } });

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    process.env.RH_POLL_INTERVAL_MS = '20';
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    worker = app.get(TaskWorkerService);
    alertSvc = app.get(AlertService);
    balance = app.get(RhBalanceService);
    settings = app.get(SettingsService);
    worker.rh = {
      uploadFile: async (...a) => { calls.upload++; return uploadImpl(...a); },
      submit: async () => { calls.submit++; return 'rh-1'; },
      outputs: async (...a) => { calls.outputs++; return outputsImpl(...a); },
    };
    worker.storage = { getObject: async () => Buffer.from('img') };
    balance.rh = { getBalance: async () => balanceImpl() };
    const u = await prisma.user.create({ data: { googleId: `b-${runId}`, email: `b-${runId}@flowvis.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    await reset();
  });

  after(async () => {
    if (pool) {
      await reset();
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('hết tiền ở upload: failed RH_BUDGET, RELEASED, hai cờ, một cảnh báo', async () => {
    await reset();
    uploadImpl = async () => { throw new RunningHubError('Insufficient balance'); };
    const id = await mkTask();
    await worker.processTask(id);
    assert.deepEqual(await status(id), { status: 'failed', reason_code: 'RH_BUDGET' });
    assert.equal((await released(id)).length, 1);
    assert.equal(await flag('rh_budget_exhausted'), true);
    assert.equal(await flag('intake_paused'), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'ops.rh_budget_exhausted');
  });

  it('hết tiền ở submit', async () => {
    await reset();
    worker.rh.submit = async () => { calls.submit++; throw new RunningHubError('not enough coins'); };
    try {
      const id = await mkTask();
      await worker.processTask(id);
      assert.equal((await status(id)).reason_code, 'RH_BUDGET');
      assert.equal(sent.length, 1);
    } finally {
      worker.rh.submit = async () => { calls.submit++; return 'rh-1'; };
    }
  });

  it('hết tiền ở poll; lỗi khác thì không đặt cờ', async () => {
    await reset();
    outputsImpl = async () => ({ status: 'FAILED', errorMessage: 'Insufficient balance' });
    const id = await mkTask();
    await worker.processTask(id);
    assert.equal((await status(id)).reason_code, 'RH_BUDGET');
    assert.equal(await flag('rh_budget_exhausted'), true);
    assert.equal(sent.length, 1);
    await reset();
    outputsImpl = async () => ({ status: 'FAILED', errorMessage: 'boom' });
    const id2 = await mkTask();
    await worker.processTask(id2);
    assert.equal((await status(id2)).reason_code, 'RH_ERROR');
    assert.equal(await flag('rh_budget_exhausted'), false);
    assert.equal(sent.length, 0);
  });

  it('cờ bật: Task mới bị từ chối trước prepare/upload; Task đã có runninghubTaskId vẫn poll', async () => {
    await reset();
    await pool.query(`UPDATE settings SET value='true'::jsonb WHERE key='rh_budget_exhausted'`);
    const { videoTrim } = await import('../dist/modules/tasks/video-trim.service.js');
    const { PIPELINE_CONFIGS } = await import('../dist/modules/pipelines/pipeline-config.js');
    let prepared = 0;
    Object.defineProperty(PIPELINE_CONFIGS.face_swap, 'prepare', { configurable: true, value: async () => { prepared++; return {}; } });
    try {
      const id = await mkTask();
      await worker.processTask(id);
      assert.deepEqual(await status(id), { status: 'failed', reason_code: 'RH_BUDGET' });
      assert.equal(prepared, 0);
      assert.equal(calls.upload + calls.submit + calls.outputs, 0);
      assert.equal((await released(id)).length, 1);
      assert.equal(sent.length, 0, 'cờ đã bật nên không cảnh báo thêm');

      outputsImpl = async () => ({ status: 'FAILED', errorMessage: 'x' });
      const live = await mkTask('running', "runninghub_task_id='rh-9'");
      await worker.processTask(live);
      assert.ok(calls.outputs >= 1);
      assert.equal((await status(live)).reason_code, 'RH_ERROR');
    } finally {
      delete PIPELINE_CONFIGS.face_swap.prepare;
      void videoTrim;
    }
  });

  it('resume rồi hết tiền lần nữa: cảnh báo mới', async () => {
    await reset();
    uploadImpl = async () => { throw new RunningHubError('Insufficient balance'); };
    await worker.processTask(await mkTask());
    assert.equal(sent.length, 1);
    await pool.query(`UPDATE settings SET value='false'::jsonb WHERE key IN ('intake_paused','rh_budget_exhausted')`);
    await new Promise((r) => setTimeout(r, 5));
    await worker.processTask(await mkTask());
    assert.equal(sent.length, 2);
  });

  it('AlertService: thử lại tối đa 5 lần, cách >= 60 giây, dừng khi đã gửi', async () => {
    await reset();
    let n = 0;
    alertSvc.notifier = { notify: async () => { n++; if (n < 4) throw new Error('down'); } };
    await alertSvc.raise('t1', { kind: 'k', message: 'm' });
    assert.equal(n, 1);
    await alertSvc.retryPending(Date.now() + 1000);
    assert.equal(n, 1, 'chưa đủ 60 giây');
    let t = Date.now();
    for (let i = 0; i < 6; i++) { t += 61_000; await alertSvc.retryPending(t); }
    assert.equal(n, 4, 'gửi thành công ở lần 4 rồi dừng');
    const st = await settings.getAlertState('t1');
    assert.equal(st.pending, false);
    assert.ok(st.sentAt);
    await alertSvc.raise('t1', { kind: 'k', message: 'm' });
    assert.equal(n, 4, 'không gửi lặp');

    n = -1000;
    alertSvc.notifier = { notify: async () => { n++; throw new Error('down'); } };
    await alertSvc.raise('t2', { kind: 'k', message: 'm' });
    for (let i = 0; i < 10; i++) { t += 61_000; await alertSvc.retryPending(t); }
    assert.equal(n, -1000 + 5);
    assert.equal((await settings.getAlertState('t2')).pending, false);
  });

  it('số dư: lưu rh_balance; dưới ngưỡng gửi một lần, lên trên rồi xuống thì gửi lại', async () => {
    await reset();
    process.env.RH_BALANCE_ALERT_COINS = '27000';
    balanceImpl = async () => 20000;
    await balance.check();
    await balance.check();
    assert.equal(sent.filter((e) => e.kind === 'ops.rh_balance_low').length, 1);
    const b = await settings.getRhBalance();
    assert.equal(b.coins, 20000);
    assert.ok(b.readAt);
    balanceImpl = async () => 30000;
    await balance.check();
    balanceImpl = async () => 100;
    await balance.check();
    assert.equal(sent.filter((e) => e.kind === 'ops.rh_balance_low').length, 2);
    assert.equal(await flag('intake_paused'), false);
  });

  it('không đọc được 3 lần liên tiếp: một cảnh báo; đọc lại được thì cho phép gửi lại; adapter chưa cấu hình tính là lỗi', async () => {
    await reset();
    balance.rh = new UnconfiguredRunningHubAdapter();
    for (let i = 0; i < 5; i++) await balance.check();
    assert.equal(sent.filter((e) => e.kind === 'ops.rh_balance_unreadable').length, 1);
    assert.equal(await flag('intake_paused'), false);
    balance.rh = { getBalance: async () => 50000 };
    await balance.check();
    assert.equal((await settings.getRhBalanceState()).failStreak, 0);
    balance.rh = { getBalance: async () => { throw new Error('x'); } };
    for (let i = 0; i < 3; i++) await balance.check();
    assert.equal(sent.filter((e) => e.kind === 'ops.rh_balance_unreadable').length, 2);
    balance.rh = { getBalance: async () => balanceImpl() };
  });

  it('Task giao lại có submit_started_at, chưa có runninghub_task_id: không bị cổng cờ từ chối', async () => {
    await reset();
    await pool.query(`UPDATE settings SET value='true'::jsonb WHERE key='rh_budget_exhausted'`);
    const id = await mkTask('running', 'submit_started_at=now()');
    await worker.processTask(id);
    assert.deepEqual(await status(id), { status: 'failed', reason_code: 'RH_SUBMIT_UNKNOWN' });
    assert.equal(sent.length, 0);
  });

  it('CAS thua: RH_BUDGET không đặt cờ và không cảnh báo', async () => {
    await reset();
    const id = await mkTask('running');
    await pool.query(`UPDATE tasks SET status='timed_out', reason_code='RH_TIMEOUT', finished_at=now() WHERE id=$1`, [id]);
    const res = await worker.finish(id, 'failed', 'RH_BUDGET');
    assert.equal(res.applied, false);
    assert.equal(await flag('rh_budget_exhausted'), false);
    assert.equal(await flag('intake_paused'), false);
    assert.equal(sent.length, 0);
  });

  it('bộ quét: cảnh báo gửi lỗi được thử lại sau 60 giây và gửi thành công; raise trả boolean', async () => {
    await reset();
    const sweeper = app.get(TaskSweeperService);
    let n = 0;
    alertSvc.notifier = { notify: async (e) => { n++; if (n === 1) throw new Error('down'); sent.push(e); } };
    assert.equal(await alertSvc.raise('sw1', { kind: 'k', message: 'm' }), true);
    assert.equal(await alertSvc.raise('sw1', { kind: 'k', message: 'm' }), false);
    assert.equal(n, 1);
    await sweeper.sweep();
    assert.equal(n, 1, 'chưa đủ 60 giây');
    await pool.query(
      `UPDATE settings SET value = jsonb_set(value, '{lastAttemptAt}', to_jsonb(to_char((now() - interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHERE key='alert:sw1'`,
    );
    await sweeper.sweep();
    assert.equal(n, 2);
    assert.equal(sent.length, 1);
    assert.equal((await settings.getAlertState('sw1')).pending, false);
  });
});
