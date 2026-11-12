import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AdminAdjustResponseSchema, AdminUserSchema, AdminUserStatsResponseSchema, ApiErrorCode } from '@flowvis/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';

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

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';
process.env.RUNNINGHUB_WORKFLOW_MOTION ??= 'wf-motion';


describe('Story 6.4: [BE] Khóa tài khoản và cộng bù credit', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  let admin;

  async function mkUser(role = 'user', balance = 0) {
    const n = userIds.length;
    const u = await prisma.user.create({
      data: { googleId: `au-${runId}-${n}`, email: `au-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', role },
    });
    userIds.push(u.id);
    if (balance) {
      await pool.query(`INSERT INTO ledger_entries (id,user_id,type,amount) VALUES (gen_random_uuid(),$1,'ADJUST',$2)`, [u.id, balance]);
      await pool.query('UPDATE users SET balance=$2 WHERE id=$1', [u.id, balance]);
    }
    return { id: u.id, email: u.email, token: jwt.sign({ sub: u.id, email: u.email, role }) };
  }
  const call = (who, method, url, body, headers = {}) =>
    fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const adm = (method, url, body) => call(admin, method, url, body);
  const errCode = async (res) => (await res.json()).code;
  const adjustRows = async (uid) => (await pool.query(`SELECT * FROM ledger_entries WHERE user_id=$1 AND type='ADJUST'`, [uid])).rows;
  const bal = async (uid) => Number((await pool.query('SELECT balance FROM users WHERE id=$1', [uid])).rows[0].balance);

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.ADMIN_ADJUST_MAX = '1000';
    await ensureInfra();
    const rd0 = new Redis(REDIS_URL);
    const stale = await rd0.keys('throttle:*');
    if (stale.length) await rd0.del(...stale);
    rd0.disconnect();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    admin = await mkUser('admin');
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM admin_audit WHERE admin_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('quyền: 401 không token, 403 user thường, 404 không tìm thấy', async () => {
    const u = await mkUser();
    assert.equal((await call(null, 'GET', `/admin/users/${u.id}`)).status, 401);
    assert.equal((await call(u, 'GET', `/admin/users/${u.id}`)).status, 403);
    assert.equal((await call(u, 'POST', `/admin/users/${u.id}/lock`, { reason: 'x' })).status, 403);
    assert.equal((await call(u, 'POST', `/admin/users/${u.id}/adjust`, {})).status, 403);
    const nf = await adm('GET', `/admin/users/${crypto.randomUUID()}`);
    assert.equal(nf.status, 404);
    assert.equal(await errCode(nf), ApiErrorCode.NOT_FOUND);
    assert.equal((await adm('GET', `/admin/users?email=nobody-${runId}@x.vn`)).status, 404);
  });

  it('thống kê số lượng tài khoản: quyền, đếm tăng theo tài khoản mới/khóa/gói, chuỗi theo ngày', async () => {
    const u = await mkUser();
    assert.equal((await call(null, 'GET', '/admin/users/stats')).status, 401);
    assert.equal((await call(u, 'GET', '/admin/users/stats')).status, 403);
    assert.equal((await adm('GET', '/admin/users/stats?days=3')).status, 400);

    const get = async () => {
      const r = await adm('GET', '/admin/users/stats?days=7');
      assert.equal(r.status, 200);
      return AdminUserStatsResponseSchema.parse(await r.json());
    };
    const s0 = await get();
    assert.equal(s0.signupsByDay.length, 7);
    assert.equal(s0.active + s0.locked, s0.total);
    assert.deepEqual(s0.byTier.map((t) => t.tier), ['FREE', 'Starter', 'Pro', 'Creator']);
    assert.equal(s0.byTier.reduce((a, t) => a + t.count, 0), s0.total);

    const a = await mkUser();
    const b = await mkUser();
    await pool.query("UPDATE users SET locked_at = now() WHERE id = $1", [a.id]);
    await pool.query("UPDATE users SET tier_pack = 'pro' WHERE id = $1", [b.id]);
    const s1 = await get();
    assert.equal(s1.total - s0.total, 2);
    assert.equal(s1.locked - s0.locked, 1);
    assert.equal(s1.byTier.find((t) => t.tier === 'Pro').count - s0.byTier.find((t) => t.tier === 'Pro').count, 1);
    assert.equal(s1.signupsByDay.at(-1).count - s0.signupsByDay.at(-1).count, 2);
  });

  it('tra cứu theo email và id', async () => {
    const u = await mkUser('user', 300);
    const r = await adm('GET', `/admin/users?email=${encodeURIComponent(u.email)}`);
    assert.equal(r.status, 200);
    const j = AdminUserSchema.parse(await r.json());
    assert.equal(j.id, u.id);
    assert.equal(j.balance, 300);
    assert.equal(j.lockedAt, null);
    assert.equal((await adm('GET', `/admin/users/${u.id}`)).status, 200);
  });

  it('khóa: thiếu reason 400, JWT cũ 403 ACCOUNT_LOCKED, refresh bị thu hồi và từ chối, audit; mở khóa', async () => {
    const u = await mkUser();
    const raw = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO refresh_tokens (id,user_id,token_hash,expires_at) VALUES (gen_random_uuid(),$1,$2,now()+interval '1 day')`,
      [u.id, crypto.createHash('sha256').update(raw).digest('hex')],
    );
    const bad = await adm('POST', `/admin/users/${u.id}/lock`, {});
    assert.equal(bad.status, 400);
    const bj = await bad.json();
    assert.equal(bj.code, ApiErrorCode.VALIDATION_FAILED);
    assert.equal(bj.details.reason, 'REASON_REQUIRED');

    const r = await adm('POST', `/admin/users/${u.id}/lock`, { reason: 'vi phạm' });
    assert.equal(r.status, 200);
    assert.ok(AdminUserSchema.parse(await r.json()).lockedAt);
    const rt = await pool.query('SELECT revoked_at FROM refresh_tokens WHERE user_id=$1', [u.id]);
    assert.ok(rt.rows.every((x) => x.revoked_at !== null));
    const w = await call(u, 'POST', '/topups', { pack: 'starter', tosVersion: 'tos-v7' });
    assert.equal(w.status, 403);
    assert.equal(await errCode(w), ApiErrorCode.ACCOUNT_LOCKED);
    const rf = await call(null, 'POST', '/auth/refresh', undefined, { Cookie: `refreshToken=${raw}` });
    assert.equal(rf.status, 401);
    const a = await pool.query(`SELECT * FROM admin_audit WHERE target=$1 AND action='user.lock'`, [`user:${u.id}`]);
    assert.equal(a.rows.length, 1);
    assert.equal(a.rows[0].before_after.reason, 'vi phạm');

    assert.equal((await adm('POST', `/admin/users/${u.id}/unlock`, { reason: '  ' })).status, 400);
    const un = await adm('POST', `/admin/users/${u.id}/unlock`, { reason: 'khiếu nại ok' });
    assert.equal(un.status, 200);
    assert.equal((await un.json()).lockedAt, null);
    assert.equal(
      (await pool.query(`SELECT 1 FROM admin_audit WHERE target=$1 AND action='user.unlock'`, [`user:${u.id}`])).rows.length, 1);
  });

  it('adjust cộng/trừ, vượt hạn mức, thiếu số dư, idempotent', async () => {
    const u = await mkUser();
    const rid = crypto.randomUUID();
    const r = await adm('POST', `/admin/users/${u.id}/adjust`, { amount: 500, reason: 'bù lỗi', requestId: rid });
    assert.equal(r.status, 200);
    const j = AdminAdjustResponseSchema.parse(await r.json());
    assert.equal(j.entry.amount, 500);
    assert.equal(j.entry.type, 'ADJUST');
    assert.equal(j.user.balance, 500);
    assert.equal(await bal(u.id), 500);

    const again = await adm('POST', `/admin/users/${u.id}/adjust`, { amount: 500, reason: 'bù lỗi', requestId: rid });
    assert.deepEqual(await again.json(), j);
    assert.equal((await adjustRows(u.id)).length, 1);
    assert.equal(await bal(u.id), 500);

    const over = await adm('POST', `/admin/users/${u.id}/adjust`, { amount: 1001, reason: 'x', requestId: crypto.randomUUID() });
    assert.equal(over.status, 400);
    assert.equal((await over.json()).details.reason, 'ADJUST_OVER_LIMIT');

    const neg = await adm('POST', `/admin/users/${u.id}/adjust`, { amount: -200, reason: 'thu hồi', requestId: crypto.randomUUID() });
    assert.equal(neg.status, 200);
    assert.equal(await bal(u.id), 300);

    const short = await adm('POST', `/admin/users/${u.id}/adjust`, { amount: -400, reason: 'x', requestId: crypto.randomUUID() });
    assert.equal(short.status, 400);
    assert.equal((await short.json()).details.reason, 'ADJUST_INSUFFICIENT_BALANCE');
    assert.equal(await bal(u.id), 300);
    assert.equal((await adjustRows(u.id)).length, 2);

    assert.equal((await adm('POST', `/admin/users/${u.id}/adjust`, { amount: 5, requestId: crypto.randomUUID() })).status, 400);
    const aud = await pool.query(`SELECT * FROM admin_audit WHERE request_id=$1`, [rid]);
    assert.equal(aud.rows.length, 1);
    assert.equal(aud.rows[0].before_after.before.balance, 0);
    assert.equal(aud.rows[0].before_after.after.balance, 500);

    const lg = await adm('GET', `/admin/users/${u.id}/ledger?pageSize=10`);
    assert.equal(lg.status, 200);
    assert.equal((await lg.json()).items.length, 2);
  });

  it('adjust đồng thời cùng requestId chỉ ghi một bút toán', async () => {
    const u = await mkUser();
    const rid = crypto.randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => adm('POST', `/admin/users/${u.id}/adjust`, { amount: 100, reason: 'đồng thời', requestId: rid })),
    );
    const bodies = [];
    for (const r of rs) { assert.equal(r.status, 200); bodies.push(await r.json()); }
    for (const b of bodies) assert.deepEqual(b, bodies[0]);
    assert.equal((await adjustRows(u.id)).length, 1);
    assert.equal(await bal(u.id), 100);
  });

  it('requestId tái dùng với amount/user khác: 400 VALIDATION_FAILED, không bút toán thứ hai', async () => {
    const u = await mkUser();
    const u2 = await mkUser();
    const rid = crypto.randomUUID();
    const body = { amount: 100, reason: 'bù', requestId: rid };
    assert.equal((await adm('POST', `/admin/users/${u.id}/adjust`, body)).status, 200);
    const diffAmount = await adm('POST', `/admin/users/${u.id}/adjust`, { ...body, amount: 200 });
    assert.equal(diffAmount.status, 400);
    assert.equal(await errCode(diffAmount), ApiErrorCode.VALIDATION_FAILED);
    const diffUser = await adm('POST', `/admin/users/${u2.id}/adjust`, body);
    assert.equal(diffUser.status, 400);
    assert.equal(await errCode(diffUser), ApiErrorCode.VALIDATION_FAILED);
    assert.equal((await adjustRows(u.id)).length, 1);
    assert.equal((await adjustRows(u2.id)).length, 0);
  });

  it('6 lần trừ đồng thời cùng requestId khi balance = số trừ: cùng kết quả, một bút toán', async () => {
    const u = await mkUser('user', 100);
    const before = (await adjustRows(u.id)).length;
    const rid = crypto.randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => adm('POST', `/admin/users/${u.id}/adjust`, { amount: -100, reason: 'trừ', requestId: rid })),
    );
    const bodies = [];
    for (const r of rs) { assert.equal(r.status, 200); bodies.push(await r.json()); }
    for (const b of bodies) assert.deepEqual(b, bodies[0]);
    assert.equal((await adjustRows(u.id)).length, before + 1);
    assert.equal(await bal(u.id), 0);
  });

  it('khóa lần hai giữ lockedAt gốc; user không tồn tại: 404 và không audit', async () => {
    const u = await mkUser();
    const first = await (await adm('POST', `/admin/users/${u.id}/lock`, { reason: 'a' })).json();
    const second = await (await adm('POST', `/admin/users/${u.id}/lock`, { reason: 'b' })).json();
    assert.equal(second.lockedAt, first.lockedAt);
    const ghost = crypto.randomUUID();
    for (const [path, body] of [
      ['lock', { reason: 'x' }],
      ['unlock', { reason: 'x' }],
      ['adjust', { amount: 5, reason: 'x', requestId: crypto.randomUUID() }],
    ]) {
      const r = await adm('POST', `/admin/users/${ghost}/${path}`, body);
      assert.equal(r.status, 404);
      assert.equal(await errCode(r), ApiErrorCode.NOT_FOUND);
    }
    assert.equal((await pool.query('SELECT 1 FROM admin_audit WHERE target=$1', [`user:${ghost}`])).rows.length, 0);
  });

  it('không có route sửa/xóa admin_audit', async () => {
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal((await adm(m, '/admin/audit', {})).status, 404);
    }
  });
});
