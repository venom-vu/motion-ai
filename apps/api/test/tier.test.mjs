import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PRICING_CONFIG,
  MeResponseSchema,
  PricingConfigResponseSchema,
  TierSnapshotSchema,
  WalletLedgerResponseSchema,
} from '@flowvis/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { withTaskRows } from './helpers/task-fixture.mjs';
import { ReconcileService } from '../dist/modules/ops/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const composePath = path.join(repoRoot, 'deploy', 'compose.yml');
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://motion_user:change_me_local_password@localhost:5432/flowvis?schema=public';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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
  const d = new URL(DB_URL);
  const r = new URL(REDIS_URL);
  const [pgUp, redisUp] = await Promise.all([
    checkTcpPort(d.hostname || 'localhost', Number(d.port || 5432)),
    checkTcpPort(r.hostname || 'localhost', Number(r.port || 6379)),
  ]);
  if (!pgUp || !redisUp) {
    execFileSync(
      'docker',
      ['compose', '-f', composePath, 'up', '-d', '--wait', 'postgres-16', 'redis-7'],
      { cwd: repoRoot, stdio: 'inherit' },
    );
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
  });
}

describe('Story 1.7: [BE] Tier, API ví và đối soát sổ cái', () => {
  let pool;
  let prisma;
  let app;
  let baseUrl;
  let jwt;
  const wallet = withTaskRows(new WalletService());
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  const uuid = () => crypto.randomUUID();
  const tx = (fn) => prisma.$transaction(fn);

  async function newUser() {
    const n = userIds.length;
    const user = await prisma.user.create({
      data: {
        googleId: `g-t-${runId}-${n}`,
        email: `tier-${runId}-${n}@flowvis.vn`,
        tosVersion: 'test',
      },
    });
    userIds.push(user.id);
    return user.id;
  }
  const row = (id) => prisma.user.findUnique({ where: { id } });
  const grant = (u, n) => tx((t) => wallet.grant(t, u, n));
  const topup = (u, n, pack) => tx((t) => wallet.topup(t, u, uuid(), n, pack));
  const adjust = (u, n) => tx((t) => wallet.adjust(t, u, n));
  async function proUser() {
    const u = await newUser();
    await topup(u, 5000, 'pro');
    assert.equal((await row(u)).tierPack, 'pro');
    return u;
  }
  const authHeader = (u) => ({
    Authorization: `Bearer ${jwt.sign({ sub: u, email: `tier-${runId}@flowvis.vn`, role: 'user' })}`,
  });

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  it('migration: users.tier_pack có CHECK gói hợp lệ', async () => {
    const col = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='tier_pack'`,
    );
    assert.equal(col.rows[0]?.is_nullable, 'YES');
    const chk = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype='c' AND conrelid='users'::regclass`,
    );
    assert.ok(chk.rows.some((r) => /tier_pack/.test(r.def) && /starter/.test(r.def) && /creator/.test(r.def)));
    const u = await newUser();
    await assert.rejects(pool.query(`UPDATE users SET tier_pack='gold' WHERE id=$1`, [u]));
  });

  it('FREE nạp gói -> Starter; GRANT không đổi Tier', async () => {
    const u = await newUser();
    await grant(u, 500);
    assert.equal((await row(u)).tierPack, null);
    await topup(u, 5000, 'starter');
    assert.equal((await row(u)).tierPack, 'starter');
    const snap = await tx((t) => wallet.hold(t, u, uuid(), 100));
    assert.deepEqual(snap, { tier: 'Starter', priority: 3, maxVideoSeconds: 10 });
    assert.ok(TierSnapshotSchema.safeParse(snap).success);
  });

  it('Pro nạp gói thấp hơn vẫn Pro; nạp Creator thì lên Creator', async () => {
    const u = await proUser();
    await topup(u, 5000, 'starter');
    assert.equal((await row(u)).tierPack, 'pro');
    await topup(u, 5000, 'creator');
    assert.equal((await row(u)).tierPack, 'creator');
  });

  it('rơi về FREE khi CAPTURED làm tổng < 100, nạp lại -> Starter', async () => {
    const u = await newUser();
    await topup(u, 5000, 'creator');
    // nạp 140 để dễ kiểm soát: HOLD gần hết rồi CAPTURED
    const t1 = uuid();
    await tx((t) => wallet.hold(t, u, t1, 4960));
    assert.equal((await row(u)).tierPack, 'creator', 'HOLD không tính lại');
    await tx((t) => wallet.capture(t, t1));
    const r = await row(u);
    assert.equal(r.balance + r.held, 40n);
    assert.equal(r.tierPack, null);
    await topup(u, 5000, 'starter');
    assert.equal((await row(u)).tierPack, 'starter');
    const snap = await tx((t) => wallet.hold(t, u, uuid(), 100));
    assert.equal(snap.priority, 3);
    assert.equal(snap.maxVideoSeconds, 10);
  });

  it('ngưỡng 99 / 100 qua ADJUST', async () => {
    const u = await proUser();
    await adjust(u, -4900); // 100
    assert.equal((await row(u)).tierPack, 'pro');
    await adjust(u, -1); // 99
    assert.equal((await row(u)).tierPack, null);
  });

  it('HOLD không đổi Tier: balance < 100 nhưng tổng >= 100', async () => {
    const u = await proUser();
    await tx((t) => wallet.hold(t, u, uuid(), 4950)); // balance 50, held 4950
    const r = await row(u);
    assert.equal(r.balance, 50n);
    assert.equal(r.tierPack, 'pro');
    const snap = await tx((t) => wallet.hold(t, u, uuid(), 50));
    assert.deepEqual(snap, { tier: 'Pro', priority: 2, maxVideoSeconds: 15 });
  });

  it('RELEASED không tính lại Tier', async () => {
    const u = await proUser();
    const t1 = uuid();
    await tx((t) => wallet.hold(t, u, t1, 100));
    await pool.query(`UPDATE users SET tier_pack=NULL WHERE id=$1`, [u]);
    await tx((t) => wallet.release(t, t1));
    assert.equal((await row(u)).tierPack, null);
  });

  it('ADJUST: giảm tổng < 100 -> FREE; làm balance âm bị từ chối; tx bắt buộc; amount 0', async () => {
    const u = await proUser();
    await assert.rejects(adjust(u, -5001), (e) => e.getStatus?.() === 402);
    await assert.rejects(adjust(u, 0));
    await assert.rejects(wallet.adjust(undefined, u, 1));
    await adjust(u, -4950);
    assert.equal((await row(u)).tierPack, null);
    await adjust(u, 10);
    const r = await row(u);
    assert.equal(r.balance, 60n);
    const sum = await pool.query(`SELECT SUM(amount)::text AS s FROM ledger_entries WHERE user_id=$1`, [u]);
    assert.equal(sum.rows[0].s, '60');
  });

  it('GET /config/pricing khớp DEFAULT_PRICING_CONFIG và parse được', async () => {
    const res = await fetch(`${baseUrl}/config/pricing`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, DEFAULT_PRICING_CONFIG);
    assert.ok(PricingConfigResponseSchema.safeParse(body).success);
  });

  it('GET /me trả dữ liệu thật và parse được', async () => {
    const u = await proUser();
    await tx((t) => wallet.hold(t, u, uuid(), 100));
    const res = await fetch(`${baseUrl}/me`, { headers: authHeader(u) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(MeResponseSchema.safeParse(body).success);
    assert.equal(body.tier, 'Pro');
    assert.equal(body.balance, 4900);
    assert.equal(body.held, 100);
  });

  it('GET /me ném lỗi khi balance vượt MAX_SAFE_INTEGER', async () => {
    const u = await newUser();
    await pool.query(`UPDATE users SET balance=9007199254740993 WHERE id=$1`, [u]);
    const res = await fetch(`${baseUrl}/me`, { headers: authHeader(u) });
    assert.equal(res.status, 500);
  });

  it('GET /wallet/ledger phân trang, không lẫn user khác, lỗi tham số -> 400', async () => {
    const a = await newUser();
    const b = await newUser();
    for (let i = 0; i < 5; i += 1) {
      await grant(a, 10 + i);
      await sleep(5);
    }
    await grant(b, 999);
    const seen = [];
    let cursor = null;
    let pages = 0;
    for (;;) {
      const qs = new URLSearchParams({ pageSize: '2' });
      if (cursor) qs.set('cursor', cursor);
      const res = await fetch(`${baseUrl}/wallet/ledger?${qs}`, { headers: authHeader(a) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(WalletLedgerResponseSchema.safeParse(body).success);
      pages += 1;
      seen.push(...body.items);
      if (!body.hasMore) break;
      cursor = body.nextCursor;
    }
    assert.equal(pages, 3);
    assert.equal(seen.length, 5);
    assert.ok(seen.every((e) => e.userId === a && e.labelVi === 'Tặng'));
    assert.equal(new Set(seen.map((e) => e.id)).size, 5);
    assert.deepEqual(seen.map((e) => e.amount), [14, 13, 12, 11, 10], 'mới nhất trước, không trùng/thiếu giữa các trang');
    for (const q of ['pageSize=0', 'pageSize=101', 'pageSize=abc', 'cursor=!!!', `cursor=${Buffer.from('x|y').toString('base64url')}`]) {
      const res = await fetch(`${baseUrl}/wallet/ledger?${q}`, { headers: authHeader(a) });
      assert.equal(res.status, 400, q);
    }
    const unauth = await fetch(`${baseUrl}/wallet/ledger`);
    assert.equal(unauth.status, 401);
  });

  it('GET /wallet/ledger ánh xạ đúng type/labelVi/pack/taskId/topupId và nextCursor', async () => {
    const u = await newUser();
    const topupId = uuid();
    const taskId = uuid();
    await tx((t) => wallet.topup(t, u, topupId, 5000, 'pro'));
    await sleep(5);
    await tx((t) => wallet.hold(t, u, taskId, 100));
    await sleep(5);
    await tx((t) => wallet.capture(t, taskId));
    await sleep(5);
    await adjust(u, -10);
    const res = await fetch(`${baseUrl}/wallet/ledger?pageSize=2`, { headers: authHeader(u) });
    assert.equal(res.status, 200);
    const page1 = await res.json();
    assert.ok(WalletLedgerResponseSchema.safeParse(page1).success);
    assert.deepEqual(page1.items.map((e) => e.type), ['ADJUST', 'CAPTURED']);
    assert.equal(page1.hasMore, true);
    assert.equal(typeof page1.nextCursor, 'string');
    const [last] = Buffer.from(page1.nextCursor, 'base64url').toString().split('|');
    assert.equal(last, new Date(page1.items[1].createdAt).toISOString(), 'nextCursor mã hóa hàng cuối của trang');
    const res2 = await fetch(`${baseUrl}/wallet/ledger?pageSize=10&cursor=${page1.nextCursor}`, { headers: authHeader(u) });
    const page2 = await res2.json();
    assert.deepEqual(page2.items.map((e) => e.type), ['HOLD', 'TOPUP']);
    assert.equal(page2.hasMore, false);
    const all = [...page1.items, ...page2.items];
    const by = Object.fromEntries(all.map((e) => [e.type, e]));
    assert.equal(by.ADJUST.amount, -10);
    assert.equal(by.CAPTURED.amount, 0);
    assert.equal(by.CAPTURED.taskId, taskId);
    assert.equal(by.HOLD.amount, -100);
    assert.equal(by.HOLD.taskId, taskId);
    assert.equal(by.TOPUP.amount, 5000);
    assert.equal(by.TOPUP.pack, 'pro');
    assert.equal(by.TOPUP.topupId, topupId);
    assert.equal(by.TOPUP.taskId, null);
    assert.equal(by.ADJUST.pack, null);
    for (const e of all) assert.ok(typeof e.labelVi === 'string' && e.labelVi.length > 0, e.type);
    assert.equal(new Set(all.map((e) => e.labelVi)).size, 4, 'mỗi type một nhãn riêng');
  });

  describe('đối soát sổ cái', () => {
    function makeReconcile() {
      const events = [];
      const svc = new ReconcileService(prisma, { notify: async (e) => void events.push(e) });
      return { svc, events };
    }
    const mine = (events, u) => events.filter((e) => e.data?.userId === u);

    it('khớp: không notify cho user nhất quán', async () => {
      const u = await proUser();
      await tx((t) => wallet.hold(t, u, uuid(), 100));
      const { svc, events } = makeReconcile();
      const mm = await svc.reconcile();
      assert.equal(mm.filter((m) => m.userId === u).length, 0);
      assert.equal(mine(events, u).length, 0);
    });

    it('lệch: notify đúng một lần cho user đó', async () => {
      const u = await proUser();
      await pool.query(`UPDATE users SET balance = balance + 7 WHERE id=$1`, [u]);
      try {
        const { svc, events } = makeReconcile();
        await svc.reconcile();
        assert.equal(mine(events, u).length, 1);
        assert.equal(mine(events, u)[0].severity, 'error');
      } finally {
        await pool.query(`UPDATE users SET balance = balance - 7 WHERE id=$1`, [u]);
      }
    });

    it('khớp: HOLD đã CAPTURED không bị tính là held đang mở', async () => {
      const u = await proUser();
      const task = uuid();
      await tx((t) => wallet.hold(t, u, task, 100));
      await tx((t) => wallet.capture(t, task));
      const { svc, events } = makeReconcile();
      const mm = await svc.reconcile();
      assert.equal(mm.filter((m) => m.userId === u).length, 0);
      assert.equal(mine(events, u).length, 0);
    });

    it('lệch held: chỉ sai held vẫn bị phát hiện với expectedHeld đúng', async () => {
      const u = await proUser();
      await tx((t) => wallet.hold(t, u, uuid(), 100));
      await pool.query(`UPDATE users SET held = held + 3 WHERE id=$1`, [u]);
      try {
        const { svc, events } = makeReconcile();
        const mm = await svc.reconcile();
        const found = mm.find((m) => m.userId === u);
        assert.ok(found, 'phải phát hiện lệch held');
        assert.equal(found.expectedHeld, '100');
        assert.equal(found.held, '103');
        assert.equal(mine(events, u).length, 1);
      } finally {
        await pool.query(`UPDATE users SET held = held - 3 WHERE id=$1`, [u]);
      }
    });

    it('job lỗi: ghi nhận và gọi notify RECONCILE_FAILED, không ném ra ngoài', async () => {
      const { svc, events } = makeReconcile();
      svc.reconcile = async () => {
        throw new Error('db down');
      };
      const prev = process.env.MOTION_PROCESS_ROLE;
      process.env.MOTION_PROCESS_ROLE = 'worker';
      try {
        await svc.scheduledReconcile();
      } finally {
        if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
        else process.env.MOTION_PROCESS_ROLE = prev;
      }
      assert.ok(events.some((e) => e.kind === 'RECONCILE_FAILED'));
    });

    it('job theo lịch chỉ chạy ở tiến trình worker', async () => {
      const { svc } = makeReconcile();
      let calls = 0;
      svc.reconcile = async () => void (calls += 1);
      const prev = process.env.MOTION_PROCESS_ROLE;
      try {
        delete process.env.MOTION_PROCESS_ROLE;
        await svc.scheduledReconcile();
        assert.equal(calls, 0);
        process.env.MOTION_PROCESS_ROLE = 'worker';
        await svc.scheduledReconcile();
        assert.equal(calls, 1);
      } finally {
        if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
        else process.env.MOTION_PROCESS_ROLE = prev;
      }
    });
  });
});
