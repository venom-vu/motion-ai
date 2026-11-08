import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiErrorCode } from '@flowvis/contracts';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { insertTaskRow, withTaskRows } from './helpers/task-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';

function checkTcpPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function ensureInfra() {
  const u = new URL(DB_URL);
  if (!(await checkTcpPort(u.hostname || 'localhost', Number(u.port || 5432)))) {
    execFileSync(
      'docker',
      ['compose', '-f', composePath, 'up', '-d', '--wait', 'postgres-16'],
      { cwd: repoRoot, stdio: 'inherit' },
    );
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
  });
}

describe('Story 1.6: [BE] Sổ cái credit bất biến', () => {
  let pool;
  let prisma;
  const wallet = withTaskRows(new WalletService());
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];

  const uuid = () => crypto.randomUUID();
  const tx = (fn) => prisma.$transaction(fn);

  async function newUser(balance = 0) {
    const n = userIds.length;
    const user = await prisma.user.create({
      data: {
        googleId: `g-${runId}-${n}`,
        email: `wallet-${runId}-${n}@flowvis.vn`,
        tosVersion: 'test',
      },
    });
    userIds.push(user.id);
    if (balance > 0) await tx((t) => wallet.grant(t, user.id, balance));
    return user.id;
  }

  async function state(userId) {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    const entries = await prisma.ledgerEntry.findMany({ where: { userId } });
    return { balance: u.balance, held: u.held, entries };
  }

  async function assertInvariants(userId) {
    const { balance, held, entries } = await state(userId);
    const sum = entries.reduce((a, e) => a + e.amount, 0n);
    assert.equal(balance, sum, 'balance = SUM(amount)');
    const settled = new Set(
      entries
        .filter((e) => e.type === 'CAPTURED' || e.type === 'RELEASED')
        .map((e) => e.taskId),
    );
    const open = entries
      .filter((e) => e.type === 'HOLD' && !settled.has(e.taskId))
      .reduce((a, e) => a - e.amount, 0n);
    assert.equal(held, open, 'held = HOLD chưa chốt');
    assert.ok(balance >= 0n && held >= 0n);
  }

  before(async () => {
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  after(async () => {
    if (prisma) {
      // Dọn dẹp bằng SQL thô (test-only); sổ cái là append-only trong mã ứng dụng.
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });

  it('migration có đủ CHECK và chỉ mục một phần', async () => {
    const checks = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='c' AND conrelid='users'::regclass`,
    );
    const defs = checks.rows.map((r) => r.def.replace(/[()\s]/g, ''));
    assert.ok(defs.includes('CHECKbalance>=0'.replace(/[()\s]/g, '')));
    assert.ok(defs.includes('CHECKheld>=0'));
    const idx = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename='ledger_entries'`,
    );
    const defsIdx = idx.rows.map((r) => r.indexdef);
    assert.ok(
      defsIdx.some((d) => /UNIQUE/.test(d) && /task_id/.test(d) && /WHERE/.test(d) && /'HOLD'/.test(d) && !/CAPTURED/.test(d)),
      'thiếu chỉ mục HOLD',
    );
    assert.ok(
      defsIdx.some((d) => /UNIQUE/.test(d) && /CAPTURED/.test(d) && /RELEASED/.test(d)),
      'thiếu chỉ mục CAPTURED/RELEASED',
    );
  });

  it('HOLD đủ số dư', async () => {
    const u = await newUser(500);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    const s = await state(u);
    assert.equal(s.balance, 400n);
    assert.equal(s.held, 100n);
    const holds = s.entries.filter((e) => e.type === 'HOLD');
    assert.equal(holds.length, 1);
    assert.equal(holds[0].amount, -100n);
    await assertInvariants(u);
  });

  it('HOLD thiếu số dư: INSUFFICIENT_CREDIT, không ghi gì', async () => {
    const u = await newUser(50);
    await assert.rejects(
      tx((t) => wallet.hold(t, u, uuid(), 100)),
      (e) => e.getStatus() === 402 && e.getResponse().code === ApiErrorCode.INSUFFICIENT_CREDIT,
    );
    const s = await state(u);
    assert.equal(s.balance, 50n);
    assert.equal(s.held, 0n);
    assert.equal(s.entries.filter((e) => e.type === 'HOLD').length, 0);
  });

  it('HOLD trùng task bị từ chối và rollback', async () => {
    const u = await newUser(500);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    await assert.rejects(tx((t) => wallet.hold(t, u, task, 100)));
    const s = await state(u);
    assert.equal(s.balance, 400n);
    assert.equal(s.held, 100n);
    await assertInvariants(u);
  });

  it('chỉ mục duy nhất từ chối HOLD kép ở mức DB (P2002)', async () => {
    const u = await newUser(0);
    const task = uuid();
    await insertTaskRow(prisma, u, task);
    await prisma.ledgerEntry.create({ data: { userId: u, type: 'HOLD', amount: -1n, taskId: task } });
    await assert.rejects(
      prisma.ledgerEntry.create({ data: { userId: u, type: 'HOLD', amount: -1n, taskId: task } }),
      (e) => e.code === 'P2002',
    );
    await pool.query('DELETE FROM ledger_entries WHERE user_id=$1', [u]);
  });

  it('hai HOLD song song: đúng một thành công', async () => {
    const u = await newUser(100);
    const results = await Promise.allSettled([
      tx((t) => wallet.hold(t, u, uuid(), 100)),
      tx((t) => wallet.hold(t, u, uuid(), 100)),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const failed = results.find((r) => r.status === 'rejected');
    assert.equal(failed.reason.getResponse().code, ApiErrorCode.INSUFFICIENT_CREDIT);
    const s = await state(u);
    assert.equal(s.balance, 0n);
    assert.equal(s.held, 100n);
    await assertInvariants(u);
  });

  it('CAPTURED sau HOLD', async () => {
    const u = await newUser(500);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    await tx((t) => wallet.capture(t, task));
    const s = await state(u);
    assert.equal(s.balance, 400n);
    assert.equal(s.held, 0n);
    const cap = s.entries.find((e) => e.type === 'CAPTURED');
    assert.equal(cap.amount, 0n);
    await assertInvariants(u);
  });

  it('RELEASED sau HOLD', async () => {
    const u = await newUser(500);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    await tx((t) => wallet.release(t, task));
    const s = await state(u);
    assert.equal(s.balance, 500n);
    assert.equal(s.held, 0n);
    assert.equal(s.entries.find((e) => e.type === 'RELEASED').amount, 100n);
    await assertInvariants(u);
  });

  it('CAPTURED rồi RELEASED (và ngược lại, và kép) bị từ chối', async () => {
    const u = await newUser(500);
    const t1 = uuid();
    await tx((t) => wallet.hold(t, u, t1, 100));
    await tx((t) => wallet.capture(t, t1));
    await assert.rejects(tx((t) => wallet.release(t, t1)));
    await assert.rejects(tx((t) => wallet.capture(t, t1)));
    const t2 = uuid();
    await tx((t) => wallet.hold(t, u, t2, 100));
    await tx((t) => wallet.release(t, t2));
    await assert.rejects(tx((t) => wallet.capture(t, t2)));
    await assert.rejects(tx((t) => wallet.release(t, t2)));
    await assertInvariants(u);
  });

  it('chỉ mục DB từ chối CAPTURED + RELEASED cùng task', async () => {
    const u = await newUser(0);
    const task = uuid();
    await insertTaskRow(prisma, u, task);
    await prisma.ledgerEntry.create({ data: { userId: u, type: 'CAPTURED', amount: 0n, taskId: task } });
    await assert.rejects(
      prisma.ledgerEntry.create({ data: { userId: u, type: 'RELEASED', amount: 1n, taskId: task } }),
      (e) => e.code === 'P2002',
    );
    await pool.query('DELETE FROM ledger_entries WHERE user_id=$1', [u]);
  });

  it('capture/release không có HOLD bị từ chối', async () => {
    const u = await newUser(100);
    await assert.rejects(tx((t) => wallet.capture(t, uuid())));
    await assert.rejects(tx((t) => wallet.release(t, uuid())));
    await assertInvariants(u);
  });

  it('grant/topup cộng balance và lưu pack', async () => {
    const u = await newUser(0);
    await tx((t) => wallet.grant(t, u, 500));
    await tx((t) => wallet.topup(t, u, crypto.randomUUID(), 12000, 'pro'));
    const s = await state(u);
    assert.equal(s.balance, 12500n);
    assert.equal(s.entries.find((e) => e.type === 'TOPUP').pack, 'pro');
    assert.equal(s.entries.find((e) => e.type === 'GRANT').pack, null);
    await assertInvariants(u);
  });

  it('thiếu tx thì ném lỗi và không ghi', async () => {
    const u = await newUser(100);
    await assert.rejects(wallet.hold(undefined, u, uuid(), 10));
    await assert.rejects(wallet.capture(undefined, uuid()));
    await assert.rejects(wallet.release(undefined, uuid()));
    await assert.rejects(wallet.grant(undefined, u, 10));
    await assert.rejects(wallet.topup(undefined, u, crypto.randomUUID(), 10, 'pro'));
    const s = await state(u);
    assert.equal(s.balance, 100n);
    assert.equal(s.entries.length, 1);
  });

  it('CHECK DB từ chối balance/held âm và pack sai', async () => {
    const u = await newUser(0);
    await assert.rejects(pool.query('UPDATE users SET balance=-1 WHERE id=$1', [u]));
    await assert.rejects(pool.query('UPDATE users SET held=-1 WHERE id=$1', [u]));
    await assert.rejects(
      pool.query(`INSERT INTO ledger_entries(user_id,type,amount,pack) VALUES($1,'GRANT',5,'pro')`, [u]),
    );
    await assert.rejects(
      pool.query(`INSERT INTO ledger_entries(user_id,type,amount) VALUES($1,'HOLD',5)`, [u]),
    );
  });

  it('CHECK DB từ chối mọi bút toán sai dấu, sai loại, thiếu khóa', async () => {
    const u = await newUser(0);
    const bad = [
      ["'RELEASED',-5", uuid()],
      ["'RELEASED',0", uuid()],
      ["'CAPTURED',3", uuid()],
      ["'GRANT',-5", null],
      ["'TOPUP',0", null],
      ["'ADJUST',0", null],
      ["'UNKNOWN',5", null],
      ["'HOLD',-5", null],
      ["'HOLD',-5", null],
    ];
    for (const [vals, taskId] of bad) {
      await assert.rejects(
        pool.query(
          `INSERT INTO ledger_entries(user_id,type,amount,task_id) VALUES($1,${vals},$2)`,
          [u, taskId],
        ),
        vals,
      );
    }
    await assert.rejects(
      pool.query(
        `INSERT INTO ledger_entries(user_id,type,amount,topup_id,pack) VALUES($1,'TOPUP',5,$2,'gold')`,
        [u, uuid()],
      ),
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO ledger_entries(user_id,type,amount,pack) VALUES($1,'TOPUP',5,'pro')`,
        [u],
      ),
    );
  });

  it('lỗi nghiệp vụ trả 409, thiếu tiền trả 402', async () => {
    const u = await newUser(200);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    const is409 = (e) => e.getStatus?.() === 409;
    await assert.rejects(tx((t) => wallet.hold(t, u, task, 10)), is409);
    await assert.rejects(tx((t) => wallet.capture(t, uuid())), is409);
    await tx((t) => wallet.capture(t, task));
    await assert.rejects(tx((t) => wallet.release(t, task)), is409);
    await assert.rejects(tx((t) => wallet.hold(t, u, 'not-a-uuid', 10)), is409);
    await assert.rejects(tx((t) => wallet.hold(t, u, uuid(), 0)), is409);
    await assert.rejects(tx((t) => wallet.hold(t, u, uuid(), -5)), is409);
    await assert.rejects(tx((t) => wallet.hold(t, u, uuid(), 1.5)), is409);
    await assert.rejects(tx((t) => wallet.grant(t, uuid(), 10)), is409);
    await assert.rejects(tx((t) => wallet.grant(t, 'not-a-uuid', 10)), is409);
    await assert.rejects(tx((t) => wallet.hold(t, 'not-a-uuid', uuid(), 10)), is409);
    await assert.rejects(tx((t) => wallet.topup(t, 'not-a-uuid', uuid(), 10, 'pro')), is409);
    await assert.rejects(
      tx((t) => wallet.hold(t, u, uuid(), 9999)),
      (e) => e.getStatus?.() === 402,
    );
    await assertInvariants(u);
  });

  it('topup trùng topupId bị từ chối; client không phải tx bị từ chối', async () => {
    const u = await newUser(0);
    const topupId = uuid();
    await tx((t) => wallet.topup(t, u, topupId, 5000, 'starter'));
    await assert.rejects(
      tx((t) => wallet.topup(t, u, topupId, 5000, 'starter')),
      (e) => e.getStatus?.() === 409,
    );
    await assert.rejects(wallet.hold(prisma, u, uuid(), 10));
    const s = await state(u);
    assert.equal(s.balance, 5000n);
    await assertInvariants(u);
  });

  it('capture và release song song cùng task: đúng một thành công', async () => {
    const u = await newUser(300);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    const r = await Promise.allSettled([
      tx((t) => wallet.capture(t, task)),
      tx((t) => wallet.release(t, task)),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    await assertInvariants(u);
  });

  it('hai HOLD cùng task song song: đúng một thành công', async () => {
    const u = await newUser(300);
    const task = uuid();
    const r = await Promise.allSettled([
      tx((t) => wallet.hold(t, u, task, 100)),
      tx((t) => wallet.hold(t, u, task, 100)),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    await assertInvariants(u);
  });

  it('sau P2002 pool vẫn dùng lại được', async () => {
    const u = await newUser(500);
    const task = uuid();
    await tx((t) => wallet.hold(t, u, task, 100));
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(tx((t) => wallet.hold(t, u, task, 100)));
    }
    assert.equal((await prisma.$queryRaw`SELECT 1 AS ok`)[0].ok, 1);
    await tx((t) => wallet.hold(t, u, uuid(), 50));
    const s = await state(u);
    assert.equal(s.balance, 350n);
    assert.equal(s.held, 150n);
    await assertInvariants(u);
  });
});
