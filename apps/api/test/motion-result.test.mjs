import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import { Queue } from 'bullmq';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { WalletService } from '../dist/modules/wallet/index.js';
import { TasksService } from '../dist/modules/tasks/index.js';
import { ShareService } from '../dist/modules/storage/share.service.js';
import { evaluateIngestProbe, ResultIngestorService } from '../dist/modules/tasks/result-ingestor.js';

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
    execFileSync('docker', ['compose', '-f', composePath, 'up', '-d', '--wait', ...services], {
      cwd: repoRoot, stdio: 'inherit',
    });
  }
  execFileSync('pnpm', ['run', 'prisma:migrate:deploy'], {
    cwd: apiRoot, env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit',
  });
}

Queue.prototype.add = async function (name, data, opts) { return { id: opts?.jobId }; };
Queue.prototype.getJob = async function () { return null; };


const OUT_MP4 = /^out\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/;
const RH_URL = 'https://rh.example.test/out/result.mp4';
const TMP_ROOT = path.join(os.tmpdir(), 'flowvis-trim', 'ingest');
const vdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mres-'));

function makeVideo(name, { w = 720, h = 1280, fps = 24, dur = 5.2, codec = 'libx264' } = {}) {
  const f = path.join(vdir, name);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=${fps}`, '-t', String(dur), '-c:v', codec, '-pix_fmt', 'yuv420p', f]);
  return fs.readFileSync(f);
}
const asResponse = (buf, headers = {}) => new Response(buf, { status: 200, headers });
const leftovers = () => (fs.existsSync(TMP_ROOT) ? fs.readdirSync(TMP_ROOT) : []);

describe('Story 5.6: [BE] Nhập kết quả video, ảnh bìa và chia sẻ', () => {
  let app, baseUrl, pool, prisma, jwt, svc, ingestor, share;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];
  const saved = {};
  let store, fetchImpl, failPut;
  let good;

  const fakeStorage = {
    async getObject(key) { const o = store.get(key); if (!o) throw new Error(`NoSuchKey ${key}`); return o.body; },
    async head(key) { const o = store.get(key); return o ? { sizeBytes: o.body.length, etag: '"e"', contentType: o.contentType } : null; },
    async putObject(key, body, contentType) {
      if (failPut?.(key)) throw new Error('R2 down');
      store.set(key, { body, contentType });
      return '"etag"';
    },
    async delete(key) { store.delete(key); },
    async presignGet(key, ttl) { return `https://r2.example.test/${key}?X-Amz-Expires=${ttl}`; },
  };
  const outKeys = () => [...store.keys()].filter((k) => k.startsWith('out/'));

  async function newUser() {
    const n = users.length;
    const u = await prisma.user.create({ data: { googleId: `mres-${runId}-${n}`, email: `mres-${runId}-${n}@flowvis.vn`, tosVersion: 'tos-v7' } });
    users.push(u.id);
    await prisma.$transaction((t) => new WalletService().grant(t, u.id, 5000));
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  async function createTask(user) {
    const mk = async (kind, extra) => {
      const uuid = crypto.randomUUID();
      await prisma.upload.create({ data: { userId: user.id, key: `in-raw/${user.id}/${uuid}`, kind, mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg', declaredBytes: 10, status: 'confirmed', confirmedKey: `in/${user.id}/${uuid}`, ...extra } });
      return `in/${user.id}/${uuid}`;
    };
    const characterKey = await mk('image', {});
    const videoKey = await mk('video', { durationSeconds: 8, confirmedAt: new Date() });
    const res = await fetch(`${baseUrl}/tasks/motion`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ characterKey, videoKey, trimStart: 0, trimEnd: 5 }) });
    assert.equal(res.status, 201);
    return { id: (await res.json()).id, userId: user.id };
  }
  const row = (id) => pool.query('SELECT * FROM tasks WHERE id=$1', [id]).then((r) => r.rows[0]);
  const ledger = (id, type) => prisma.ledgerEntry.findMany({ where: { taskId: id, type } });
  async function runningTask(user) {
    await pool.query(`UPDATE tasks SET status='failed', reason_code='RH_ERROR', finished_at=now(), rh_orphan_until=NULL WHERE user_id = ANY($1::uuid[]) AND status IN ('queued','running')`, [users]);
    process.env.RH_MAX_CONCURRENT = String((await svc.countGateOccupied()) + 2);
    const t = await createTask(user);
    await svc.transition(t.id, 'queued', 'running');
    await pool.query(`UPDATE tasks SET deadline_at = now() + interval '3 minutes' WHERE id=$1`, [t.id]);
    return t;
  }
  const ingest = (t, url = RH_URL, money = 3.6) =>
    ingestor.ingest({ id: t.id, userId: t.userId, pipeline: 'motion_control' }, url, money, new AbortController().signal);
  async function expectFailed(t, reason) {
    const r = await row(t.id);
    assert.equal(r.status, 'failed');
    assert.equal(r.reason_code, reason);
    assert.equal((await ledger(t.id, 'RELEASED')).length, 1);
    assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
    assert.equal(outKeys().length, 0);
    assert.deepEqual(leftovers(), []);
  }

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    process.env.RUNNINGHUB_WORKFLOW_FACESWAP = 'wf-1';
    process.env.RUNNINGHUB_WORKFLOW_MOTION = 'wf-motion';
    process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE = 'wf-body';
    for (const k of ['RH_OUTPUT_RETRY_MS', 'RH_MAX_CONCURRENT', 'AUTH_THROTTLE_LIMIT', 'SHARE_THROTTLE_LIMIT']) saved[k] = process.env[k];
    process.env.RH_OUTPUT_RETRY_MS = '5';
    process.env.AUTH_THROTTLE_LIMIT = '1000';
    process.env.SHARE_THROTTLE_LIMIT = '1000';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
    svc = app.get(TasksService);
    ingestor = app.get(ResultIngestorService);
    share = app.get(ShareService);
    svc.storage = fakeStorage;
    share.storage = fakeStorage;
    ingestor.storage = fakeStorage;
    ingestor.fetchFn = async (...a) => fetchImpl(...a);
    good = makeVideo('good.mp4');
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(vdir, { recursive: true, force: true });
    if (prisma) {
      await pool.query('DELETE FROM share_tokens WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM ledger_entries WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM uploads WHERE user_id = ANY($1::uuid[])', [users]);
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  beforeEach(() => {
    store = new Map(); failPut = null;
    fetchImpl = async () => asResponse(good);
  });

  it('evaluateIngestProbe: chỉ cần có luồng video xem được', () => {
    const ok = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, r_frame_rate: '24/1' }], format: { duration: '5.2' } };
    assert.equal(evaluateIngestProbe(ok), null);
    assert.equal(evaluateIngestProbe({ ...ok, format: { duration: '99' } }), null);
    assert.equal(evaluateIngestProbe({ ...ok, streams: [{ ...ok.streams[0], r_frame_rate: '30/1', width: 540 }] }), null);
    assert.equal(evaluateIngestProbe({ ...ok, streams: [{ ...ok.streams[0], codec_name: 'hevc' }] }), null);
    assert.ok(evaluateIngestProbe({ streams: [{ codec_type: 'audio' }] }));
    assert.ok(evaluateIngestProbe({}));
  });

  it('thành công: succeeded, CAPTURED đúng HOLD, .mp4 + .jpg, thẻ metadata, thư mục tạm sạch', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    await ingest(t);
    const r = await row(t.id);
    assert.equal(r.status, 'succeeded');
    assert.match(r.result_key, OUT_MP4);
    assert.ok(r.result_key.startsWith(`out/${u.id}/`));
    assert.equal(r.gpu_coins, 4);
    const cap = await ledger(t.id, 'CAPTURED');
    assert.equal(cap.length, 1);
    assert.equal((await ledger(t.id, 'RELEASED')).length, 0);
    const hold = await ledger(t.id, 'HOLD');
    assert.equal(Number(hold[0].amount), -250);
    assert.equal(store.get(r.result_key).contentType, 'video/mp4');
    const poster = store.get(r.result_key.replace(/\.mp4$/, '.jpg'));
    assert.equal(poster.contentType, 'image/jpeg');
    assert.equal(poster.body[0], 0xff);
    const f = path.join(vdir, 'saved.mp4');
    fs.writeFileSync(f, store.get(r.result_key).body);
    const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', f]).toString()).format.tags;
    assert.equal(tags.software, 'AI Generator');
    assert.equal(tags.comment, 'AI-Generated Content');
    assert.deepEqual(leftovers(), []);
  });

  it('lệch độ dài: vẫn succeeded, CAPTURED', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    fetchImpl = async () => asResponse(makeVideo('long.mp4', { dur: 6.2 }));
    await ingest(t);
    assert.equal((await row(t.id)).status, 'succeeded');
    assert.equal((await ledger(t.id, 'RELEASED')).length, 0);
  });

  it('file rỗng hoặc hỏng: OUTPUT_INVALID', async () => {
    const u = await newUser();
    for (const body of [Buffer.alloc(0), Buffer.from('not a video at all')]) {
      const t = await runningTask(u);
      fetchImpl = async () => asResponse(body);
      await ingest(t);
      await expectFailed(t, 'OUTPUT_INVALID');
    }
  });

  it('FPS, cạnh ngắn, codec khác spec: vẫn succeeded, kết quả là H.264', async () => {
    const u = await newUser();
    const odd = [makeVideo('fps.mp4', { fps: 30 }), makeVideo('side.mp4', { w: 540, h: 960 }), makeVideo('mpeg4.mp4', { codec: 'mpeg4' })];
    for (const body of odd) {
      const t = await runningTask(u);
      fetchImpl = async () => asResponse(body);
      await ingest(t);
      const r = await row(t.id);
      assert.equal(r.status, 'succeeded');
      const f = path.join(vdir, 'odd.mp4');
      fs.writeFileSync(f, store.get(r.result_key).body);
      const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', f]).toString()).streams.find((x) => x.codec_type === 'video');
      assert.equal(v.codec_name, 'h264');
    }
  });

  it('video ngang 1280x720 hợp lệ', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    fetchImpl = async () => asResponse(makeVideo('land.mp4', { w: 1280, h: 720 }));
    await ingest(t);
    assert.equal((await row(t.id)).status, 'succeeded');
  });

  it('params thiếu seconds: failed/INTERNAL_ERROR, RELEASED, không tải', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    await pool.query(`UPDATE tasks SET params='{}' WHERE id=$1`, [t.id]);
    let n = 0;
    fetchImpl = async () => { n++; return asResponse(good); };
    await ingest(t);
    assert.equal(n, 0);
    await expectFailed(t, 'INTERNAL_ERROR');
  });

  it('tải lỗi 3 lần: OUTPUT_UPLOAD_ERROR', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    let n = 0;
    fetchImpl = async () => { n++; return new Response('x', { status: 500 }); };
    await ingest(t);
    assert.equal(n, 3);
    await expectFailed(t, 'OUTPUT_UPLOAD_ERROR');
  });

  it('quá deadline_at: OUTPUT_UPLOAD_ERROR, không tải', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    await pool.query(`UPDATE tasks SET deadline_at = now() - interval '1 second' WHERE id=$1`, [t.id]);
    let n = 0;
    fetchImpl = async () => { n++; return asResponse(good); };
    await ingest(t);
    assert.equal(n, 0);
    await expectFailed(t, 'OUTPUT_UPLOAD_ERROR');
  });

  it('Content-Length vượt 100 MB: OUTPUT_UPLOAD_ERROR', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    fetchImpl = async () => asResponse(good, { 'content-length': String(101 * 1024 * 1024) });
    await ingest(t);
    await expectFailed(t, 'OUTPUT_UPLOAD_ERROR');
  });

  it('ffmpeg thoát khác 0 (video chỉ có đầu hợp lệ nhưng remux hỏng): FFMPEG_ERROR', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    // Ghi đè tạm PATH để ffmpeg luôn lỗi, ffprobe vẫn chạy.
    const bin = fs.mkdtempSync(path.join(vdir, 'bin-'));
    fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try { await ingest(t); } finally { process.env.PATH = oldPath; }
    await expectFailed(t, 'FFMPEG_ERROR');
  });

  it('ghi R2 lỗi (ảnh bìa): OUTPUT_UPLOAD_ERROR, xóa .mp4 đã ghi', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    failPut = (k) => k.endsWith('.jpg');
    await ingest(t);
    await expectFailed(t, 'OUTPUT_UPLOAD_ERROR');
  });

  it('mất compare-and-set ở bước chốt: xóa .mp4/.jpg, không CAPTURED, không ném lỗi', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    const origPut = fakeStorage.putObject;
    fakeStorage.putObject = async function (key, ...rest) {
      const etag = await origPut.call(this, key, ...rest);
      if (key.endsWith('.jpg')) {
        await pool.query(`UPDATE tasks SET status='timed_out', reason_code='RH_TIMEOUT', finished_at=now() WHERE id=$1`, [t.id]);
      }
      return etag;
    };
    try {
      await ingest(t);
    } finally {
      fakeStorage.putObject = origPut;
    }
    assert.equal((await row(t.id)).status, 'timed_out');
    assert.equal(outKeys().length, 0);
    assert.equal((await ledger(t.id, 'CAPTURED')).length, 0);
    assert.deepEqual(leftovers(), []);
  });

  it('ghi R2 lỗi (video): OUTPUT_UPLOAD_ERROR', async () => {
    const u = await newUser();
    const t = await runningTask(u);
    failPut = () => true;
    await ingest(t);
    await expectFailed(t, 'OUTPUT_UPLOAD_ERROR');
  });

  describe('kết quả cho chủ và chia sẻ', () => {
    async function succeeded(user) {
      const t = await runningTask(user);
      await ingest(t);
      assert.equal((await row(t.id)).status, 'succeeded');
      return t;
    }
    const get = (p, user) => fetch(`${baseUrl}${p}`, { redirect: 'manual', headers: user ? { Authorization: `Bearer ${user.token}` } : {} });

    it('GET /tasks/{id}/result: video + poster + durationSeconds, sourceUrl null; người khác 404', async () => {
      const u = await newUser();
      const other = await newUser();
      const t = await succeeded(u);
      const res = await get(`/tasks/${t.id}/result`, u);
      assert.equal(res.status, 200);
      const j = await res.json();
      const key = (await row(t.id)).result_key;
      assert.equal(j.mediaType, 'video');
      assert.equal(j.durationSeconds, 5);
      assert.equal(j.sourceUrl, null);
      assert.ok(j.resultUrl.includes(key));
      assert.ok(j.posterUrl.includes(key.replace(/\.mp4$/, '.jpg')));
      assert.equal((await get(`/tasks/${t.id}/result`, other)).status, 404);
    });

    it('chia sẻ: /s, /info, /poster; thu hồi và file mất là 404 cả ba', async () => {
      const u = await newUser();
      const t = await succeeded(u);
      const key = (await row(t.id)).result_key;
      const { token } = await share.create(u.id, t.id);
      const r1 = await get(`/s/${token}`);
      assert.equal(r1.status, 302);
      assert.ok(r1.headers.get('location').includes(key));
      const info = await get(`/s/${token}/info`);
      assert.equal(info.status, 200);
      assert.deepEqual(await info.json(), { mediaType: 'video', durationSeconds: 5 });
      const p = await get(`/s/${token}/poster`);
      assert.equal(p.status, 302);
      assert.ok(p.headers.get('location').includes(key.replace(/\.mp4$/, '.jpg')));

      store.delete(key.replace(/\.mp4$/, '.jpg'));
      assert.equal((await get(`/s/${token}/poster`)).status, 404);
      assert.equal((await get(`/s/${token}`)).status, 302);

      store.delete(key);
      for (const s of ['', '/info', '/poster']) assert.equal((await get(`/s/${token}${s}`)).status, 404);

      const bogus = crypto.randomBytes(32).toString('base64url');
      for (const s of ['', '/info', '/poster']) assert.equal((await get(`/s/${bogus}${s}`)).status, 404);
    });

    it('chia sẻ bị thu hồi: 404 cả ba', async () => {
      const u = await newUser();
      const t = await succeeded(u);
      const { token } = await share.create(u.id, t.id);
      await share.revoke(u.id, t.id);
      for (const s of ['', '/info', '/poster']) assert.equal((await get(`/s/${token}${s}`)).status, 404);
    });

    it('ảnh (face_swap): /info trả image, /poster 404, result không có mediaType video', async () => {
      const u = await newUser();
      const id = crypto.randomUUID();
      const key = `out/${u.id}/${crypto.randomUUID()}`;
      await pool.query(
        `INSERT INTO tasks (id, user_id, pipeline, status, result_key, tier_snapshot, consent, tos_version, input_keys, hold_amount)
         VALUES ($1,$2,'face_swap','succeeded',$3,'{"tier":"FREE","priority":10,"maxVideoSeconds":5}',true,'tos-v7','{}',100)`,
        [id, u.id, key],
      );
      store.set(key, { body: Buffer.from('x'), contentType: 'image/png' });
      const { token } = await share.create(u.id, id);
      assert.deepEqual(await (await get(`/s/${token}/info`)).json(), { mediaType: 'image' });
      assert.equal((await get(`/s/${token}/poster`)).status, 404);
      const j = await (await get(`/tasks/${id}/result`, u)).json();
      assert.notEqual(j.mediaType, 'video');
      assert.equal(j.posterUrl, undefined);
    });
  });
});
