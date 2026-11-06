import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { ShareService, hashShareToken } from '../dist/modules/storage/share.service.js';

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




describe('Story 2.9: [BE] Chia sẻ kết quả bằng token', () => {
  let app, baseUrl, pool, prisma, jwt, share;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const store = new Set();
  const fakeStorage = {
    async head(key) { return store.has(key) ? { sizeBytes: 1, etag: '"e"' } : null; },
    async presignGet(key, ttl) { return `https://r2.example.test/${key}?X-Amz-Expires=${ttl}`; },
  };

  async function newUser() {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `h-${runId}-${n}`, email: `h-${runId}-${n}@motionai.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  /** Task succeeded dựng thẳng bằng SQL (cổng tạo Task/worker đã có test riêng). */
  async function succeededTask(user, status = 'succeeded') {
    const id = crypto.randomUUID();
    const key = status === 'succeeded' ? `out/${user.id}/${crypto.randomUUID()}` : null;
    await pool.query(
      `INSERT INTO tasks (id, user_id, pipeline, status, reason_code, result_key, tier_snapshot, consent, tos_version, input_keys, hold_amount)
       VALUES ($1,$2,'face_swap',$3,$4,$5,'{"tier":"FREE","priority":10,"maxVideoSeconds":5}',true,'tos-v7','{}',100)`,
      [id, user.id, status, status === 'succeeded' ? null : status === 'queued' ? null : 'RH_ERROR', key],
    );
    if (key) store.add(key);
    return { id, key };
  }
  const call = (method, p, user, opts = {}) =>
    fetch(`${baseUrl}${p}`, { method, redirect: 'manual', headers: user ? { Authorization: `Bearer ${user.token}` } : {}, ...opts });

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
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    share = app.get(ShareService);
    share.storage = fakeStorage;
  });

  after(async () => {
    if (prisma) {
      await pool.query('DELETE FROM share_tokens WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('Chưa chia sẻ: GET /s/<token> bất kỳ trả 404', async () => {
    const res = await call('GET', `/s/${crypto.randomBytes(32).toString('base64url')}`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'NOT_FOUND');
  });

  it('Chủ tạo token: chỉ lưu hash, shareUrl đúng, GET /s/<token> chuyển hướng 302 tới URL ký của out/', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const res = await call('POST', `/tasks/${t.id}/share`, u);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.shareUrl, `https://api.example.test/s/${body.token}`);
    const { rows } = await pool.query('SELECT * FROM share_tokens WHERE task_id=$1', [t.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hashShareToken(body.token));
    assert.notEqual(rows[0].token_hash, body.token);
    assert.equal(rows[0].revoked_at, null);
    const open = await call('GET', `/s/${body.token}`);
    assert.equal(open.status, 302);
    assert.equal(open.headers.get('location'), `https://r2.example.test/${t.key}?X-Amz-Expires=300`);
    assert.ok(!open.headers.get('location').includes('runninghub'));
  });

  it('Tạo lại token: token cũ bị thu hồi, chỉ token mới mở được', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const a = await (await call('POST', `/tasks/${t.id}/share`, u)).json();
    const b = await (await call('POST', `/tasks/${t.id}/share`, u)).json();
    assert.equal((await call('GET', `/s/${a.token}`)).status, 404);
    assert.equal((await call('GET', `/s/${b.token}`)).status, 302);
  });

  it('Thu hồi: DELETE đánh dấu revoked_at và GET /s/<token> trả 404', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const { token } = await (await call('POST', `/tasks/${t.id}/share`, u)).json();
    const del = await call('DELETE', `/tasks/${t.id}/share`, u);
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { revoked: true });
    const { rows } = await pool.query('SELECT revoked_at FROM share_tokens WHERE task_id=$1', [t.id]);
    assert.ok(rows[0].revoked_at);
    const res = await call('GET', `/s/${token}`);
    assert.equal(res.status, 404);
    assert.equal(JSON.stringify(await res.json()).includes(t.id), false);
  });

  it('File out/ đã bị xóa: 404, không tiết lộ Task', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const { token } = await (await call('POST', `/tasks/${t.id}/share`, u)).json();
    store.delete(t.key);
    const res = await call('GET', `/s/${token}`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'NOT_FOUND');
  });

  it('Người khác chủ Task: tạo và thu hồi bị từ chối (404), không có token', async () => {
    const u = await newUser();
    const other = await newUser();
    const t = await succeededTask(u);
    assert.equal((await call('POST', `/tasks/${t.id}/share`, other)).status, 404);
    assert.equal((await call('DELETE', `/tasks/${t.id}/share`, other)).status, 404);
    const { rows } = await pool.query('SELECT 1 FROM share_tokens WHERE task_id=$1', [t.id]);
    assert.equal(rows.length, 0);
  });

  it('Chưa đăng nhập: tạo/thu hồi trả 401', async () => {
    const t = await succeededTask(await newUser());
    assert.equal((await call('POST', `/tasks/${t.id}/share`)).status, 401);
    assert.equal((await call('DELETE', `/tasks/${t.id}/share`)).status, 401);
  });

  for (const status of ['queued', 'failed']) {
    it(`Task ${status} không chia sẻ được: 409 CONFLICT`, async () => {
      const u = await newUser();
      const t = await succeededTask(u, status);
      const res = await call('POST', `/tasks/${t.id}/share`, u);
      assert.equal(res.status, 409);
      const { rows } = await pool.query('SELECT 1 FROM share_tokens WHERE task_id=$1', [t.id]);
      assert.equal(rows.length, 0);
    });
  }

  it('Chỉ mục duy nhất một phần: không thể có hai token đang hiệu lực cho một Task', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    await call('POST', `/tasks/${t.id}/share`, u);
    await assert.rejects(
      pool.query(`INSERT INTO share_tokens (id, task_id, user_id, token_hash) VALUES (gen_random_uuid(), $1, $2, 'dup-${runId}')`, [t.id, u.id]),
      /share_tokens_task_active_key/,
    );
  });

  it('Hai POST /share song song cho cùng Task: không có 500, đúng một token hiệu lực', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const rs = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/tasks/${t.id}/share`, u)));
    assert.deepEqual(rs.map((r) => r.status), [201, 201, 201, 201]);
    const { rows } = await pool.query('SELECT 1 FROM share_tokens WHERE task_id=$1 AND revoked_at IS NULL', [t.id]);
    assert.equal(rows.length, 1);
  });

  it('302 có Cache-Control: no-store và Referrer-Policy: no-referrer', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const { token } = await (await call('POST', `/tasks/${t.id}/share`, u)).json();
    const res = await call('GET', `/s/${token}`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('API_PUBLIC_URL trống ở production: không dựng link localhost', async () => {
    const u = await newUser();
    const t = await succeededTask(u);
    const saved = [process.env.API_PUBLIC_URL, process.env.NODE_ENV];
    process.env.API_PUBLIC_URL = '';
    process.env.NODE_ENV = 'production';
    try {
      const res = await call('POST', `/tasks/${t.id}/share`, u);
      assert.equal(res.status, 500);
    } finally {
      [process.env.API_PUBLIC_URL, process.env.NODE_ENV] = saved;
    }
    const { rows } = await pool.query('SELECT 1 FROM share_tokens WHERE task_id=$1', [t.id]);
    assert.equal(rows.length, 0);
  });

  it('Token sai định dạng: 404 (không chạm CSDL)', async () => {
    assert.equal((await call('GET', '/s/abc')).status, 404);
  });

  it('GET /s/<token> bị gọi quá nhiều: 429 RATE_LIMITED', async () => {
    const limit = 5;
    await app.close();
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.SHARE_THROTTLE_LIMIT = String(limit);
    process.env.SHARE_THROTTLE_TTL_MS = '60000';
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    app.get(ShareService).storage = fakeStorage;
    const fakeIp = `203.0.113.${(Date.now() % 200) + 10}`;
    let last;
    for (let i = 0; i <= limit; i++) {
      last = await fetch(`${baseUrl}/s/${crypto.randomBytes(32).toString('base64url')}`, { headers: { 'x-forwarded-for': fakeIp, 'cf-connecting-ip': fakeIp } });
    }
    assert.equal(last.status, 429);
    assert.equal((await last.json()).code, 'RATE_LIMITED');
  });
});
