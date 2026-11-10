import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { bootstrapApi } from '../dist/main.js';
import { S3StorageAdapter } from '../dist/modules/storage/index.js';
import { VideoProbeFailedError, VideoProbeService, buildFfprobeArgs, evaluateProbe } from '../dist/modules/storage/index.js';
import { StoragePreconditionFailedError } from '../dist/ports/index.js';

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


const fixtures = path.join(__dirname, 'fixtures');
const fx = (n) => fs.readFileSync(path.join(fixtures, n));

class FakeStorage {
  objects = new Map();
  etagBump = false;
  calls = [];
  etag(buf) { return `"${crypto.createHash('md5').update(buf).digest('hex')}"`; }
  async presignPut(input) {
    this.calls.push(['presignPut', input]);
    return {
      url: `https://r2.example.test/${input.key}?sig=x&len=${input.contentLength}`,
      headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.contentLength) },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }
  async presignGet(key, ttl) { this.calls.push(['presignGet', key, ttl]); return `https://r2.example.test/get/${key}?sig=y`; }
  async head(key) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.length, etag: this.etag(o) } : null;
  }
  async getObject(key) { return this.objects.get(key); }
  async putObject(key, body) { this.objects.set(key, body); return this.etag(body); }
  async copyIfMatch(src, dst, etag) {
    this.calls.push(['copy', src, dst]);
    const o = this.objects.get(src);
    if (this.etagBump || !o || this.etag(o) !== etag) throw new StoragePreconditionFailedError();
    this.objects.set(dst, o);
  }
  async delete(key) { this.calls.push(['delete', key]); this.objects.delete(key); }
}
const fake = new FakeStorage();
for (const m of ['presignPut', 'presignGet', 'head', 'getObject', 'putObject', 'copyIfMatch', 'delete']) {
  S3StorageAdapter.prototype[m] = function (...a) { return fake[m](...a); };
}

// Cổng ffprobe: URL ký giả không truy cập được, nên chạy ffprobe thật trên file cục bộ tương ứng.
const realRun = VideoProbeService.prototype.runFfprobe;
let probeHook = null;
let active = 0;
let maxActive = 0;
VideoProbeService.prototype.runFfprobe = function (url) {
  if (probeHook) return probeHook(url);
  const key = new URL(url).pathname.replace('/get/', '');
  const tmp = path.join(os.tmpdir(), `probe-${crypto.randomUUID()}`);
  fs.writeFileSync(tmp, fake.objects.get(key));
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', tmp],
      (err, out) => {
        fs.rmSync(tmp, { force: true });
        if (err) return reject(new (class extends Error {})('x'));
        resolve(JSON.parse(out));
      });
  }).catch(() => ({}));
};

process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= 'wf-body';

describe('Story 5.2: [BE] Tải video lên và kiểm tra bằng ffprobe', () => {
  let app, baseUrl, pool, prisma, jwt;
  const runId = crypto.randomBytes(4).toString('hex');
  const users = [];

  async function newUser() {
    const n = users.length;
    const u = await prisma.user.create({
      data: { googleId: `upv-${runId}-${n}`, email: `upv-${runId}-${n}@flowvis.vn`, tosVersion: 't' },
    });
    users.push(u.id);
    return { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role: 'user' }) };
  }
  const post = (user, p, body) =>
    fetch(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  async function createVideo(user, buf, mimeType = 'video/mp4', declared = buf.length) {
    const res = await post(user, '/uploads', { mimeType, sizeBytes: declared });
    assert.equal(res.status, 201);
    const json = await res.json();
    fake.objects.set(json.key, buf);
    return json;
  }
  const confirm = (user, key) => post(user, `/uploads/${encodeURIComponent(key)}/confirm`);

  before(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.REDIS_URL = REDIS_URL;
    process.env.PORT = '0';
    process.env.JWT_SECRET = 'super-secret-test-jwt-key-with-at-least-32-chars-ok';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    await ensureInfra();
    pool = new pg.Pool({ connectionString: DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    app = await bootstrapApi();
    baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    jwt = app.get(JwtService);
  });

  after(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
    await pool?.end().catch(() => {});
    await app?.close();
  });

  it('tạo hợp lệ: khóa in-raw, PUT ký Content-Length, kind video', async () => {
    const u = await newUser();
    const res = await post(u, '/uploads', { mimeType: 'video/mp4', sizeBytes: 50 * 1024 * 1024 });
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.match(j.key, new RegExp(`^in-raw/${u.id}/[0-9a-f-]{36}$`));
    assert.equal(j.headers['Content-Length'], String(50 * 1024 * 1024));
    const call = fake.calls.filter((c) => c[0] === 'presignPut').at(-1)[1];
    assert.equal(call.contentLength, 50 * 1024 * 1024);
    const row = await prisma.upload.findUnique({ where: { key: j.key } });
    assert.equal(row.kind, 'video');
  });

  it('MIME/size sai bị từ chối', async () => {
    const u = await newUser();
    assert.equal((await post(u, '/uploads', { mimeType: 'video/webm', sizeBytes: 10 })).status, 400);
    const big = await post(u, '/uploads', { mimeType: 'video/mp4', sizeBytes: 100 * 1024 * 1024 + 1 });
    assert.equal(big.status, 400);
    assert.equal((await big.json()).code, 'VALIDATION_FAILED');
  });

  it('hạn mức chưa xác nhận dùng chung ảnh + video', async () => {
    const u = await newUser();
    for (let i = 0; i < 5; i++) assert.equal((await post(u, '/uploads', { mimeType: 'image/jpeg', sizeBytes: 100 })).status, 201);
    for (let i = 0; i < 5; i++) assert.equal((await post(u, '/uploads', { mimeType: 'video/mp4', sizeBytes: 100 })).status, 201);
    const res = await post(u, '/uploads', { mimeType: 'video/mp4', sizeBytes: 100 });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.equal(j.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(j.message, /ảnh/);
  });

  it('MP4 hợp lệ: trả số đo thật, lưu DB, đã copy sang in/', async () => {
    const u = await newUser();
    const buf = fx('ok.mp4');
    const c = await createVideo(u, buf);
    const res = await confirm(u, c.key);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.match(j.key, new RegExp(`^in/${u.id}/`));
    assert.deepEqual([j.video.durationSeconds, j.video.width, j.video.height], [4, 160, 96]);
    const row = await prisma.upload.findUnique({ where: { key: c.key } });
    assert.equal(row.status, 'confirmed');
    assert.deepEqual([row.durationSeconds, row.width, row.height], [4, 160, 96]);
    assert.ok(fake.objects.has(j.key));
    const get = fake.calls.filter((x) => x[0] === 'presignGet').at(-1);
    assert.equal(get[1], c.key);
    assert.ok(get[2] <= 120);
  });

  it('MOV quay dọc có metadata xoay: width/height theo chiều hiển thị', async () => {
    const u = await newUser();
    const c = await createVideo(u, fx('rotated.mov'), 'video/quicktime');
    const j = await (await confirm(u, c.key)).json();
    assert.deepEqual([j.video.width, j.video.height], [96, 160]);
  });

  for (const [name, file] of [['Matroska đổi đuôi', 'fake.mp4'], ['chỉ âm thanh', 'audio-only.mp4'], ['file cụt', 'truncated.mp4']]) {
    it(`${name}: VIDEO_UNREADABLE, xóa in-raw, bản ghi expired`, async () => {
      const u = await newUser();
      const c = await createVideo(u, fx(file));
      const res = await confirm(u, c.key);
      assert.equal(res.status, 400);
      const j = await res.json();
      assert.equal(j.code, 'VALIDATION_FAILED');
      assert.equal(j.details.reason, 'VIDEO_UNREADABLE');
      assert.equal(fake.objects.has(c.key), false);
      assert.equal((await prisma.upload.findUnique({ where: { key: c.key } })).status, 'expired');
    });
  }

  it('quá ngắn: VIDEO_TOO_SHORT', async () => {
    const u = await newUser();
    const c = await createVideo(u, fx('short.mp4'));
    const res = await confirm(u, c.key);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details.reason, 'VIDEO_TOO_SHORT');
    assert.equal(fake.objects.has(c.key), false);
  });

  it('ffprobe quá hạn: VIDEO_UNREADABLE', async () => {
    const u = await newUser();
    const c = await createVideo(u, fx('ok.mp4'));
    probeHook = () => Promise.reject(new VideoProbeFailedError('timeout'));
    try {
      const res = await confirm(u, c.key);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).details.reason, 'VIDEO_UNREADABLE');
      assert.equal(fake.objects.has(c.key), false);
      assert.equal((await prisma.upload.findUnique({ where: { key: c.key } })).status, 'expired');
    } finally { probeHook = null; }
  });

  it('kích thước lệch khai báo: VALIDATION_FAILED và xóa', async () => {
    const u = await newUser();
    const buf = fx('ok.mp4');
    const c = await createVideo(u, buf, 'video/mp4', buf.length + 5);
    const res = await confirm(u, c.key);
    assert.equal(res.status, 400);
    assert.equal(fake.objects.has(c.key), false);
  });

  it('ETag đổi giữa HEAD và copy: CONFLICT', async () => {
    const u = await newUser();
    const c = await createVideo(u, fx('ok.mp4'));
    fake.etagBump = true;
    try {
      const res = await confirm(u, c.key);
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'CONFLICT');
    } finally { fake.etagBump = false; }
  });

  it('khóa của người khác: FORBIDDEN', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await createVideo(a, fx('ok.mp4'));
    const res = await confirm(b, c.key);
    assert.equal(res.status, 403);
  });

  it('5 confirm cùng lúc: tối đa 2 ffprobe chạy', async () => {
    const u = await newUser();
    const cs = [];
    for (let i = 0; i < 5; i++) cs.push(await createVideo(u, fx('ok.mp4')));
    active = 0; maxActive = 0;
    probeHook = async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 150));
      active--;
      return { format: { format_name: 'mov,mp4', duration: '5.0' }, streams: [{ codec_type: 'video', width: 10, height: 20 }] };
    };
    try {
      const rs = await Promise.all(cs.map((c) => confirm(u, c.key)));
      assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200, 200]);
      assert.equal(maxActive, 2);
    } finally { probeHook = null; }
  });

  it('đối số ffprobe: whitelist, không shell; thật sự giết sau 10 giây', async () => {
    const args = buildFfprobeArgs('https://x/y?z=1');
    assert.deepEqual(args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-protocol_whitelist') + 2), ['-protocol_whitelist', 'https,tls,tcp']);
    assert.equal(args.at(-1), 'https://x/y?z=1');
    assert.equal(evaluateProbe({}).ok, false);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeffprobe-'));
    fs.writeFileSync(path.join(dir, 'ffprobe'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${dir}:${oldPath}`;
    const started = Date.now();
    try {
      const v = await realRun.call(new VideoProbeService(), 'https://x/y').catch((e) => e);
      assert.ok(v instanceof Error);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 9000 && elapsed < 15000, `elapsed ${elapsed}`);
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('evaluateProbe: chỉ có ảnh bìa attached_pic + audio là VIDEO_UNREADABLE', () => {
    const v = evaluateProbe({
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '10.0' },
      streams: [
        { codec_type: 'audio' },
        { codec_type: 'video', width: 500, height: 500, disposition: { attached_pic: 1 } },
      ],
    });
    assert.deepEqual(v, { ok: false, reason: 'VIDEO_UNREADABLE' });
  });

  describe('runner ffprobe thật qua script giả đầu PATH', () => {
    let dir, oldPath;
    const install = (script) => {
      fs.writeFileSync(path.join(dir, 'ffprobe'), script, { mode: 0o755 });
    };
    before(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeffprobe-'));
      oldPath = process.env.PATH;
      process.env.PATH = `${dir}:${oldPath}`;
      VideoProbeService.prototype.runFfprobe = realRun;
    });
    after(() => {
      process.env.PATH = oldPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('JSON hợp lệ: ok, đối số có whitelist và URL ở cuối', async () => {
      const argsFile = path.join(dir, 'args.txt');
      const json = JSON.stringify({
        format: { format_name: 'mov,mp4', duration: '7.6' },
        streams: [{ codec_type: 'video', width: 320, height: 240 }],
      });
      install(`#!/bin/sh\nfor a in "$@"; do echo "$a" >> '${argsFile}'; done\necho '${json}'\n`);
      const v = await new VideoProbeService().probeUrl(async () => 'https://r2.example.test/x?sig=1');
      assert.deepEqual(v, { ok: true, meta: { durationSeconds: 7, width: 320, height: 240 } });
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      const i = args.indexOf('-protocol_whitelist');
      assert.ok(i >= 0);
      assert.equal(args[i + 1], 'https,tls,tcp');
      assert.equal(args.at(-1), 'https://r2.example.test/x?sig=1');
    });

    it('thoát mã 1: VIDEO_UNREADABLE', async () => {
      install('#!/bin/sh\nexit 1\n');
      const v = await new VideoProbeService().probeUrl(async () => 'https://x/y');
      assert.deepEqual(v, { ok: false, reason: 'VIDEO_UNREADABLE' });
    });

    it('quá 10 giây: VIDEO_UNREADABLE và runFfprobe ném VideoProbeFailedError', async () => {
      install('#!/bin/sh\nexec sleep 30\n');
      const svc = new VideoProbeService();
      const err = await svc.runFfprobe('https://x/y').catch((e) => e);
      assert.ok(err instanceof VideoProbeFailedError);
      const v = await svc.probeUrl(async () => 'https://x/y');
      assert.deepEqual(v, { ok: false, reason: 'VIDEO_UNREADABLE' });
    });
  });

  it('UploadConfirmThrottlerGuard: lần thứ 3 của user A bị 429, user B không', async () => {
    const old = process.env.UPLOAD_CONFIRM_THROTTLE_LIMIT;
    process.env.UPLOAD_CONFIRM_THROTTLE_LIMIT = '2';
    try {
      const a = await newUser();
      const b = await newUser();
      const key = `in-raw/${a.id}/${crypto.randomUUID()}`;
      const s = [];
      for (let i = 0; i < 3; i++) s.push((await confirm(a, key)).status);
      assert.deepEqual(s.slice(0, 2).every((x) => x !== 429), true);
      assert.equal(s[2], 429);
      const rl = await confirm(a, key);
      assert.equal((await rl.json()).code, 'RATE_LIMITED');
      assert.notEqual((await confirm(b, `in-raw/${b.id}/${crypto.randomUUID()}`)).status, 429);
    } finally {
      if (old === undefined) delete process.env.UPLOAD_CONFIRM_THROTTLE_LIMIT;
      else process.env.UPLOAD_CONFIRM_THROTTLE_LIMIT = old;
    }
  });
});
