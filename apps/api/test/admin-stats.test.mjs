import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AdminAuditResponseSchema, AdminStatsResponseSchema, ApiErrorCode } from '@flowvis/contracts';
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


describe('Story 6.6: [BE] Thống kê vận hành và nhật ký Admin', () => {
  let app, baseUrl, pool, prisma, jwt, admin;
  const runId = crypto.randomBytes(4).toString('hex');
  const userIds = [];
  const auditIds = [];
  const FROM = '2030-01-01T00:00:00.000Z';
  const TO = '2030-01-31T00:00:00.000Z';
  const at = '2030-01-10T00:00:00.000Z';

  async function mkUser(role = 'user', createdAt = at) {
    const n = userIds.length;
    const u = await prisma.user.create({
      data: { googleId: `st-${runId}-${n}`, email: `st-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7', role, createdAt: new Date(createdAt) },
    });
    userIds.push(u.id);
    return { id: u.id, email: u.email, token: jwt.sign({ sub: u.id, email: u.email, role }) };
  }
  const call = (who, url) =>
    fetch(`${baseUrl}${url}`, { headers: who ? { Authorization: `Bearer ${who.token}` } : {} });
  const snap = JSON.stringify({ tier: 'FREE', priority: 10, maxVideoSeconds: 5, priceVnd: 0, credits: 500 });
  async function mkTask(uid, pipeline, status, { reason = null, gpu = null, secs = null, proc = null, created = at } = {}) {
    const params = secs ? { seconds: secs } : {};
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,result_key,reason_code,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,gpu_coins,created_at,running_at,finished_at)
       VALUES (gen_random_uuid(),$1,$2,$3,CASE WHEN $3='succeeded' THEN 'out/x' END,$4,$5::jsonb,true,'tos-v7','[]'::jsonb,$6::jsonb,100,$7,$8::timestamptz,
         CASE WHEN $9::int IS NULL THEN NULL ELSE $8::timestamptz END,
         CASE WHEN $9::int IS NULL THEN NULL ELSE $8::timestamptz + ($9::int * interval '1 second') END)`,
      [uid, pipeline, status, reason, snap, JSON.stringify(params), gpu, created, proc],
    );
  }
  async function mkTopup(uid, code, updated) {
    await pool.query(
      `INSERT INTO topups (id,user_id,code,pack,amount_vnd,status,qr_expires_at,tos_version,updated_at)
       VALUES (gen_random_uuid(),$1,$2,'starter',49000,'approved',now(),'tos-v7',$3)`,
      [uid, code, updated],
    );
  }
  const stats = async (qs = '') => {
    const r = await call(admin, `/admin/stats?from=${FROM}&to=${TO}${qs}`);
    assert.equal(r.status, 200);
    return AdminStatsResponseSchema.parse(await r.json());
  };

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    await ensureInfra();
    const rd0 = new Redis(REDIS_URL);
    const stale = await rd0.keys('throttle:*');
    if (stale.length) await rd0.del(...stale);
    rd0.disconnect();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    // Khoảng 2030 chưa có dữ liệu thật; dọn dữ liệu sót của lần chạy trước.
    await pool.query(`DELETE FROM tasks WHERE created_at >= $1 AND created_at <= $2 AND user_id IN (SELECT id FROM users WHERE email LIKE 'st-%@flowvis.vn')`, [FROM, TO]);
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    admin = await mkUser('admin', '2020-01-01T00:00:00.000Z');
  });

  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM admin_audit WHERE admin_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM topups WHERE user_id = ANY($1::uuid[])', [userIds]);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('quyền và tham số sai', async () => {
    const u = await mkUser();
    assert.equal((await call(null, `/admin/stats?from=${FROM}&to=${TO}`)).status, 401);
    assert.equal((await call(u, `/admin/stats?from=${FROM}&to=${TO}`)).status, 403);
    assert.equal((await call(null, '/admin/audit')).status, 401);
    assert.equal((await call(u, '/admin/audit')).status, 403);
    for (const qs of [`from=${TO}&to=${FROM}`, `from=${FROM}&to=${TO}&scope=xx`, 'from=abc&to=def']) {
      const r = await call(admin, `/admin/stats?${qs}`);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).code, ApiErrorCode.VALIDATION_FAILED);
    }
    assert.equal((await call(admin, '/admin/audit?cursor=nope')).status, 400);
  });

  it('khoảng rỗng trả null/0', async () => {
    const r = await call(admin, '/admin/stats?from=2031-01-01T00:00:00.000Z&to=2031-01-02T00:00:00.000Z');
    const j = AdminStatsResponseSchema.parse(await r.json());
    assert.equal(j.pipelines.length, 3);
    for (const p of j.pipelines) {
      assert.deepEqual(Object.values(p.taskCounts), [0, 0, 0, 0, 0, 0]);
      assert.equal(p.successRate, null);
      assert.equal(p.avgProcessingSeconds, null);
      assert.equal(p.p95ProcessingSeconds, null);
      assert.equal(p.avgGpuCoins, null);
      assert.equal(p.avgCostVnd, null);
      assert.equal(p.wastedGpuCoins, 0);
    }
    assert.deepEqual(j.margins, []);
    assert.equal(j.successMetrics.conversionRate, null);
    assert.equal(j.successMetrics.approvedTopups, 0);
  });

  it('số liệu, biên gộp, scope, SM-1', async () => {
    const u = await mkUser();
    const bench = await mkUser();
    process.env.BENCHMARK_USER_EMAILS = ` ${bench.email.toUpperCase()} `;
    await mkTask(u.id, 'face_swap', 'succeeded', { gpu: 180, proc: 10 });
    await mkTask(u.id, 'face_swap', 'succeeded', { gpu: 180, proc: 30 });
    await mkTask(u.id, 'face_swap', 'failed', { reason: 'RH_ERROR', gpu: 90 });
    await mkTask(u.id, 'face_swap', 'failed', { reason: 'NO_FACE', gpu: 20 });
    await mkTask(u.id, 'face_swap', 'cancelled');
    await mkTask(u.id, 'face_swap', 'timed_out', { reason: 'RH_TIMEOUT', gpu: 40 });
    await mkTask(u.id, 'face_swap', 'timed_out', { reason: 'FREE_WAIT_EXPIRED', gpu: 10 });
    await mkTask(u.id, 'motion_control', 'succeeded', { gpu: 900, secs: 5, proc: 60 });
    await mkTask(bench.id, 'face_swap', 'succeeded', { gpu: 360, proc: 5 });
    await mkTopup(u.id, `ST${runId}1`, '2030-01-12T00:00:00Z');
    await mkTopup(bench.id, `ST${runId}B`, '2030-01-13T00:00:00Z');
    // SM-1: tài khoản có Task, không nạp (cohort 1 mẫu); tài khoản không Task nhưng có nạp; nạp sau 30 ngày
    const noTopup = await mkUser();
    await mkTask(noTopup.id, 'face_swap', 'queued');
    const noTask = await mkUser();
    await mkTopup(noTask.id, `ST${runId}2`, '2030-01-12T00:00:00Z');
    const late = await mkUser('user', '2030-01-02T00:00:00.000Z');
    await mkTask(late.id, 'face_swap', 'queued');
    await mkTopup(late.id, `ST${runId}3`, '2030-02-05T00:00:00Z');
    const real = await stats();
    const fs = real.pipelines.find((p) => p.pipeline === 'face_swap');
    assert.equal(fs.taskCounts.succeeded, 2);
    assert.equal(fs.taskCounts.failed, 2);
    assert.equal(fs.taskCounts.cancelled, 1);
    assert.equal(fs.taskCounts.timed_out, 2);
    assert.equal(fs.taskCounts.queued, 2);
    assert.equal(fs.successRate, 2 / 4);
    assert.equal(fs.avgProcessingSeconds, 20);
    assert.equal(fs.p95ProcessingSeconds, 29);
    assert.equal(fs.avgGpuCoins, 180);
    assert.equal(fs.wastedGpuCoins, 160);
    assert.equal(fs.avgCostVnd.retail, (180 / 1800) * 25000);
    assert.equal(fs.avgCostVnd.standardPack, (180 / 3600) * 25000);
    const m = real.margins.find((x) => x.pipeline === 'face_swap' && x.pack === 'starter' && x.scenario === 'retail');
    assert.ok(Math.abs(m.revenueVnd - 980) < 1e-6);
    assert.ok(Math.abs(m.marginVnd - (980 - 2500)) < 1e-6);
    const m80 = (await stats('&imagePrice=80')).margins.find((x) => x.pipeline === 'face_swap' && x.pack === 'starter' && x.scenario === 'retail');
    assert.ok(Math.abs(m80.revenueVnd - 784) < 1e-6);
    const mm = real.margins.find((x) => x.pipeline === 'motion_control' && x.pack === 'pro' && x.scenario === 'standardPack');
    assert.ok(Math.abs(mm.revenueVnd - 825 * 0.5) < 1e-6);
    assert.ok(Math.abs(mm.costVnd - (180 / 3600) * 25000) < 1e-6);
    // approved trong khoảng: u, noTask, late(02-05 ngoài khoảng, loại) => 2; bench bị loại khỏi real
    assert.equal(real.successMetrics.approvedTopups, 2);
    // cohort real có Task: u (nạp 12/01 trong 30 ngày), noTopup, late (nạp sau 30 ngày); noTask không Task => 1/3
    assert.equal(real.successMetrics.conversionRate, 1 / 3);
    assert.ok(Math.abs(real.successMetrics.gpuCostUsd - 1420 / 1800) < 1e-9);

    const b = await stats('&scope=benchmark');
    const bf = b.pipelines.find((p) => p.pipeline === 'face_swap');
    assert.equal(bf.taskCounts.succeeded, 1);
    assert.equal(bf.successRate, 1);
    assert.equal(b.successMetrics.approvedTopups, 1);
    assert.equal(b.successMetrics.conversionRate, 1);
    process.env.BENCHMARK_USER_EMAILS = '';
    const none = await stats('&scope=benchmark');
    assert.ok(none.pipelines.every((p) => Object.values(p.taskCounts).every((n) => n === 0)));
    assert.equal(none.successMetrics.gpuCostUsd, 0);
    assert.equal((await stats()).pipelines.find((p) => p.pipeline === 'face_swap').taskCounts.succeeded, 3);
  });

  it('10.000 Task dưới 2 giây', async () => {
    const u = await mkUser();
    await pool.query(
      `INSERT INTO tasks (id,user_id,pipeline,status,result_key,tier_snapshot,consent,tos_version,input_keys,params,hold_amount,gpu_coins,created_at,running_at,finished_at)
       SELECT gen_random_uuid(),$1,'body_retouch','succeeded','out/x',$2::jsonb,true,'tos-v7','[]'::jsonb,'{}'::jsonb,100,100,
         '2030-01-20T00:00:00Z','2030-01-20T00:00:00Z','2030-01-20T00:00:20Z' FROM generate_series(1,10000)`,
      [u.id, snap],
    );
    const t0 = Date.now();
    const j = await stats();
    assert.ok(Date.now() - t0 < 2000);
    const br = j.pipelines.find((p) => p.pipeline === 'body_retouch');
    assert.equal(br.taskCounts.succeeded, 10000);
    assert.equal(br.avgProcessingSeconds, 20);
  });

  it('nhật ký: mới nhất trước, lọc, phân trang, reason', async () => {
    const target = `user:${runId}`;
    for (let i = 0; i < 3; i++) {
      const id = crypto.randomUUID();
      auditIds.push(id);
      await pool.query(
        `INSERT INTO admin_audit (id,admin_id,action,target,before_after,at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [id, admin.id, i === 2 ? 'other' : 'lock', target, JSON.stringify(i === 0 ? { reason: 'spam' } : { reason: 5 }), `2030-02-0${i + 1}T00:00:00Z`],
      );
    }
    const r = await call(admin, `/admin/audit?target=${encodeURIComponent(target)}&pageSize=2`);
    const j = AdminAuditResponseSchema.parse(await r.json());
    assert.equal(j.items.length, 2);
    assert.equal(j.items[0].action, 'other');
    assert.equal(j.hasMore, true);
    assert.ok(!('beforeAfter' in j.items[0]));
    const r2 = await call(admin, `/admin/audit?target=${encodeURIComponent(target)}&pageSize=2&cursor=${j.nextCursor}`);
    const j2 = AdminAuditResponseSchema.parse(await r2.json());
    assert.equal(j2.items.length, 1);
    assert.equal(j2.items[0].reason, 'spam');
    assert.equal(j2.hasMore, false);
    const f = AdminAuditResponseSchema.parse(await (await call(admin, `/admin/audit?target=${encodeURIComponent(target)}&action=lock`)).json());
    assert.equal(f.items.length, 2);
    assert.equal(f.items[0].reason, null);
  });
});
