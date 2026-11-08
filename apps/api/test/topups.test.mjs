import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ApiErrorCode, TopupListResponseSchema, TopupSchema } from '@motion-ai/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { NOTIFIER_PORT } from '../dist/ports/index.js';
import { DiscordNotifierAdapter, createNotifierPort } from '../dist/modules/ops/discord-notifier.adapter.js';
import { PrismaService } from '../dist/infra/prisma.service.js';
import { TopupNotifierService, TopupSweeperService, buildVietQrPayload, computeApproveBy, crc16, generateTopupCode } from '../dist/modules/topups/index.js';

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

/** Giải mã TLV EMVCo thành map tag -> value. */
function parseTlv(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('vietqr thuần', () => {
  it('CRC16/CCITT-FALSE khớp vector chuẩn', () => {
    assert.equal(crc16('123456789'), '29B1');
  });
  it('payload giải mã đúng từng tag và CRC khớp', () => {
    const p = buildVietQrPayload({ bin: '970422', accountNo: '0123456789', amountVnd: 99000, content: 'NAP ABCD2345' });
    assert.equal(crc16(p.slice(0, -4)), p.slice(-4));
    const t = parseTlv(p);
    assert.equal(t['00'], '01');
    assert.equal(t['01'], '12');
    assert.equal(t['53'], '704');
    assert.equal(t['54'], '99000');
    assert.equal(t['58'], 'VN');
    assert.equal(parseTlv(t['62'])['08'], 'NAP ABCD2345');
    const m = parseTlv(t['38']);
    assert.equal(m['00'], 'A000000727');
    assert.equal(m['02'], 'QRIBFTTA');
    const acct = parseTlv(m['01']);
    assert.equal(acct['00'], '970422');
    assert.equal(acct['01'], '0123456789');
  });
  it('mã đơn 8 ký tự, bảng chữ không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 200; i++) assert.match(generateTopupCode(), /^[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe('Story 3.2: [BE] Tạo đơn nạp và mã VietQR', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];

  async function newUser({ locked = false } = {}) {
    const n = users.length;
    const u = await prisma.user.create({
      data: {
        googleId: `tp-${runId}-${n}`, email: `tp-${runId}-${n}@motionai.vn`,
        tosVersion: 'tos-v7', lockedAt: locked ? new Date() : null,
      },
    });
    users.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  const call = (user, method, url, body) =>
    fetch(`${baseUrl}${url}`, {
      method,
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const post = (user, body) => call(user, 'POST', '/topups', body);

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'CONG TY MOTION AI';
    process.env.TOPUP_THROTTLE_LIMIT = '1000';
    await ensureInfra();
    // Khối rate-limit của lần chạy trước có thể còn khóa (cùng IP, TTL 60s).
    const rd0 = new Redis(REDIS_URL);
    const stale = await rd0.keys('throttle:*');
    if (stale.length) await rd0.del(...stale);
    rd0.disconnect();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('migration: UNIQUE code/bank_ref (nhiều NULL), CHECK, FK ledger', async () => {
    const u = await newUser();
    const ins = (code, status, pack, ref) =>
      pool.query(
        `INSERT INTO topups (id,user_id,code,pack,amount_vnd,status,qr_expires_at,bank_ref,tos_version,updated_at)
         VALUES (gen_random_uuid(),$1,$2,$3,1000,$4,now(),$5,'t',now())`,
        [u.id, code, pack, status, ref],
      );
    const c = (s) => `${s}${runId}`.slice(0, 12);
    await ins(c('M1'), 'awaiting_transfer', 'pro', null);
    await ins(c('M2'), 'awaiting_transfer', 'pro', null);
    await assert.rejects(ins(c('M1'), 'awaiting_transfer', 'pro', null), /topups_code_key/);
    await ins(c('M3'), 'approved', 'pro', `ref-${runId}`);
    await assert.rejects(ins(c('M4'), 'approved', 'pro', `ref-${runId}`), /topups_bank_ref_key/);
    await assert.rejects(ins(c('M5'), 'rejected_x', 'pro', null), /topups_status_valid_chk/);
    await assert.rejects(ins(c('M6'), 'pending', 'vip', null), /topups_pack_valid_chk/);
    await assert.rejects(
      pool.query(`INSERT INTO ledger_entries(user_id,type,amount,topup_id) VALUES($1,'TOPUP',5,gen_random_uuid())`, [u.id]),
      /ledger_entries_topup_id_fkey/,
    );
  });

  it('tạo đơn hợp lệ: 201, TopupSchema, số tiền từ server, qrPayload hợp lệ', async () => {
    const u = await newUser();
    const before = Date.now();
    const res = await post(u, { pack: 'pro', consent: true });
    assert.equal(res.status, 201);
    const t = TopupSchema.parse(await res.json());
    assert.equal(t.status, 'awaiting_transfer');
    assert.equal(t.amountVnd, 99000);
    assert.equal(t.credits, 12000);
    assert.equal(t.transferContent, `NAP ${t.code}`);
    assert.match(t.code, /^[A-HJKMNP-Z2-9]{8}$/);
    const ttl = new Date(t.qrExpiresAt).getTime() - before;
    assert.ok(ttl > 14.9 * 60_000 && ttl < 15.1 * 60_000, String(ttl));
    assert.equal(crc16(t.qrPayload.slice(0, -4)), t.qrPayload.slice(-4));
    const tags = parseTlv(t.qrPayload);
    assert.equal(tags['54'], '99000');
    assert.equal(parseTlv(tags['62'])['08'], t.transferContent);
    const row = await prisma.topup.findUnique({ where: { id: t.id } });
    assert.equal(row.tosVersion.length > 0, true);
  });

  it('consent sai/thiếu -> CONSENT_REQUIRED; gói/field lạ -> VALIDATION_FAILED', async () => {
    const u = await newUser();
    for (const body of [{ pack: 'pro', consent: false }, { pack: 'pro' }]) {
      const r = await post(u, body);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, ApiErrorCode.CONSENT_REQUIRED);
    }
    for (const body of [{ pack: 'vip', consent: true }, { pack: 'pro', consent: true, amountVnd: 1 }]) {
      const r = await post(u, body);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, ApiErrorCode.VALIDATION_FAILED);
    }
    assert.equal(await prisma.topup.count({ where: { userId: u.id } }), 0);
  });

  it('đủ 3 đơn mở -> TOPUP_LIMIT; approved/expired không tính', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) assert.equal((await post(u, { pack: 'starter', consent: true })).status, 201);
    const r = await post(u, { pack: 'starter', consent: true });
    assert.equal((await r.json()).code, ApiErrorCode.TOPUP_LIMIT);
    assert.equal(r.status, 429);
    await pool.query(`UPDATE topups SET status='expired' WHERE user_id=$1 AND id=(SELECT id FROM topups WHERE user_id=$1 LIMIT 1)`, [u.id]);
    assert.equal((await post(u, { pack: 'starter', consent: true })).status, 201);
    await pool.query(`UPDATE topups SET status='approved', bank_ref='r-'||id::text WHERE user_id=$1 AND status='awaiting_transfer' AND id=(SELECT id FROM topups WHERE user_id=$1 AND status='awaiting_transfer' LIMIT 1)`, [u.id]);
    assert.equal((await post(u, { pack: 'starter', consent: true })).status, 201);
  });

  it('pending và needs_review cũng tính vào giới hạn; rejected thì không', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) assert.equal((await post(u, { pack: 'starter', consent: true })).status, 201);
    const rows = (await pool.query('SELECT id FROM topups WHERE user_id=$1 ORDER BY id', [u.id])).rows;
    await pool.query(`UPDATE topups SET status='pending', approve_by=now() WHERE id=$1`, [rows[0].id]);
    await pool.query(`UPDATE topups SET status='needs_review', approve_by=now(), note='n' WHERE id=$1`, [rows[1].id]);
    const r = await post(u, { pack: 'starter', consent: true });
    assert.equal((await r.json()).code, ApiErrorCode.TOPUP_LIMIT);
    await pool.query(`UPDATE topups SET status='rejected', reject_reason='x' WHERE id=$1`, [rows[2].id]);
    assert.equal((await post(u, { pack: 'starter', consent: true })).status, 201);
  });

  it('4 yêu cầu song song -> đúng 3 đơn', async () => {
    const u = await newUser();
    const rs = await Promise.all([1, 2, 3, 4].map(() => post(u, { pack: 'creator', consent: true })));
    const codes = await Promise.all(rs.map(async (r) => (r.status === 201 ? 'ok' : (await r.json()).code)));
    assert.equal(codes.filter((c) => c === 'ok').length, 3);
    assert.equal(codes.filter((c) => c === ApiErrorCode.TOPUP_LIMIT).length, 1);
    assert.equal(await prisma.topup.count({ where: { userId: u.id } }), 3);
  });

  it('tài khoản khóa -> ACCOUNT_LOCKED', async () => {
    const u = await newUser({ locked: true });
    const r = await post(u, { pack: 'pro', consent: true });
    assert.equal((await r.json()).code, ApiErrorCode.ACCOUNT_LOCKED);
    assert.equal(await prisma.topup.count({ where: { userId: u.id } }), 0);
  });

  it('chưa đăng nhập -> 401', async () => {
    const r = await fetch(`${baseUrl}/topups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
  });

  it('GET /topups/{id}: của mình OK, người khác FORBIDDEN, không có NOT_FOUND', async () => {
    const a = await newUser();
    const b = await newUser();
    const created = await (await post(a, { pack: 'pro', consent: true })).json();
    const ok = await call(a, 'GET', `/topups/${created.id}`);
    assert.equal(ok.status, 200);
    assert.equal(TopupSchema.parse(await ok.json()).id, created.id);
    const forbidden = await call(b, 'GET', `/topups/${created.id}`);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, ApiErrorCode.FORBIDDEN);
    const nf = await call(a, 'GET', `/topups/${crypto.randomUUID()}`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).code, ApiErrorCode.NOT_FOUND);
  });

  it('GET /topups: mới nhất trước, phân trang cursor, chỉ đơn của mình', async () => {
    const a = await newUser();
    const b = await newUser();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await (await post(a, { pack: 'pro', consent: true })).json()).id);
    await post(b, { pack: 'pro', consent: true });
    const p1 = TopupListResponseSchema.parse(await (await call(a, 'GET', '/topups?pageSize=2')).json());
    assert.equal(p1.items.length, 2);
    assert.equal(p1.hasMore, true);
    assert.deepEqual(p1.items.map((i) => i.id), [ids[2], ids[1]]);
    const p2 = TopupListResponseSchema.parse(await (await call(a, 'GET', `/topups?pageSize=2&cursor=${p1.nextCursor}`)).json());
    assert.deepEqual(p2.items.map((i) => i.id), [ids[0]]);
    assert.equal(p2.hasMore, false);
    const bad = await call(a, 'GET', `/topups?cursor=${p1.items[0].id.replace(/./, 'x')}`);
    assert.equal(bad.status, 400);
    // Cursor hợp lệ về định dạng nhưng của người khác hoặc không tồn tại -> VALIDATION_FAILED.
    const bTopup = await prisma.topup.findFirst({ where: { userId: b.id } });
    for (const cursor of [bTopup.id, crypto.randomUUID()]) {
      const res = await call(a, 'GET', `/topups?cursor=${cursor}`);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, ApiErrorCode.VALIDATION_FAILED);
    }
  });

  it('va chạm mã: sinh lại, yêu cầu vẫn thành công', async () => {
    const u = await newUser();
    const v = await newUser();
    // Ép lần sinh đầu ra 'AAAAAAAA' (8 lần randomInt = 0), đặt sẵn đơn có mã đó.
    const orig = crypto.randomInt;
    let forced = 8;
    crypto.randomInt = (...args) => (forced-- > 0 ? 0 : orig(...args));
    try {
      const first = await (await post(u, { pack: 'pro', consent: true })).json();
      assert.equal(first.code, 'AAAAAAAA');
      forced = 8;
      const r = await post(v, { pack: 'pro', consent: true });
      assert.equal(r.status, 201);
      const second = TopupSchema.parse(await r.json());
      assert.notEqual(second.code, 'AAAAAAAA');
    } finally {
      crypto.randomInt = orig;
    }
  });

  it('thiếu cấu hình tài khoản nhận -> lỗi rõ', async () => {
    const { readBankAccountConfig } = await import('../dist/modules/topups/index.js');
    assert.throws(
      () => readBankAccountConfig({}),
      (e) => e.getStatus?.() === 500 && !/TOPUP_BANK/.test(JSON.stringify(e.getResponse())),
    );
  });
});

describe('Story 3.2: rate limit POST /topups', () => {
  it('vượt giới hạn -> RATE_LIMITED', async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'X';
    process.env.TOPUP_THROTTLE_LIMIT = '2';
    process.env.TOPUP_THROTTLE_TTL_MS = '60000';
    const app = await bootstrapApi();
    const pool = new pg.Pool({ connectionString: DB_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const jwt = app.get(JwtService);
    const u = await prisma.user.create({
      data: { googleId: `tpr-${crypto.randomBytes(4).toString('hex')}`, email: `tpr-${crypto.randomBytes(4).toString('hex')}@motionai.vn`, tosVersion: 'tos-v7' },
    });
    try {
      const token = jwt.sign({ sub: u.id, email: u.email, role: 'user' });
      const statuses = [];
      let last;
      for (let i = 0; i < 4; i++) {
        const r = await fetch(`${baseUrl}/topups`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack: 'pro', consent: true }),
        });
        statuses.push(r.status);
        last = await r.json();
      }
      assert.ok(statuses.includes(429), statuses.join());
      assert.equal(last.code, ApiErrorCode.RATE_LIMITED);
    } finally {
      const rd = new Redis(REDIS_URL);
      const keys = await rd.keys('throttle:*');
      if (keys.length) await rd.del(...keys);
      rd.disconnect();
      await pool.query('DELETE FROM topups WHERE user_id=$1', [u.id]);
      await prisma.user.delete({ where: { id: u.id } });
      await prisma.$disconnect();
      await pool.end();
      await app.close();
    }
  });
});

describe('Story 3.2: rate limit POST /topups theo người dùng', () => {
  it('hai người dùng cùng IP không dùng chung bộ đếm', async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'X';
    process.env.TOPUP_THROTTLE_LIMIT = '2';
    process.env.TOPUP_THROTTLE_TTL_MS = '60000';
    const app = await bootstrapApi();
    const pool = new pg.Pool({ connectionString: DB_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const jwt = app.get(JwtService);
    const mk = async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const u = await prisma.user.create({ data: { googleId: `tpu-${tag}`, email: `tpu-${tag}@motionai.vn`, tosVersion: 'tos-v7' } });
      return { u, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
    };
    const a = await mk();
    const b = await mk();
    const post = (who) =>
      fetch(`${baseUrl}/topups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: 'pro', consent: true }),
      });
    try {
      for (let i = 0; i < 2; i++) await post(a);
      const blocked = await post(a);
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, ApiErrorCode.RATE_LIMITED);
      // Cùng IP nhưng người dùng khác: không bị chặn bởi bộ đếm của A.
      const other = await post(b);
      assert.equal(other.status, 201);
    } finally {
      const rd = new Redis(REDIS_URL);
      const keys = await rd.keys('throttle:*');
      if (keys.length) await rd.del(...keys);
      rd.disconnect();
      for (const x of [a, b]) {
        await pool.query('DELETE FROM topups WHERE user_id=$1', [x.u.id]);
        await prisma.user.delete({ where: { id: x.u.id } });
      }
      await prisma.$disconnect();
      await pool.end().catch(() => {});
      await app.close();
    }
  });
});

describe('Story 3.2: bộ đếm tạo đơn và xác nhận chuyển khoản tách riêng', () => {
  it('đã chạm giới hạn tạo đơn vẫn xác nhận được chuyển khoản', async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'X';
    process.env.TOPUP_THROTTLE_LIMIT = '2';
    process.env.TOPUP_THROTTLE_TTL_MS = '60000';
    const app = await bootstrapApi();
    const pool = new pg.Pool({ connectionString: DB_URL });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const jwt = app.get(JwtService);
    const tag = crypto.randomBytes(4).toString('hex');
    const u = await prisma.user.create({ data: { googleId: `tpc-${tag}`, email: `tpc-${tag}@motionai.vn`, tosVersion: 'tos-v7' } });
    const token = jwt.sign({ sub: u.id, email: u.email, role: 'user' });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const first = await fetch(`${baseUrl}/topups`, { method: 'POST', headers, body: JSON.stringify({ pack: 'pro', consent: true }) });
      assert.equal(first.status, 201);
      const created = await first.json();
      const second = await fetch(`${baseUrl}/topups`, { method: 'POST', headers, body: JSON.stringify({ pack: 'pro', consent: true }) });
      assert.equal(second.status, 201);
      assert.equal((await fetch(`${baseUrl}/topups`, { method: 'POST', headers, body: JSON.stringify({ pack: 'pro', consent: true }) })).status, 429);
      const confirm = await fetch(`${baseUrl}/topups/${created.id}/confirm-transfer`, { method: 'POST', headers });
      assert.equal(confirm.status, 200);
    } finally {
      const rd = new Redis(REDIS_URL);
      const keys = await rd.keys('throttle:*');
      if (keys.length) await rd.del(...keys);
      rd.disconnect();
      await pool.query('DELETE FROM topups WHERE user_id=$1', [u.id]);
      await prisma.user.delete({ where: { id: u.id } });
      await prisma.$disconnect();
      await pool.end().catch(() => {});
      await app.close();
    }
  });
});

describe('Story 3.3: [BE] Xác nhận chuyển khoản, hạn QR và hạn duyệt', () => {
  let app, baseUrl, pool, jwt, sweeper;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  let seq = 0;

  async function newUser() {
    const n = users.length;
    const r = await pool.query(
      `INSERT INTO users (id,google_id,email,tos_version,updated_at) VALUES (gen_random_uuid(),$1,$2,'tos-v7',now()) RETURNING id,email`,
      [`tc-${runId}-${n}`, `tc-${runId}-${n}@motionai.vn`],
    );
    users.push(r.rows[0].id);
    return { id: r.rows[0].id, token: jwt.sign({ sub: r.rows[0].id, email: r.rows[0].email, role: 'user' }) };
  }
  async function mkTopup(user, status, qrOffsetSec) {
    const r = await pool.query(
      `INSERT INTO topups (id,user_id,code,pack,amount_vnd,status,qr_expires_at,tos_version,updated_at)
       VALUES (gen_random_uuid(),$1,$2,'pro',99000,$3, now() + ($4 || ' seconds')::interval,'t',now()) RETURNING id`,
      [user.id, `C${runId}${seq++}`.slice(0, 12), status, String(qrOffsetSec)],
    );
    return r.rows[0].id;
  }
  const state = async (id) => (await pool.query('SELECT status, approve_by FROM topups WHERE id=$1', [id])).rows[0];
  const confirm = (user, id) =>
    fetch(`${baseUrl}/topups/${id}/confirm-transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    });

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'CONG TY MOTION AI';
    process.env.TOPUP_THROTTLE_LIMIT = '1000';
    await ensureInfra();
    const rd0 = new Redis(REDIS_URL);
    const stale = await rd0.keys('throttle:*');
    if (stale.length) await rd0.del(...stale);
    rd0.disconnect();
    pool = new pg.Pool({ connectionString: DB_URL });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    sweeper = app.get(TopupSweeperService);
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('computeApproveBy: biên khung giờ UTC+7', () => {
    const vn = (iso) => new Date(`${iso}+07:00`);
    const cases = [
      ['2026-11-10T10:00:00', '2026-11-10T10:15:00'],
      ['2026-11-10T23:30:00', '2026-11-11T08:15:00'],
      ['2026-11-10T07:00:00', '2026-11-10T08:15:00'],
      ['2026-11-10T22:50:00', '2026-11-10T23:05:00'],
      ['2026-11-10T23:00:00', '2026-11-11T08:15:00'],
      ['2026-11-10T08:00:00', '2026-11-10T08:15:00'],
      ['2026-12-31T23:30:00', '2027-01-01T08:15:00'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(computeApproveBy(vn(input)).toISOString(), vn(expected).toISOString(), input);
    }
  });

  it('xác nhận hợp lệ: pending + approveBy; gọi lặp idempotent', async () => {
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer', 600);
    const r1 = await confirm(u, id);
    assert.equal(r1.status, 200);
    const b1 = TopupSchema.parse(await r1.json());
    assert.equal(b1.status, 'pending');
    assert.ok(b1.approveBy);
    const r2 = await confirm(u, id);
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.status, 'pending');
    assert.equal(b2.approveBy, b1.approveBy);
  });

  it('id sai định dạng/không có: NOT_FOUND; của người khác: FORBIDDEN', async () => {
    const u = await newUser();
    const other = await newUser();
    const id = await mkTopup(other, 'awaiting_transfer', 600);
    let r = await confirm(u, 'abc');
    assert.equal(r.status, 404);
    r = await confirm(u, crypto.randomUUID());
    assert.equal(r.status, 404);
    r = await confirm(u, id);
    assert.equal(r.status, 403);
    assert.equal((await state(id)).status, 'awaiting_transfer');
  });

  it('QR hết hạn: đơn thành expired và trả TOPUP_QR_EXPIRED 409', async () => {
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer', -5);
    const r = await confirm(u, id);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, ApiErrorCode.TOPUP_QR_EXPIRED);
    assert.equal((await state(id)).status, 'expired');
  });

  it('trạng thái khác: TOPUP_STATE_INVALID, không đổi', async () => {
    const u = await newUser();
    for (const st of ['approved', 'rejected', 'needs_review', 'expired']) {
      const id = await mkTopup(u, st, 600);
      const r = await confirm(u, id);
      assert.equal(r.status, 409, st);
      assert.equal((await r.json()).code, ApiErrorCode.TOPUP_STATE_INVALID, st);
      assert.equal((await state(id)).status, st);
    }
  });

  it('bộ quét: expired cho awaiting quá hạn, giữ nguyên pending quá hạn', async () => {
    const u = await newUser();
    const a = await mkTopup(u, 'awaiting_transfer', -5);
    const fresh = await mkTopup(u, 'awaiting_transfer', 600);
    const p = await mkTopup(u, 'pending', -3600);
    await pool.query(`UPDATE topups SET approve_by = now() - interval '1 hour' WHERE id=$1`, [p]);
    await sweeper.sweepExpired();
    assert.equal((await state(a)).status, 'expired');
    assert.equal((await state(fresh)).status, 'awaiting_transfer');
    assert.equal((await state(p)).status, 'pending');
  });

  it('đua xác nhận và bộ quét: mỗi đơn đúng một trạng thái cuối', async () => {
    const u = await newUser();
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await mkTopup(u, 'awaiting_transfer', 1));
    await new Promise((r) => setTimeout(r, 900));
    const [codes] = await Promise.all([
      Promise.all(ids.map((id) => confirm(u, id).then((r) => r.status))),
      sweeper.sweepExpired(),
    ]);
    // Bên thắng 200, bên thua 409 (QR hết hạn); không bao giờ 5xx.
    for (const c of codes) assert.ok(c === 200 || c === 409, String(c));
    for (let i = 0; i < ids.length; i++) {
      const s = await state(ids[i]);
      assert.ok(['pending', 'expired'].includes(s.status), s.status);
      if (s.status === 'pending') {
        assert.ok(s.approve_by);
        assert.equal(codes[i], 200);
      } else {
        assert.equal(s.approve_by, null);
        assert.equal(codes[i], 409);
      }
    }
  });

  it('scheduledSweep chỉ quét khi MOTION_PROCESS_ROLE=worker', async () => {
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer', -5);
    const prev = process.env.MOTION_PROCESS_ROLE;
    try {
      delete process.env.MOTION_PROCESS_ROLE;
      await sweeper.scheduledSweep();
      assert.equal((await state(id)).status, 'awaiting_transfer');
      process.env.MOTION_PROCESS_ROLE = 'api';
      await sweeper.scheduledSweep();
      assert.equal((await state(id)).status, 'awaiting_transfer');
      process.env.MOTION_PROCESS_ROLE = 'worker';
      await sweeper.scheduledSweep();
      assert.equal((await state(id)).status, 'expired');
    } finally {
      if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prev;
    }
  });

  it('create tự loại đơn quá hạn QR khỏi giới hạn, không cần bộ quét', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await mkTopup(u, 'awaiting_transfer', -5);
    const r = await fetch(`${baseUrl}/topups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: 'pro', consent: true }),
    });
    assert.equal(r.status, 201);
    const n = await pool.query(`SELECT count(*)::int AS n FROM topups WHERE user_id=$1 AND status='expired'`, [u.id]);
    assert.equal(n.rows[0].n, 3);
  });

  it('giải phóng chỗ: đơn quá hạn không chiếm chỗ, đủ 3 đơn mở thật vẫn bị chặn', async () => {
    const u = await newUser();
    await mkTopup(u, 'awaiting_transfer', -5);
    await mkTopup(u, 'pending', 600);
    await mkTopup(u, 'needs_review', 600);
    const create = () =>
      fetch(`${baseUrl}/topups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: 'pro', consent: true }),
      });
    // Đơn quá hạn QR bị loại ngay khi tạo, nên còn 2 đơn mở: tạo được đơn thứ 3.
    assert.equal((await create()).status, 201);
    // Giờ đủ 3 đơn mở thật (pending, needs_review, awaiting_transfer mới): bị chặn.
    assert.equal((await create()).status, 429);
    // Bộ quét vẫn an toàn khi chạy sau đó.
    await sweeper.sweepExpired();
    assert.equal((await create()).status, 429);
  });
});

describe('Story 3.4: [BE] Thông báo Discord cho Admin', () => {
  let app, baseUrl, pool, jwt, sweeper, fake, notifier;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  let seq = 0;
  let mode = 'ok';
  const received = [];
  const WEBHOOK_PATH = '/api/webhooks/secret-token-xyz';

  async function newUser() {
    const n = users.length;
    const r = await pool.query(
      `INSERT INTO users (id,google_id,email,tos_version,updated_at) VALUES (gen_random_uuid(),$1,$2,'tos-v7',now()) RETURNING id,email`,
      [`td-${runId}-${n}`, `td-${runId}-${n}@motionai.vn`],
    );
    users.push(r.rows[0].id);
    return { id: r.rows[0].id, email: r.rows[0].email, token: jwt.sign({ sub: r.rows[0].id, email: r.rows[0].email, role: 'user' }) };
  }
  const codeById = new Map();
  async function mkTopup(user, status) {
    const code = `D${runId}${seq++}`.slice(0, 12);
    const r = await pool.query(
      `INSERT INTO topups (id,user_id,code,pack,amount_vnd,status,qr_expires_at,tos_version,updated_at)
       VALUES (gen_random_uuid(),$1,$2,'pro',99000,$3, now() + interval '600 seconds','t',now()) RETURNING id`,
      [user.id, code, status],
    );
    codeById.set(r.rows[0].id, code);
    return r.rows[0].id;
  }
  const row = async (id) =>
    (await pool.query('SELECT status, notified_at, notify_attempts, notify_attempted_at, overdue_notified_at FROM topups WHERE id=$1', [id])).rows[0];
  const confirm = (user, id) =>
    fetch(`${baseUrl}/topups/${id}/confirm-transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    });
  const ageAttempt = (id) =>
    pool.query(`UPDATE topups SET notify_attempted_at = now() - interval '2 minutes' WHERE id=$1`, [id]);
  // Tin nhắn chỉ chứa mã đơn (không còn UUID), nên khớp theo code.
  const forId = (id) => received.filter((r) => r.body.includes(codeById.get(id)));
  async function waitFor(fn, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail('waitFor timeout');
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'CONG TY MOTION AI';
    process.env.TOPUP_THROTTLE_LIMIT = '1000';
    fake = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url, body: Buffer.concat(chunks).toString() });
        if (mode === 'fail') { res.writeHead(500); res.end('boom'); }
        else if (mode === '429') { res.writeHead(429); res.end('slow'); }
        else { res.writeHead(204); res.end(); }
      });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    process.env.DISCORD_WEBHOOK_URL = `http://127.0.0.1:${fake.address().port}${WEBHOOK_PATH}`;
    await ensureInfra();
    const rd0 = new Redis(REDIS_URL);
    const stale = await rd0.keys('throttle:*');
    if (stale.length) await rd0.del(...stale);
    rd0.disconnect();
    pool = new pg.Pool({ connectionString: DB_URL });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    sweeper = app.get(TopupSweeperService);
    notifier = app.get(NOTIFIER_PORT);
  });

  after(async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    if (pool) {
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    }
    await pool?.end().catch(() => {});
    await app?.close();
    await new Promise((r) => fake?.close(r));
  });

  it('đơn mới pending: đúng 1 request, notified_at đặt, nội dung an toàn, lặp không gửi thêm', async () => {
    mode = 'ok';
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer');
    const code = (await pool.query('SELECT code FROM topups WHERE id=$1', [id])).rows[0].code;
    assert.equal((await confirm(u, id)).status, 200);
    await waitFor(async () => (await row(id)).notified_at !== null);
    assert.equal((await confirm(u, id)).status, 200);
    await sweeper.sweepNotifications();
    const reqs = forId(id);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].url, WEBHOOK_PATH);
    const parsed = JSON.parse(reqs[0].body);
    assert.deepEqual(parsed.allowed_mentions, { parse: [] });
    assert.ok(parsed.content.length <= 2000);
    for (const needle of [code, '99.000đ', 'pro', 'giờ VN']) assert.ok(parsed.content.includes(needle), needle);
    assert.ok(!parsed.content.includes('{'), 'không còn dòng JSON');
    assert.ok(!/\dT\d{2}:\d{2}.*Z/.test(parsed.content), 'không dùng giờ UTC dạng ISO');
    for (const bad of [u.email, 'jwt', u.token, '0123456789', 'CONG TY MOTION AI', 'secret-token-xyz', 'Bearer'])
      assert.ok(!reqs[0].body.includes(bad), bad);
  });

  it('Discord lỗi: confirm vẫn 200, thử lại bằng bộ quét sau 60 giây, đúng 1 thông báo thành công', async () => {
    mode = 'fail';
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer');
    assert.equal((await confirm(u, id)).status, 200);
    await waitFor(async () => (await row(id)).notify_attempts === 1 && forId(id).length === 1);
    let r = await row(id);
    assert.equal(r.notified_at, null);
    // Chưa đủ 60 giây: bộ quét không nhận phiên.
    await sweeper.sweepNotifications();
    assert.equal(forId(id).length, 1);
    mode = '429';
    await ageAttempt(id);
    await sweeper.sweepNotifications();
    assert.equal((await row(id)).notified_at, null);
    assert.equal((await row(id)).notify_attempts, 2);
    mode = 'ok';
    await ageAttempt(id);
    await sweeper.sweepNotifications();
    await sweeper.sweepNotifications();
    r = await row(id);
    assert.ok(r.notified_at);
    assert.equal(r.notify_attempts, 3);
    assert.equal(forId(id).length, 3);
  });

  it('hết 5 lượt: không gửi thêm', async () => {
    mode = 'fail';
    const u = await newUser();
    const id = await mkTopup(u, 'awaiting_transfer');
    assert.equal((await confirm(u, id)).status, 200);
    await waitFor(async () => (await row(id)).notify_attempts === 1 && forId(id).length === 1);
    for (let i = 0; i < 6; i++) {
      await ageAttempt(id);
      await sweeper.sweepNotifications();
    }
    assert.equal((await row(id)).notify_attempts, 5);
    assert.equal(forId(id).length, 5);
    assert.equal((await row(id)).notified_at, null);
    mode = 'ok';
  });

  it('hai bên đua: đúng 1 request Discord', async () => {
    mode = 'ok';
    const u = await newUser();
    const id = await mkTopup(u, 'pending');
    await pool.query(`UPDATE topups SET approve_by = now() + interval '1 hour' WHERE id=$1`, [id]);
    await Promise.all([
      sweeper.sweepNotifications(),
      app.get(TopupNotifierService).notifyPending(id),
      app.get(TopupNotifierService).notifyPending(id),
    ]);
    assert.equal(forId(id).length, 1);
    assert.ok((await row(id)).notified_at);
  });

  it('quá hạn duyệt: đúng 1 cảnh báo, các lần quét sau không lặp', async () => {
    mode = 'ok';
    const u = await newUser();
    const id = await mkTopup(u, 'pending');
    await pool.query(`UPDATE topups SET approve_by = now() - interval '1 minute', notified_at = now() WHERE id=$1`, [id]);
    await sweeper.sweepNotifications();
    await sweeper.sweepNotifications();
    assert.equal(forId(id).length, 1);
    assert.ok((await row(id)).overdue_notified_at);
    assert.ok(forId(id)[0].body.includes('quá hạn'));
  });

  it('quá hạn duyệt: Discord lỗi thì không mất cảnh báo, lần quét sau gửi lại đúng 1 lần', async () => {
    const u = await newUser();
    const id = await mkTopup(u, 'pending');
    await pool.query(`UPDATE topups SET approve_by = now() - interval '1 minute', notified_at = now() WHERE id=$1`, [id]);
    mode = 'fail';
    await sweeper.sweepNotifications();
    assert.equal((await row(id)).overdue_notified_at, null);
    mode = 'ok';
    await sweeper.sweepNotifications();
    await sweeper.sweepNotifications();
    assert.ok((await row(id)).overdue_notified_at);
    assert.equal(forId(id).filter((x) => x.body.includes('quá hạn')).length, 2);
  });

  it('scheduledSweep chạy quét thông báo chỉ khi role=worker, kể cả khi sweepExpired ném lỗi', async () => {
    mode = 'ok';
    const u = await newUser();
    const id = await mkTopup(u, 'pending');
    await pool.query(`UPDATE topups SET approve_by = now() - interval '1 minute' WHERE id=$1`, [id]);
    const prev = process.env.MOTION_PROCESS_ROLE;
    const origSweepExpired = sweeper.sweepExpired;
    try {
      process.env.MOTION_PROCESS_ROLE = 'api';
      await sweeper.scheduledSweep();
      assert.equal(forId(id).length, 0);
      process.env.MOTION_PROCESS_ROLE = 'worker';
      sweeper.sweepExpired = async () => {
        throw new Error('sweepExpired lỗi giả lập');
      };
      await sweeper.scheduledSweep();
      // Đơn pending chưa thông báo + quá hạn duyệt: một tin chờ duyệt và một tin quá hạn.
      assert.equal(forId(id).length, 2);
      assert.ok((await row(id)).notified_at);
      assert.ok((await row(id)).overdue_notified_at);
    } finally {
      sweeper.sweepExpired = origSweepExpired;
      if (prev === undefined) delete process.env.MOTION_PROCESS_ROLE;
      else process.env.MOTION_PROCESS_ROLE = prev;
    }
  });

  it('đã gửi Discord nhưng ghi notified_at lỗi thoáng qua: thử lại, không gửi trùng', async () => {
    mode = 'ok';
    const u = await newUser();
    const id = await mkTopup(u, 'pending');
    await pool.query(`UPDATE topups SET approve_by = now() + interval '1 hour' WHERE id=$1`, [id]);
    const prisma = app.get(PrismaService);
    const orig = prisma.$executeRaw;
    let failed = 0;
    prisma.$executeRaw = function (strings, ...values) {
      if (failed < 2 && strings.join('?').includes('SET notified_at')) {
        failed++;
        return Promise.reject(new Error('DB lỗi thoáng qua'));
      }
      return orig.call(this, strings, ...values);
    };
    try {
      assert.equal(await app.get(TopupNotifierService).notifyPending(id), true);
    } finally {
      prisma.$executeRaw = orig;
    }
    assert.equal(failed, 2);
    assert.ok((await row(id)).notified_at, 'notified_at phải được ghi sau khi thử lại');
    await ageAttempt(id);
    await sweeper.sweepNotifications();
    assert.equal(forId(id).length, 1, 'không được gửi trùng');
  });

  it('quá hạn duyệt: nhận từng đơn một, lỗi nhận một đơn không mất cảnh báo các đơn khác', async () => {
    mode = 'ok';
    const u = await newUser();
    const first = await mkTopup(u, 'pending');
    const second = await mkTopup(u, 'pending');
    await pool.query(
      `UPDATE topups SET approve_by = now() - interval '2 hours', notified_at = now() WHERE id=$1`, [first]);
    await pool.query(
      `UPDATE topups SET approve_by = now() - interval '1 hour', notified_at = now() WHERE id=$1`, [second]);
    const prisma = app.get(PrismaService);
    const orig = prisma.$queryRaw;
    prisma.$queryRaw = function (strings, ...values) {
      if (strings.join('?').includes('SET overdue_notified_at = now()') && values[0] === second) {
        return Promise.reject(new Error('DB lỗi khi nhận đơn'));
      }
      return orig.call(this, strings, ...values);
    };
    try {
      await app.get(TopupNotifierService).alertOverdue();
    } finally {
      prisma.$queryRaw = orig;
    }
    assert.ok((await row(first)).overdue_notified_at);
    assert.equal((await row(second)).overdue_notified_at, null, 'đơn chưa nhận thì chưa bị đánh dấu');
    assert.equal(forId(second).length, 0);
    await app.get(TopupNotifierService).alertOverdue();
    assert.equal(forId(second).filter((x) => x.body.includes('quá hạn')).length, 1);
    assert.equal(forId(first).filter((x) => x.body.includes('quá hạn')).length, 1);
  });

  it('createNotifierPort: URL sai định dạng thì dùng adapter log', async () => {
    const prev = process.env.DISCORD_WEBHOOK_URL;
    process.env.DISCORD_WEBHOOK_URL = 'không phải url';
    try {
      assert.ok(!(createNotifierPort() instanceof DiscordNotifierAdapter));
    } finally {
      if (prev === undefined) delete process.env.DISCORD_WEBHOOK_URL;
      else process.env.DISCORD_WEBHOOK_URL = prev;
    }
  });

  it('cảnh báo LEDGER_MISMATCH đi qua Discord; lỗi Discord được ném ra cho người gọi', async () => {
    mode = 'ok';
    const marker = `mismatch-${runId}`;
    await notifier.notify({ kind: 'LEDGER_MISMATCH', severity: 'error', message: marker });
    assert.equal(received.filter((r) => r.body.includes(marker)).length, 1);
    mode = 'fail';
    await assert.rejects(() => notifier.notify({ kind: 'X', message: 'y' }), (e) => {
      assert.ok(!String(e.message).includes('secret-token-xyz'));
      return true;
    });
    mode = 'ok';
  });

  it('createNotifierPort: không có webhook thì dùng adapter log', async () => {
    const prev = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    try {
      const p = createNotifierPort();
      assert.ok(!(p instanceof DiscordNotifierAdapter));
      await p.notify({ kind: 'T', message: 'm' });
    } finally {
      if (prev === undefined) delete process.env.DISCORD_WEBHOOK_URL;
      else process.env.DISCORD_WEBHOOK_URL = prev;
    }
  });
});
