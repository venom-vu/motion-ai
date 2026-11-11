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
  BodyRetouchCreateResponseSchema,
  FaceSwapCreateResponseSchema,
  MOCK_BODY_RETOUCH_RESULT_RESPONSE,
  MOCK_BODY_RETOUCH_TASKS_BY_STATUS,
  MeResponseSchema,
  TOS_VERSION,
  TaskResultResponseSchema,
  TaskSchema,
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
        const rhId = `rh-task-${state.submits}`;
        state.active.add(rhId);
        state.maxActive = Math.max(state.maxActive, state.active.size);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ taskId: rhId }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/outputs/')) {
        res.setHeader('Content-Type', 'application/json');
        state.outputsHits += 1;
        const rhId = url.pathname.slice('/outputs/'.length);
        if (state.mode === 'success') {
          state.active.delete(rhId);
          return res.end(
            JSON.stringify({
              status: 'SUCCESS',
              fileUrl: `http://host.docker.internal:${RH_PORT}/files/result.png`,
              consumeMoney: 7,
            }),
          );
        }
        if (state.mode === 'no_pose') {
          state.active.delete(rhId);
          return res.end(JSON.stringify({ status: 'FAILED', errorMessage: 'NO_POSE: không thấy người' }));
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

describe('Smoke Body Retouch FE-BE trên stack Compose (Story 4.6)', () => {
  it(
    'thành công intensity 8, NO_POSE, chung hàng đợi với Face Swap, ảnh gốc hết hạn, hợp đồng và đối soát',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, build image, dựng cả stack)',
      timeout: 1_200_000,
    },
    async () => {
      const project = 'flowvis-smoke-bd';
      const apiPort = '3105';
      const base = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        PORT: apiPort,
        API_PUBLIC_URL: base,
        POSTGRES_PORT: '15436',
        REDIS_PORT: '16383',
        RH_DEADLINE_MS: '60000',
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
      const rh = {
        mode: 'running',
        submits: 0,
        submitBodies: [],
        uploads: [],
        outputsHits: 0,
        fileFetches: 0,
        active: new Set(),
        maxActive: 0,
      };
      const servers = [];
      try {
        servers.push(await startFakeGoogle());
        servers.push(await startFakeRunningHub(rh, png));
        servers.push(await startFakeS3());
        compose(['up', '-d', '--build', '--wait']);

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
          return fetch(`${base}${p}`, {
            method,
            headers: { ...hdr(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
          });
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
        async function createBodyTask(session, intensity) {
          const imageKey = await uploadImage(session);
          const res = await api(session, 'POST', '/tasks/body-retouch', { imageKey, intensity });
          assert.equal(res.status, 201);
          const task = BodyRetouchCreateResponseSchema.parse(await res.json());
          assert.equal(task.status, 'queued');
          assert.equal(task.pipeline, 'body_retouch');
          return { task, imageKey };
        }
        async function createFaceSwapTask(session) {
          const sourceKey = await uploadImage(session);
          const targetKey = await uploadImage(session);
          const res = await api(session, 'POST', '/tasks/face-swap', { sourceKey, targetKey });
          assert.equal(res.status, 201);
          return FaceSwapCreateResponseSchema.parse(await res.json());
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
        const count = (arr, v) => arr.filter((x) => x === v).length;

        // 1. Thành công, intensity 8
        const alice = await login('alice');
        assert.equal(await balance(alice), 500);
        rh.mode = 'running';
        const { task: t1, imageKey: img1 } = await createBodyTask(alice, 8);
        assert.equal(t1.creditCost, 100);
        assert.equal(await balance(alice), 400, 'HOLD 100 credit');
        await waitFor(alice, t1.id, (t) => t.status === 'running', 'running');
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
        assert.ok(result.resultUrl);
        assert.ok(result.sourceUrl, 'sourceUrl không rỗng khi ảnh gốc còn');
        assert.equal((await fetch(toHost(result.resultUrl))).status, 200);
        assert.equal((await fetch(toHost(result.sourceUrl))).status, 200);
        const sub1 = rh.submitBodies[0];
        assert.equal(sub1.workflowId, 'smoke-workflow-body-reshape');
        assert.deepEqual(
          sub1.nodeInfoList.map((n) => [n.nodeId, n.fieldName]),
          [['4', 'image']],
        );
        assert.match(sub1.nodeInfoList[0].fieldValue, /^rh-.*\.png$/);

        // 2. NO_POSE
        const bob = await login('bob');
        assert.equal(await balance(bob), 500);
        rh.mode = 'no_pose';
        const { task: t2 } = await createBodyTask(bob, 5);
        const failed = await waitFor(bob, t2.id, (t) => t.status === 'failed', 'failed NO_POSE');
        assert.equal(failed.reasonCode, 'NO_POSE');
        assert.equal(
          getReasonCodeMessageVi('NO_POSE', 'body_retouch'),
          'Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân.',
        );
        assert.equal(await balance(bob), 500, 'RELEASED 100%');
        assert.ok((await ledgerTypes(bob, t2.id)).includes('RELEASED'));

        // 3. Chung hàng đợi với Face Swap
        const dave = await login('dave');
        rh.mode = 'running';
        rh.maxActive = 0;
        const fs = await createFaceSwapTask(dave);
        const { task: br } = await createBodyTask(dave, 6);
        const { task: br2 } = await createBodyTask(dave, 7);
        assert.equal(await balance(dave), 200);
        const end = Date.now() + 60_000;
        while (rh.active.size < 2 && Date.now() < end) await sleep(200);
        assert.equal(rh.active.size, 2, 'hai Task đầu cùng chạy tại RH giả');
        await sleep(1500);
        assert.equal(rh.active.size, 2, 'Task thứ ba chưa được submit khi hai lane còn bận');
        assert.equal(rh.maxActive, 2, `không quá 2 đồng thời, thấy ${rh.maxActive}`);
        assert.ok(rh.submits >= 2);
        rh.mode = 'success';
        await waitFor(dave, fs.id, (t) => t.status === 'succeeded', 'face swap succeeded');
        await waitFor(dave, br.id, (t) => t.status === 'succeeded', 'body retouch succeeded');
        await waitFor(dave, br2.id, (t) => t.status === 'succeeded', 'body retouch thứ hai succeeded');
        assert.ok(rh.maxActive <= 2, `không quá 2 đồng thời, thấy ${rh.maxActive}`);
        assert.equal(await balance(dave), 200);
        const wfIds = rh.submitBodies.slice(-3).map((b) => b.workflowId).sort();
        assert.deepEqual(
          wfIds,
          ['smoke-workflow-body-reshape', 'smoke-workflow-body-reshape', 'smoke-workflow-faceswap'],
          'mỗi pipeline gửi đúng workflow của mình',
        );
        for (const id of [fs.id, br.id, br2.id]) {
          const ty = await ledgerTypes(dave, id);
          assert.equal(count(ty, 'HOLD'), 1, `HOLD ${id}`);
          assert.equal(count(ty, 'CAPTURED'), 1, `CAPTURED ${id}`);
        }

        // 4. Ảnh gốc hết hạn: xóa đối tượng in/ khỏi S3 giả
        const del = await fetch(`http://127.0.0.1:${S3_PORT}/${BUCKET}/${img1}`, { method: 'DELETE' });
        assert.equal(del.status, 204);
        const expRes = await api(alice, 'GET', `/tasks/${t1.id}/result`);
        assert.equal(expRes.status, 200);
        const expired = TaskResultResponseSchema.parse(await expRes.json());
        assert.equal(expired.sourceUrl, null);
        assert.equal((await fetch(toHost(expired.resultUrl))).status, 200);

        // Hợp đồng
        for (const t of Object.values(MOCK_BODY_RETOUCH_TASKS_BY_STATUS)) TaskSchema.parse(t);
        TaskResultResponseSchema.parse(MOCK_BODY_RETOUCH_RESULT_RESPONSE);
        const mockKeys = new Set(Object.values(MOCK_BODY_RETOUCH_TASKS_BY_STATUS).flatMap((t) => Object.keys(t)));
        for (const t of [t1, done, failed]) {
          for (const k of Object.keys(t)) assert.ok(mockKeys.has(k), `khóa Task thật lạ: ${k}`);
        }
        for (const k of Object.keys(result)) assert.ok(k in MOCK_BODY_RETOUCH_RESULT_RESPONSE, `khóa result lạ: ${k}`);

        // Đối soát
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

  it('MOCK_BODY_RETOUCH_* parse được qua schema contracts (không cần Docker)', () => {
    for (const t of Object.values(MOCK_BODY_RETOUCH_TASKS_BY_STATUS)) {
      TaskSchema.parse(t);
      assert.equal(t.pipeline, 'body_retouch');
    }
    BodyRetouchCreateResponseSchema.parse(MOCK_BODY_RETOUCH_TASKS_BY_STATUS.queued);
    TaskResultResponseSchema.parse(MOCK_BODY_RETOUCH_RESULT_RESPONSE);
    assert.equal(
      getReasonCodeMessageVi('NO_POSE', 'body_retouch'),
      'Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân.',
    );
  });
});
