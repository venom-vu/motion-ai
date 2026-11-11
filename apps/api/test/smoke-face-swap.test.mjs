import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  AuthGoogleCallbackResponseSchema,
  AuthGoogleResponseSchema,
  FaceSwapCreateResponseSchema,
  MOCK_TASKS_BY_STATUS,
  MOCK_TASK_RESULT_RESPONSE,
  MOCK_TASK_SHARE_RESPONSE,
  MOCK_TASK_SHARE_REVOKE_RESPONSE,
  MeResponseSchema,
  TOS_VERSION,
  TaskResultResponseSchema,
  TaskSchema,
  TaskShareResponseSchema,
  TaskShareRevokeResponseSchema,
  WalletLedgerResponseSchema,
  getReasonCodeMessageVi,
} from '@flowvis/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const composeFiles = [
  path.join(repoRoot, 'deploy', 'compose.yml'),
  path.join(repoRoot, 'deploy', 'compose.smoke.yml'),
];

const GOOGLE_PORT = 3199;
const RH_PORT = 3197;
const S3_PORT = 3198;
const BUCKET = 'smoke-bucket';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}
const close = (s) => new Promise((r) => s.close(r));
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startFakeGoogle() {
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
    GOOGLE_PORT,
  );
}

/** RunningHub giả: `state.mode` quyết định kết quả của /outputs. */
function startFakeRunningHub(state, png) {
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      if (req.method === 'POST' && url.pathname === '/upload') {
        const body = await readBody(req);
        state.uploads.push({ name: url.searchParams.get('name'), bytes: body.length });
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ fileName: `rh-${crypto.randomUUID()}.png` }));
      }
      if (req.method === 'POST' && url.pathname === '/submit') {
        state.submitBodies.push(JSON.parse((await readBody(req)).toString()));
        state.submits += 1;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ taskId: `rh-task-${state.submits}` }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/outputs/')) {
        res.setHeader('Content-Type', 'application/json');
        state.outputsHits += 1;
        if (state.mode === 'success') {
          return res.end(
            JSON.stringify({
              status: 'SUCCESS',
              fileUrl: `http://host.docker.internal:${RH_PORT}/files/result.png`,
              consumeMoney: 7,
            }),
          );
        }
        if (state.mode === 'no_face') {
          return res.end(JSON.stringify({ status: 'FAILED', errorMessage: 'NO_FACE: không thấy mặt' }));
        }
        return res.end(JSON.stringify({ status: 'RUNNING' }));
      }
      if (req.method === 'GET' && url.pathname === '/files/result.png') {
        state.fileFetches += 1;
        res.setHeader('Content-Type', 'image/png');
        return res.end(png);
      }
      res.statusCode = 404;
      res.end('{}');
    }),
    RH_PORT,
  );
}

/** S3 (path-style) giả, đủ cho PUT/GET/HEAD/DELETE/Copy có điều kiện ETag. */
function startFakeS3() {
  const objects = new Map();
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
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
    S3_PORT,
  );
}

async function makePng() {
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

describe('Smoke Face Swap FE-BE trên stack Compose (Story 2.14)', () => {
  it(
    'thành công, NO_FACE, quá hạn, chia sẻ/thu hồi, hợp đồng và đối soát',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack)',
      timeout: 1_200_000,
    },
    async () => {
      const project = 'flowvis-smoke-fs';
      const apiPort = '3103';
      const base = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        PORT: apiPort,
        API_PUBLIC_URL: base,
        POSTGRES_PORT: '15434',
        REDIS_PORT: '16381',
        RH_DEADLINE_MS: '10000',
        RUNNINGHUB_BASE_URL: `http://host.docker.internal:${RH_PORT}`,
        R2_ENDPOINT: `http://host.docker.internal:${S3_PORT}`,
        GOOGLE_TOKEN_URL: `http://host.docker.internal:${GOOGLE_PORT}/token`,
        GOOGLE_USERINFO_URL: `http://host.docker.internal:${GOOGLE_PORT}/userinfo`,
      };
      delete env.DATABASE_URL;
      delete env.REDIS_URL;
      const compose = (args) =>
        execFileSync(
          'docker',
          ['compose', '-p', project, ...composeFiles.flatMap((f) => ['-f', f]), ...args],
          { cwd: repoRoot, env, encoding: 'utf8', stdio: 'pipe' },
        );

      const png = await makePng();
      const rh = { mode: 'running', submits: 0, submitBodies: [], uploads: [], outputsHits: 0, fileFetches: 0 };
      const servers = [];
      try {
        servers.push(await startFakeGoogle(), await startFakeRunningHub(rh, png), await startFakeS3());
        compose(['up', '-d', '--build', '--wait']);

        // Container tới S3/RH giả qua host.docker.internal; test chạy trên host nên đổi sang 127.0.0.1.
        const toHost = (u) => u.replace('host.docker.internal', '127.0.0.1');
        const hdr = (s) => ({ Authorization: `Bearer ${s.accessToken}` });

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
          return AuthGoogleCallbackResponseSchema.parse(await r2.json());
        }
        async function api(session, method, p, body) {
          const res = await fetch(`${base}${p}`, {
            method,
            headers: { ...hdr(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
          return res;
        }
        async function balance(session) {
          const res = await api(session, 'GET', '/me');
          assert.equal(res.status, 200);
          return MeResponseSchema.parse(await res.json()).balance;
        }
        async function uploadImage(session) {
          const r = await api(session, 'POST', '/uploads', { mimeType: 'image/png', sizeBytes: png.length });
          assert.equal(r.status, 201);
          const up = await r.json();
          const put = await fetch(toHost(up.uploadUrl), { method: 'PUT', headers: up.headers, body: png });
          assert.equal(put.status, 200);
          const c = await api(session, 'POST', `/uploads/${encodeURIComponent(up.key)}/confirm`);
          assert.equal(c.status, 200);
          return (await c.json()).key;
        }
        async function createTask(session) {
          const sourceKey = await uploadImage(session);
          const targetKey = await uploadImage(session);
          const res = await api(session, 'POST', '/tasks/face-swap', { sourceKey, targetKey });
          assert.equal(res.status, 201);
          const task = FaceSwapCreateResponseSchema.parse(await res.json());
          assert.equal(task.status, 'queued');
          return task;
        }
        async function waitFor(session, id, pred, label, timeoutMs = 60_000) {
          const end = Date.now() + timeoutMs;
          let last;
          while (Date.now() < end) {
            const res = await api(session, 'GET', `/tasks/${id}`);
            assert.equal(res.status, 200);
            last = TaskSchema.parse(await res.json());
            if (pred(last)) return last;
            await sleep(300);
          }
          assert.fail(`${label}: quá thời gian chờ, trạng thái cuối ${JSON.stringify(last)}`);
        }
        async function ledgerTypes(session, taskId) {
          const res = await api(session, 'GET', '/wallet/ledger?pageSize=50');
          const l = WalletLedgerResponseSchema.parse(await res.json());
          return l.items.filter((i) => i.taskId === taskId).map((i) => i.type);
        }

        // 1. Thành công
        const alice = await login('alice');
        assert.equal(await balance(alice), 500);
        rh.mode = 'running';
        const t1 = await createTask(alice);
        assert.equal(t1.creditCost, 100);
        assert.equal(await balance(alice), 400, 'HOLD 100 credit');
        const running = await waitFor(alice, t1.id, (t) => t.status === 'running', 'running');
        assert.equal(running.status, 'running');
        rh.mode = 'success';
        const done = await waitFor(alice, t1.id, (t) => t.status === 'succeeded', 'succeeded');
        assert.match(done.resultKey, /^out\//);
        assert.equal(await balance(alice), 400);
        const types1 = await ledgerTypes(alice, t1.id);
        assert.ok(types1.includes('HOLD') && types1.includes('CAPTURED'), `ledger: ${types1}`);
        assert.ok(!types1.includes('RELEASED'));
        const resRes = await api(alice, 'GET', `/tasks/${t1.id}/result`);
        assert.equal(resRes.status, 200);
        const result = TaskResultResponseSchema.parse(await resRes.json());
        const img = await fetch(toHost(result.resultUrl));
        assert.equal(img.status, 200);
        const imgBytes = Buffer.from(await img.arrayBuffer());
        assert.ok((await sharp(imgBytes).metadata()).width === 640);
        assert.ok(imgBytes.includes(Buffer.from('AI Generator')), 'EXIF Software phải là AI Generator');

        // 2. Chia sẻ / thu hồi
        const shareRes = await api(alice, 'POST', `/tasks/${t1.id}/share`);
        assert.equal(shareRes.status, 201);
        const share = TaskShareResponseSchema.parse(await shareRes.json());
        const pub = await fetch(`${base}/s/${share.token}`, { redirect: 'manual' });
        assert.equal(pub.status, 302);
        const loc = pub.headers.get('location');
        assert.ok(loc);
        assert.match(loc, /X-Amz-Signature=/, 'phải chuyển hướng tới URL ký');
        assert.ok(loc.includes(done.resultKey), 'URL ký trỏ đúng khóa kết quả');
        assert.ok(!loc.includes(share.token), 'URL ký không chứa token');
        const shared = await fetch(toHost(loc));
        assert.equal(shared.status, 200);
        const rev = await api(alice, 'DELETE', `/tasks/${t1.id}/share`);
        assert.equal(rev.status, 200);
        const revoked = TaskShareRevokeResponseSchema.parse(await rev.json());
        const gone = await fetch(`${base}/s/${share.token}`, { redirect: 'manual' });
        assert.equal(gone.status, 404);

        // 3. NO_FACE
        const bob = await login('bob');
        assert.equal(await balance(bob), 500);
        rh.mode = 'no_face';
        const t2 = await createTask(bob);
        const failed = await waitFor(bob, t2.id, (t) => t.status === 'failed', 'failed NO_FACE');
        assert.equal(failed.reasonCode, 'NO_FACE');
        assert.equal(getReasonCodeMessageVi('NO_FACE'), 'Không nhận diện được khuôn mặt trong ảnh');
        assert.equal(await balance(bob), 500, 'RELEASED 100%');
        assert.ok((await ledgerTypes(bob, t2.id)).includes('RELEASED'));

        // 4. Quá hạn (hạn chót ép 10 giây)
        const carol = await login('carol');
        rh.mode = 'running';
        const t3 = await createTask(carol);
        const timedOut = await waitFor(carol, t3.id, (t) => t.status === 'timed_out', 'timed_out', 120_000);
        assert.equal(timedOut.reasonCode, 'RH_TIMEOUT');
        assert.equal(await balance(carol), 500);
        assert.ok((await ledgerTypes(carol, t3.id)).includes('RELEASED'));
        // Kết quả đến muộn: chuyển RH sang SUCCESS rồi chờ qua hơn một chu kỳ poll; không được tải ảnh hay đổi trạng thái.
        const fetchesBefore = rh.fileFetches;
        rh.mode = 'success';
        await sleep(2500); // RH_POLL_INTERVAL_MS=300 nên đủ nhiều chu kỳ
        assert.equal(rh.fileFetches, fetchesBefore, 'không được tải result.png sau khi timed_out');
        const after = await waitFor(carol, t3.id, () => true, 'sau kết quả muộn');
        assert.equal(after.status, 'timed_out');
        assert.equal(await balance(carol), 500);
        assert.ok(!(await ledgerTypes(carol, t3.id)).includes('CAPTURED'));

        // Payload gửi RunningHub: mỗi Task upload 2 ảnh và submit đúng workflow, đúng ánh xạ node
        assert.equal(rh.submits, 3);
        assert.equal(rh.uploads.length, 6);
        for (const u of rh.uploads) assert.ok(u.bytes > 0 && u.name);
        for (const b of rh.submitBodies) {
          assert.equal(b.workflowId, 'smoke-workflow-faceswap');
          assert.deepEqual(
            b.nodeInfoList.map((n) => [n.nodeId, n.fieldName]),
            [['470', 'image'], ['475', 'image']],
          );
          for (const n of b.nodeInfoList) assert.match(n.fieldValue, /^rh-.*\.png$/);
        }

        // Hợp đồng: MOCK_* và phản hồi BE thật cùng schema, khóa thật nằm trong khóa mock
        for (const t of Object.values(MOCK_TASKS_BY_STATUS)) TaskSchema.parse(t);
        TaskResultResponseSchema.parse(MOCK_TASK_RESULT_RESPONSE);
        TaskShareResponseSchema.parse(MOCK_TASK_SHARE_RESPONSE);
        TaskShareRevokeResponseSchema.parse(MOCK_TASK_SHARE_REVOKE_RESPONSE);
        const mockTaskKeys = new Set(Object.values(MOCK_TASKS_BY_STATUS).flatMap((t) => Object.keys(t)));
        for (const t of [t1, done, failed, timedOut]) {
          for (const k of Object.keys(t)) assert.ok(mockTaskKeys.has(k), `khóa Task thật lạ: ${k}`);
        }
        for (const k of Object.keys(result)) assert.ok(k in MOCK_TASK_RESULT_RESPONSE, `khóa result lạ: ${k}`);
        assert.deepEqual(Object.keys(share).sort(), Object.keys(MOCK_TASK_SHARE_RESPONSE).sort());
        assert.deepEqual(revoked, MOCK_TASK_SHARE_REVOKE_RESPONSE);

        // Đối soát: thoát mã 0 nếu không lệch
        const out = compose(['exec', '-T', 'nestjs-worker', 'node', 'apps/api/dist/scripts/reconcile.js']);
        assert.match(out, /"status":"ok"/);
      } finally {
        try {
          compose(['down', '-v']);
        } catch {
          // best-effort cleanup
        }
        for (const s of servers) await close(s);
      }
    },
  );

  it('MOCK_* Task parse được qua schema contracts (không cần Docker)', () => {
    for (const t of Object.values(MOCK_TASKS_BY_STATUS)) TaskSchema.parse(t);
    TaskResultResponseSchema.parse(MOCK_TASK_RESULT_RESPONSE);
    assert.equal(getReasonCodeMessageVi('NO_FACE'), 'Không nhận diện được khuôn mặt trong ảnh');
  });
});
