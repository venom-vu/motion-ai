import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AdminTopupListResponseSchema, AdminTopupSchema, ApiErrorCode } from '@motion-ai/contracts';
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
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d', '--wait', ...services], { cwd: repoRoot, stdio: 'inherit' });
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit',
  });
}

describe('Story 3.5: [BE] Duyệt và từ chối đơn, nhật ký Admin', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  let admin;
  let seq = 0;

  async function mkUser(role = 'user') {
    const n = userIds.length;
    const u = await prisma.user.create({
      data: { googleId: `at-${runId}-${n}`, email: `at-${runId}-${n}@motionai.vn`, tosVersion: 'tos-v7', role },
    });
    userIds.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role }) };
  }
  async function mkTopup(user, { status = 'pending', pack = 'pro', approveBy = new Date(Date.now() + 3600e3) } = {}) {
    const id = crypto.randomUUID();
    const amount = { starter: 49000, pro: 99000, creator: 199000 }[pack];
    await pool.query(
      `INSERT INTO topups (id,user_id,code,pack,amount_vnd,status,qr_expires_at,approve_by,tos_version,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,'t',now())`,
      [id, user.id, `A${runId}${seq++}`.slice(0, 12), pack, amount, status, status === 'awaiting_transfer' ? null : approveBy],
    );
    return id;
  }
  const call = (who, method, url, body) =>
    fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const adm = (method, url, body) => call(admin, method, url, body);
  const ref = () => `bk-${runId}-${seq++}`;
  const audits = async (id) =>
    (await pool.query('SELECT * FROM admin_audit WHERE target = $1 ORDER BY at', [`topup:${id}`])).rows;
  const ledger = async (uid) =>
    (await pool.query(`SELECT * FROM ledger_entries WHERE user_id = $1 AND type = 'TOPUP'`, [uid])).rows;
  const errCode = async (res) => (await res.json()).code;

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.TOPUP_BANK_BIN = '970422';
    process.env.TOPUP_BANK_ACCOUNT_NO = '0123456789';
    process.env.TOPUP_BANK_ACCOUNT_NAME = 'CONG TY MOTION AI';
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
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('quyền: không token 401, user thường 403', async () => {
    const u = await mkUser();
    const id = await mkTopup(u);
    assert.equal((await call(null, 'GET', '/admin/topups')).status, 401);
    assert.equal((await call(null, 'POST', `/admin/topups/${id}/approve`, { bankRef: 'x' })).status, 401);
    assert.equal((await call(u, 'GET', '/admin/topups')).status, 403);
    assert.equal((await call(u, 'POST', `/admin/topups/${id}/approve`, { bankRef: 'x' })).status, 403);
  });

  it('duyệt thường: cộng credit, Tier, GET /me, một dòng audit, đơn trả đúng schema', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { pack: 'pro' });
    const bankRef = ref();
    const res = await adm('POST', `/admin/topups/${id}/approve`, { bankRef });
    assert.equal(res.status, 200);
    const body = await res.json();
    AdminTopupSchema.parse(body);
    assert.equal(body.status, 'approved');
    assert.equal(body.bankRef, bankRef);
    const me = await (await call(u, 'GET', '/me')).json();
    assert.equal(me.balance, 12000);
    assert.equal(me.tier, 'Pro');
    const rows = await audits(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'topup.approve');
    assert.equal(rows[0].admin_id, admin.id);
    assert.equal(rows[0].before_after.before.status, 'pending');
    assert.equal((await ledger(u.id)).length, 1);
    // Trạng thái cuối
    assert.equal(await errCode(await adm('POST', `/admin/topups/${id}/approve`, { bankRef: ref() })), ApiErrorCode.TOPUP_STATE_INVALID);
    assert.equal(await errCode(await adm('POST', `/admin/topups/${id}/reject`, { rejectReason: 'x' })), ApiErrorCode.TOPUP_STATE_INVALID);
  });

  it('gói Creator: Priority 1 ngay', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { pack: 'creator' });
    assert.equal((await adm('POST', `/admin/topups/${id}/approve`, { bankRef: ref() })).status, 200);
    const me = await (await call(u, 'GET', '/me')).json();
    assert.equal(me.balance, 30000);
    assert.equal(me.tier, 'Creator');
    const snap = await pool.query('SELECT tier_pack FROM users WHERE id=$1', [u.id]);
    assert.equal(snap.rows[0].tier_pack, 'creator');
  });

  it('thiếu hoặc blank bank_ref: 400, không đổi gì', async () => {
    const u = await mkUser();
    const id = await mkTopup(u);
    for (const b of [{}, { bankRef: '   ' }, undefined]) {
      const res = await adm('POST', `/admin/topups/${id}/approve`, b);
      assert.equal(res.status, 400);
      assert.equal(await errCode(res), ApiErrorCode.VALIDATION_FAILED);
    }
    assert.equal((await pool.query('SELECT status FROM topups WHERE id=$1', [id])).rows[0].status, 'pending');
    assert.equal((await audits(id)).length, 0);
  });

  it('id không hợp lệ hoặc không tồn tại: 404 NOT_FOUND', async () => {
    assert.equal((await adm('POST', '/admin/topups/not-a-uuid/approve', { bankRef: 'x' })).status, 404);
    const res = await adm('POST', `/admin/topups/${crypto.randomUUID()}/approve`, { bankRef: ref() });
    assert.equal(res.status, 404);
    assert.equal(await errCode(res), ApiErrorCode.NOT_FOUND);
  });

  it('bank_ref trùng: 409, rollback hoàn toàn, không audit', async () => {
    const u = await mkUser();
    const a = await mkTopup(u);
    const b = await mkTopup(u);
    const bankRef = ref();
    assert.equal((await adm('POST', `/admin/topups/${a}/approve`, { bankRef })).status, 200);
    const res = await adm('POST', `/admin/topups/${b}/approve`, { bankRef });
    assert.equal(res.status, 409);
    assert.equal(await errCode(res), ApiErrorCode.BANK_REF_DUPLICATE);
    assert.equal((await pool.query('SELECT status FROM topups WHERE id=$1', [b])).rows[0].status, 'pending');
    assert.equal((await audits(b)).length, 0);
    assert.equal((await ledger(u.id)).length, 1);
    const bal = (await pool.query('SELECT balance FROM users WHERE id=$1', [u.id])).rows[0].balance;
    assert.equal(Number(bal), 12000);
  });

  it('duyệt song song 5 request: đúng một lần cộng', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { pack: 'starter' });
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => adm('POST', `/admin/topups/${id}/approve`, { bankRef: ref() })),
    );
    const statuses = rs.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409]);
    for (const r of rs.filter((x) => x.status === 409)) {
      assert.equal(await errCode(r), ApiErrorCode.TOPUP_STATE_INVALID);
    }
    assert.equal((await ledger(u.id)).length, 1);
    assert.equal(Number((await pool.query('SELECT balance FROM users WHERE id=$1', [u.id])).rows[0].balance), 5000);
    assert.equal((await audits(id)).length, 1);
  });

  it('đơn expired: approve thường 409, approve-expired thành công với audit riêng', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { status: 'expired' });
    assert.equal(await errCode(await adm('POST', `/admin/topups/${id}/approve`, { bankRef: ref() })), ApiErrorCode.TOPUP_STATE_INVALID);
    const res = await adm('POST', `/admin/topups/${id}/approve-expired`, { bankRef: ref() });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'approved');
    const rows = await audits(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'topup.approve_expired');
    // approve-expired với đơn pending sai nguồn
    const p = await mkTopup(u);
    assert.equal(await errCode(await adm('POST', `/admin/topups/${p}/approve-expired`, { bankRef: ref() })), ApiErrorCode.TOPUP_STATE_INVALID);
  });

  it('duyệt đơn needs_review: 200, một bút toán TOPUP, một audit topup.approve', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { status: 'needs_review' });
    const res = await adm('POST', `/admin/topups/${id}/approve`, { bankRef: ref() });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'approved');
    assert.equal((await ledger(u.id)).length, 1);
    const rows = await audits(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'topup.approve');
    assert.equal(rows[0].before_after.before.status, 'needs_review');
  });

  it('từ chối đơn expired: 409 TOPUP_STATE_INVALID, giữ nguyên, không audit', async () => {
    const u = await mkUser();
    const id = await mkTopup(u, { status: 'expired' });
    const res = await adm('POST', `/admin/topups/${id}/reject`, { rejectReason: 'x' });
    assert.equal(res.status, 409);
    assert.equal(await errCode(res), ApiErrorCode.TOPUP_STATE_INVALID);
    assert.equal((await pool.query('SELECT status FROM topups WHERE id=$1', [id])).rows[0].status, 'expired');
    assert.equal((await audits(id)).length, 0);
  });

  it('từ chối: lưu lý do, audit; thiếu lý do 400', async () => {
    const u = await mkUser();
    const id = await mkTopup(u);
    assert.equal((await adm('POST', `/admin/topups/${id}/reject`, {})).status, 400);
    const res = await adm('POST', `/admin/topups/${id}/reject`, { rejectReason: 'Không thấy tiền' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'rejected');
    assert.equal(body.rejectReason, 'Không thấy tiền');
    const rows = await audits(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'topup.reject');
    assert.equal((await ledger(u.id)).length, 0);
  });

  it('needs-review và return-to-pending', async () => {
    const u = await mkUser();
    const id = await mkTopup(u);
    assert.equal(await errCode(await adm('POST', `/admin/topups/${id}/return-to-pending`, {})), ApiErrorCode.TOPUP_STATE_INVALID);
    assert.equal((await adm('POST', `/admin/topups/${id}/needs-review`, {})).status, 400);
    const r1 = await adm('POST', `/admin/topups/${id}/needs-review`, { note: 'Sai nội dung' });
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.status, 'needs_review');
    assert.equal(b1.note, 'Sai nội dung');
    assert.equal(await errCode(await adm('POST', `/admin/topups/${id}/needs-review`, { note: 'again' })), ApiErrorCode.TOPUP_STATE_INVALID);
    const r2 = await adm('POST', `/admin/topups/${id}/return-to-pending`);
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.status, 'pending');
    assert.equal(b2.note, null);
    assert.ok(b2.approveBy);
    assert.deepEqual((await audits(id)).map((a) => a.action), ['topup.needs_review', 'topup.return_to_pending']);
    // needs_review có thể từ chối
    await adm('POST', `/admin/topups/${id}/needs-review`, { note: 'n' });
    assert.equal((await adm('POST', `/admin/topups/${id}/reject`, { rejectReason: 'r' })).status, 200);
  });

  it('danh sách: lọc, isOverdue, phân trang, cursor sai', async () => {
    const u = await mkUser();
    const overdue = await mkTopup(u, { approveBy: new Date(Date.now() - 3600e3) });
    const fresh = await mkTopup(u);
    const res = await adm('GET', '/admin/topups?status=pending&pageSize=1');
    assert.equal(res.status, 200);
    const page = AdminTopupListResponseSchema.parse(await res.json());
    assert.equal(page.items.length, 1);
    assert.equal(page.hasMore, true);
    assert.ok(!JSON.stringify(page).includes('@motionai.vn'));
    const all = [];
    let cursor;
    do {
      const r = AdminTopupListResponseSchema.parse(
        await (await adm('GET', `/admin/topups?status=pending&pageSize=2${cursor ? `&cursor=${cursor}` : ''}`)).json(),
      );
      all.push(...r.items);
      cursor = r.nextCursor ?? undefined;
    } while (cursor);
    const byId = Object.fromEntries(all.map((t) => [t.id, t]));
    assert.equal(byId[overdue].isOverdue, true);
    assert.equal(byId[fresh].isOverdue, false);
    assert.ok(all.every((t) => t.status === 'pending'));
    assert.equal(await errCode(await adm('GET', '/admin/topups?cursor=abc')), ApiErrorCode.VALIDATION_FAILED);
    assert.equal((await adm('GET', '/admin/topups?status=bogus')).status, 400);
  });

  it('reconcile không lệch sổ cái cho các user test', async () => {
    const r = await pool.query(
      `SELECT u.id FROM users u LEFT JOIN ledger_entries l ON l.user_id = u.id
       WHERE u.id = ANY($1::uuid[]) GROUP BY u.id, u.balance HAVING u.balance <> COALESCE(SUM(l.amount),0)`,
      [userIds],
    );
    assert.equal(r.rows.length, 0);
  });
});
