import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AdminTaskLookupResponseSchema, ApiErrorCode, CONTENT_REMOVED_MESSAGE_VI } from '@flowvis/contracts';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { ShareService } from '../dist/modules/storage/share.service.js';
import { TasksService } from '../dist/modules/tasks/tasks.service.js';
import { AdminTasksService } from '../dist/modules/admin-tasks/admin-tasks.service.js';

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

describe('Story 6.5: [BE] Gỡ bỏ nội dung khẩn cấp', () => {
  let app, baseUrl, pool, prisma, jwt, share;
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  const store = new Set();
  const events = [];
  let failDeleteOnce = null;
  const fakeStorage = {
    async head(key) { return store.has(key) ? { sizeBytes: 1, etag: '"e"' } : null; },
    async presignGet(key, ttl) { return `https://r2.example.test/${key}?X-Amz-Expires=${ttl}`; },
    async delete(key) {
      if (failDeleteOnce && key === failDeleteOnce) { failDeleteOnce = null; throw new Error('R2 down'); }
      const rev = (await pool.query(`SELECT count(*)::int AS n FROM share_tokens WHERE revoked_at IS NULL AND task_id = ANY($1::uuid[])`, [events.activeTasks ?? []])).rows[0].n;
      events.push({ key, unrevoked: rev });
      store.delete(key);
    },
  };
  let admin;

  async function mkUser(role = 'user') {
    const n = userIds.length;
    const u = await prisma.user.create({ data: { googleId: `at-${runId}-${n}`, email: `at-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', role } });
    userIds.push(u.id);
    return { id: u.id, email: u.email, token: jwt.sign({ sub: u.id, email: u.email, role }) };
  }
  async function mkTask(user, status = 'succeeded', video = false) {
    const id = crypto.randomUUID();
    const base = `${user.id}/${crypto.randomUUID()}`;
    const resultKey = status === 'succeeded' ? `out/${base}${video ? '.mp4' : ''}` : null;
    const inKey = `in/${base}-a`;
    const inKey2 = `in/${base}-b`;
    const poster = video ? resultKey.replace(/\.mp4$/, '.jpg') : null;
    for (const k of [resultKey, inKey, inKey2, poster]) if (k) store.add(k);
    await pool.query(
      `INSERT INTO tasks (id, user_id, pipeline, status, reason_code, result_key, tier_snapshot, consent, tos_version, input_keys, hold_amount, params)
       VALUES ($1,$2,'face_swap',$3,$4,$5,'{"tier":"FREE","priority":10,"maxVideoSeconds":5}',true,'tos-v7',$6,100,$7)`,
      [id, user.id, status, status === 'failed' ? 'RH_ERROR' : null, resultKey, JSON.stringify({ sourceKey: inKey, targetKey: inKey2 }), JSON.stringify(video ? { seconds: 3 } : {})],
    );
    return { id, resultKey, inKey, inKey2, poster };
  }
  const call = (who, method, url, body) =>
    fetch(`${baseUrl}${url}`, {
      method,
      redirect: 'manual',
      headers: { ...(who ? { Authorization: `Bearer ${who.token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const adm = (method, url, body) => call(admin, method, url, body);
  const errCode = async (res) => (await res.json()).code;
  const ledger = async (uid) => (await pool.query('SELECT count(*)::int n, COALESCE(sum(amount),0)::int s FROM ledger_entries WHERE user_id=$1', [uid])).rows[0];

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.SHARE_THROTTLE_LIMIT = '1000';
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
    share = app.get(ShareService);
    share.storage = fakeStorage;
    app.get(AdminTasksService).storage = fakeStorage;
    app.get(TasksService).storage = fakeStorage;
    admin = await mkUser('admin');
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM admin_audit WHERE admin_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM share_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('quyền: 401, 403, 404, validation', async () => {
    const u = await mkUser();
    const t = await mkTask(u);
    assert.equal((await call(null, 'GET', `/admin/tasks/lookup?taskId=${t.id}`)).status, 401);
    assert.equal((await call(u, 'GET', `/admin/tasks/lookup?taskId=${t.id}`)).status, 403);
    assert.equal((await call(u, 'POST', `/admin/tasks/${t.id}/takedown`, { reason: 'x' })).status, 403);
    assert.equal((await call(null, 'POST', `/admin/tasks/${t.id}/takedown`, { reason: 'x' })).status, 401);
    const nf = await adm('GET', `/admin/tasks/lookup?taskId=${crypto.randomUUID()}`);
    assert.equal(nf.status, 404);
    assert.equal(await errCode(nf), ApiErrorCode.NOT_FOUND);
    assert.equal((await adm('POST', `/admin/tasks/${crypto.randomUUID()}/takedown`, { reason: 'x' })).status, 404);
    const bad = await adm('GET', '/admin/tasks/lookup');
    assert.equal(bad.status, 400);
    assert.equal(await errCode(bad), ApiErrorCode.VALIDATION_FAILED);
    const noReason = await adm('POST', `/admin/tasks/${t.id}/takedown`, {});
    assert.equal(noReason.status, 400);
    assert.equal((await noReason.json()).details.reason, 'REASON_REQUIRED');
  });

  it('lookup theo taskId và shareUrl (kể cả token đã thu hồi)', async () => {
    const u = await mkUser();
    const t = await mkTask(u);
    const r = await adm('GET', `/admin/tasks/lookup?taskId=${t.id}`);
    assert.equal(r.status, 200);
    const body = AdminTaskLookupResponseSchema.parse(await r.json());
    assert.equal(body.userEmail, u.email);
    assert.equal(body.filesRemovedAt, null);

    const created = await (await call(u, 'POST', `/tasks/${t.id}/share`)).json();
    const byUrl = await adm('GET', `/admin/tasks/lookup?shareUrl=${encodeURIComponent(created.shareUrl)}`);
    assert.equal(byUrl.status, 200);
    assert.equal((await byUrl.json()).id, t.id);
    await call(u, 'DELETE', `/tasks/${t.id}/share`);
    assert.equal((await adm('GET', `/admin/tasks/lookup?shareUrl=${encodeURIComponent(created.shareUrl)}`)).status, 200);

    const stranger = `https://api.example.test/s/${crypto.randomBytes(32).toString('base64url')}`;
    assert.equal((await adm('GET', `/admin/tasks/lookup?shareUrl=${encodeURIComponent(stranger)}`)).status, 404);
    assert.equal((await adm('GET', `/admin/tasks/lookup?shareUrl=${encodeURIComponent('https://api.example.test/s/short')}`)).status, 404);
  });

  it('Task đang chạy: TASK_NOT_FINISHED, không đổi gì', async () => {
    const u = await mkUser();
    const t = await mkTask(u, 'queued');
    const r = await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'dmca' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).details.reason, 'TASK_NOT_FINISHED');
    assert.ok(store.has(t.inKey));
    const row = (await pool.query('SELECT files_removed_at FROM tasks WHERE id=$1', [t.id])).rows[0];
    assert.equal(row.files_removed_at, null);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM admin_audit WHERE target=$1`, [`task:${t.id}`])).rows[0].n, 0);
  });

  it('takedown: thu hồi token trước, xóa R2, đặt cột, audit, 404/409 sau đó, sổ cái không đổi, gọi lại idempotent', async () => {
    const u = await mkUser();
    const t = await mkTask(u, 'succeeded', true);
    const created = await (await call(u, 'POST', `/tasks/${t.id}/share`)).json();
    const token = created.token;
    assert.equal((await call(null, 'GET', `/s/${token}/info`)).status, 200);
    const before = await ledger(u.id);
    events.length = 0;
    events.activeTasks = [t.id];

    const r = await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'DMCA #1' });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.taskId, t.id);
    assert.ok(events.length >= 4 && events.every((e) => e.unrevoked === 0), 'token phải thu hồi trước khi xóa');
    for (const k of [t.resultKey, t.poster, t.inKey, t.inKey2]) assert.ok(!store.has(k), k);

    const audit = (await pool.query(`SELECT * FROM admin_audit WHERE target=$1`, [`task:${t.id}`])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'task.takedown');
    assert.equal(audit[0].before_after.reason, 'DMCA #1');
    assert.equal(audit[0].before_after.deletedObjects, 4);
    assert.deepEqual(await ledger(u.id), before);
    const row = (await pool.query('SELECT status, reason_code FROM tasks WHERE id=$1', [t.id])).rows[0];
    assert.equal(row.status, 'succeeded');

    for (const suffix of ['', '/info', '/poster']) {
      const s = await call(null, 'GET', `/s/${token}${suffix}`);
      assert.equal(s.status, 404, suffix);
    }
    const own = await call(u, 'GET', `/tasks/${t.id}`);
    assert.equal((await own.json()).filesRemovedAt, out.filesRemovedAt);
    const res = await call(u, 'GET', `/tasks/${t.id}/result`);
    assert.equal(res.status, 409);
    const rb = await res.json();
    assert.equal(rb.code, ApiErrorCode.CONFLICT);
    assert.equal(rb.message, CONTENT_REMOVED_MESSAGE_VI);
    const list = await (await call(u, 'GET', '/tasks')).json();
    assert.equal(list.items.find((x) => x.id === t.id).filesRemovedAt, out.filesRemovedAt);

    const again = await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'again' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).filesRemovedAt, out.filesRemovedAt);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM admin_audit WHERE target=$1`, [`task:${t.id}`])).rows[0].n, 1);
    const lk = await (await adm('GET', `/admin/tasks/lookup?taskId=${t.id}`)).json();
    assert.equal(lk.filesRemovedAt, out.filesRemovedAt);
  });

  it('lỗi R2 một phần: không đặt cột, không audit; thử lại hoàn tất', async () => {
    const u = await mkUser();
    const t = await mkTask(u, 'failed');
    events.activeTasks = [t.id];
    failDeleteOnce = t.inKey2;
    const r = await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'privacy' });
    assert.ok(r.status >= 500);
    const row = (await pool.query('SELECT files_removed_at FROM tasks WHERE id=$1', [t.id])).rows[0];
    assert.equal(row.files_removed_at, null);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM admin_audit WHERE target=$1`, [`task:${t.id}`])).rows[0].n, 0);
    const r2 = await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'privacy' });
    assert.equal(r2.status, 200);
    assert.ok(!store.has(t.inKey) && !store.has(t.inKey2));
    assert.equal((await pool.query(`SELECT count(*)::int n FROM admin_audit WHERE target=$1`, [`task:${t.id}`])).rows[0].n, 1);
  });

  it('sau takedown chủ không tạo được token chia sẻ mới (409)', async () => {
    const u = await mkUser();
    const t = await mkTask(u);
    assert.equal((await adm('POST', `/admin/tasks/${t.id}/takedown`, { reason: 'dmca' })).status, 200);
    const r = await call(u, 'POST', `/tasks/${t.id}/share`);
    assert.equal(r.status, 409);
    assert.equal(await errCode(r), ApiErrorCode.CONFLICT);
    assert.equal((await pool.query('SELECT count(*)::int n FROM share_tokens WHERE task_id=$1', [t.id])).rows[0].n, 0);
  });

  it('lookup chặn Task có files_removed_at dù token chưa thu hồi và R2 còn đối tượng', async () => {
    const u = await mkUser();
    const t = await mkTask(u);
    const { token } = await (await call(u, 'POST', `/tasks/${t.id}/share`)).json();
    assert.equal((await call(null, 'GET', `/s/${token}`)).status, 302);
    await pool.query('UPDATE tasks SET files_removed_at = now() WHERE id=$1', [t.id]);
    assert.ok(store.has(t.resultKey));
    assert.equal((await pool.query('SELECT count(*)::int n FROM share_tokens WHERE task_id=$1 AND revoked_at IS NULL', [t.id])).rows[0].n, 1);
    for (const suffix of ['', '/info', '/poster']) {
      assert.equal((await call(null, 'GET', `/s/${token}${suffix}`)).status, 404, suffix);
    }
  });
});
