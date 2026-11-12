// Helper dùng chung cho smoke vận hành (Story 6.10): Google, RunningHub, R2 (S3) và Discord giả,
// cộng bộ dựng lệnh compose và client đăng nhập. Các smoke cũ giữ bản sao riêng, không dùng file này.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  AuthGoogleCallbackResponseSchema,
  AuthGoogleResponseSchema,
  MeResponseSchema,
  TOS_VERSION,
  TaskSchema,
} from '@flowvis/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '../../../..');
export const composeFiles = [
  path.join(repoRoot, 'deploy', 'compose.yml'),
  path.join(repoRoot, 'deploy', 'compose.smoke.yml'),
];

export const PORTS = { google: 3199, rh: 3197, s3: 3198, discord: 3196 };
export const BUCKET = 'smoke-bucket';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const close = (s) => new Promise((r) => s.close(r));
export const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

export function startFakeGoogle() {
  const tokens = new Map();
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/token') {
        const code = new URLSearchParams((await readBody(req)).toString()).get('code') ?? '';
        const token = `fake-access-${code}`;
        tokens.set(token, code);
        return res.end(JSON.stringify({ access_token: token, token_type: 'Bearer' }));
      }
      if (req.method === 'GET' && url.pathname === '/userinfo') {
        const code = tokens.get(String(req.headers.authorization ?? '').replace('Bearer ', ''));
        if (!code) {
          res.statusCode = 401;
          return res.end('{}');
        }
        return res.end(JSON.stringify({ sub: `sub-${code}`, email: `${code}@smoke.test`, name: `Smoke ${code}` }));
      }
      res.statusCode = 404;
      res.end('{}');
    }),
    PORTS.google,
  );
}

/**
 * RunningHub giả. `state.mode`: success | no_pose | error | running.
 * `state.resultExt` (png | mp4) chọn tệp kết quả; `state.resultImage`/`state.resultVideo` là nội dung.
 */
export function startFakeRunningHub(state) {
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/upload') {
        const body = await readBody(req);
        const name = url.searchParams.get('name') ?? '';
        const ext = name.endsWith('-videoKey') ? 'mp4' : 'png';
        const fileName = `rh-${crypto.randomUUID()}.${ext}`;
        state.uploads.push({ name, bytes: body.length, fileName });
        return res.end(JSON.stringify({ fileName }));
      }
      if (req.method === 'POST' && url.pathname === '/submit') {
        state.submitBodies.push(JSON.parse((await readBody(req)).toString()));
        state.submits += 1;
        return res.end(JSON.stringify({ taskId: `rh-task-${state.submits}` }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/outputs/')) {
        if (state.mode === 'success') {
          return res.end(
            JSON.stringify({
              status: 'SUCCESS',
              fileUrl: `http://host.docker.internal:${PORTS.rh}/files/result.${state.resultExt}`,
              consumeMoney: 7,
            }),
          );
        }
        if (state.mode === 'no_pose') {
          return res.end(JSON.stringify({ status: 'FAILED', errorMessage: 'NO_POSE: không thấy người' }));
        }
        if (state.mode === 'error') {
          return res.end(JSON.stringify({ status: 'FAILED', errorMessage: 'GPU node crashed' }));
        }
        return res.end(JSON.stringify({ status: 'RUNNING' }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/files/result.')) {
        const isVideo = url.pathname.endsWith('.mp4');
        res.setHeader('Content-Type', isVideo ? 'video/mp4' : 'image/png');
        return res.end(isVideo ? state.resultVideo : state.resultImage);
      }
      res.statusCode = 404;
      res.end('{}');
    }),
    PORTS.rh,
  );
}

/** S3 (path-style) giả: PUT/GET/HEAD/DELETE/Copy có điều kiện ETag và ListObjectsV2. `server.objects` là kho khóa. */
export async function startFakeS3() {
  const objects = new Map();
  const server = await listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      if (
        req.method === 'GET' &&
        (url.pathname === `/${BUCKET}` || url.pathname === `/${BUCKET}/`) &&
        url.searchParams.has('list-type')
      ) {
        const prefix = url.searchParams.get('prefix') ?? '';
        const rows = [...objects].filter(([k]) => k.startsWith(prefix));
        const contents = rows
          .map(
            ([k, o]) =>
              `<Contents><Key>${k}</Key><LastModified>2026-11-12T00:00:00.000Z</LastModified><ETag>${o.etag}</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
          )
          .join('');
        res.setHeader('Content-Type', 'application/xml');
        return res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><Prefix>${prefix}</Prefix><KeyCount>${rows.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        );
      }
      const prefix = `/${BUCKET}/`;
      if (!url.pathname.startsWith(prefix)) {
        res.statusCode = 404;
        return res.end();
      }
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      const copySource = req.headers['x-amz-copy-source'];
      if (req.method === 'PUT' && copySource) {
        const srcKey = decodeURIComponent(String(copySource)).replace(new RegExp(`^/?${BUCKET}/`), '');
        const src = objects.get(srcKey);
        if (!src) {
          res.statusCode = 404;
          return res.end();
        }
        const ifMatch = req.headers['x-amz-copy-source-if-match'];
        if (ifMatch && ifMatch !== src.etag) {
          res.statusCode = 412;
          return res.end('<Error><Code>PreconditionFailed</Code></Error>');
        }
        objects.set(key, { ...src });
        res.setHeader('Content-Type', 'application/xml');
        return res.end(`<CopyObjectResult><ETag>${src.etag}</ETag></CopyObjectResult>`);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
        objects.set(key, { body, etag, contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
        res.setHeader('ETag', etag);
        return res.end();
      }
      const obj = objects.get(key);
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.statusCode = 204;
        return res.end();
      }
      if (!obj) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/xml');
        return res.end('<Error><Code>NoSuchKey</Code></Error>');
      }
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== obj.etag) {
        res.statusCode = 412;
        return res.end('<Error><Code>PreconditionFailed</Code></Error>');
      }
      res.setHeader('ETag', obj.etag);
      res.setHeader('Content-Type', obj.contentType);
      res.setHeader('Content-Length', String(obj.body.length));
      return res.end(req.method === 'HEAD' ? undefined : obj.body);
    }),
    PORTS.s3,
  );
  server.objects = objects;
  return server;
}

/** Discord webhook giả: ghi lại nội dung mọi thông báo vào `messages`. */
export function startFakeDiscord(messages) {
  return listen(
    http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/hook') {
        messages.push(JSON.parse((await readBody(req)).toString()).content);
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    }),
    PORTS.discord,
  );
}

export async function makePng() {
  const w = 640;
  const h = 640;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = (i / 3) % 256;
    raw[i + 1] = 120;
    raw[i + 2] = 200;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

/** Sinh MP4 H.264 24 FPS bằng ffmpeg của máy chạy test (mảng đối số, không qua shell). */
export function makeVideo(file, seconds, width = 720, height = 1280) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=24:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '24',
      '-movflags', '+faststart', '-t', String(seconds), file,
    ],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(file);
}

const execFileP = promisify(execFile);

/**
 * Lệnh compose bất đồng bộ (không chặn vòng lặp sự kiện, để các máy chủ giả vẫn trả lời
 * khi container gọi ra host). Trả về stdout; `opts.input` ghi vào stdin.
 */
export function makeCompose(project, env) {
  return async (args, opts = {}) => {
    const p = execFileP(
      'docker',
      ['compose', '-p', project, ...composeFiles.flatMap((f) => ['-f', f]), ...args],
      { cwd: repoRoot, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_500_000 },
    );
    p.child.stdin.end(opts.input ?? '');
    return (await p).stdout;
  };
}

/** Client HTTP của smoke: đăng nhập Google giả, gọi API kèm Bearer, chờ Task. */
export function makeClient(base) {
  const toHost = (u) => u.replace('host.docker.internal', '127.0.0.1');

  async function login(label) {
    const q = new URLSearchParams({ tosVersion: TOS_VERSION, deviceId: `device-${label}` });
    const r1 = await fetch(`${base}/auth/google?${q}`);
    assert.equal(r1.status, 200);
    const start = AuthGoogleResponseSchema.parse(await r1.json());
    const setCookie = r1.headers.getSetCookie().find((c) => c.startsWith('motion_device='));
    const cookie = setCookie ? setCookie.split(';')[0] : '';
    const state = new URL(start.redirectUrl).searchParams.get('state');
    const r2 = await fetch(`${base}/auth/google/callback?${new URLSearchParams({ code: label, state })}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(r2.status, 200);
    const refresh = r2.headers.getSetCookie().find((c) => c.startsWith('refreshToken='));
    return {
      ...AuthGoogleCallbackResponseSchema.parse(await r2.json()),
      label,
      email: `${label}@smoke.test`,
      refreshCookie: refresh ? refresh.split(';')[0] : '',
    };
  }

  async function api(session, method, p, body) {
    const init = {
      method,
      headers: {
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    };
    try {
      return await fetch(`${base}${p}`, init);
    } catch {
      await sleep(500);
      return fetch(`${base}${p}`, init);
    }
  }

  async function me(session) {
    const res = await api(session, 'GET', '/me');
    assert.equal(res.status, 200);
    return MeResponseSchema.parse(await res.json());
  }

  async function uploadFile(session, mimeType, bytes) {
    const r = await api(session, 'POST', '/uploads', { mimeType, sizeBytes: bytes.length });
    assert.equal(r.status, 201);
    const up = await r.json();
    const put = await fetch(toHost(up.uploadUrl), { method: 'PUT', headers: up.headers, body: bytes });
    assert.equal(put.status, 200);
    const c = await api(session, 'POST', `/uploads/${encodeURIComponent(up.key)}/confirm`);
    assert.equal(c.status, 200);
    return (await c.json()).key;
  }

  async function waitFor(session, id, pred, label, timeoutMs = 90_000) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      const res = await api(session, 'GET', `/tasks/${id}`);
      assert.equal(res.status, 200);
      last = TaskSchema.parse(await res.json());
      if (pred(last)) return last;
      await sleep(250);
    }
    assert.fail(`${label}: quá thời gian chờ, trạng thái cuối ${JSON.stringify(last)}`);
  }

  async function poll(fn, label, timeoutMs = 20_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) assert.fail(`${label}: quá thời gian chờ`);
      await sleep(300);
    }
  }

  return { toHost, login, api, me, uploadFile, waitFor, poll };
}
