import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';
import {
  AdminTopupSchema,
  AuthGoogleCallbackResponseSchema,
  AuthGoogleResponseSchema,
  MOCK_MOTION_RESULT_RESPONSE,
  MOCK_MOTION_TASKS_BY_STATUS,
  MOCK_SHARE_INFO_VIDEO_RESPONSE,
  MeResponseSchema,
  MotionCreateResponseSchema,
  ShareInfoResponseSchema,
  TOS_VERSION,
  TaskResultResponseSchema,
  TaskSchema,
  TaskShareResponseSchema,
  TopupSchema,
  WalletLedgerResponseSchema,
  getReasonCodeMessageVi,
  motionPrice,
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

/** RunningHub giả: `state.mode` quyết định kết quả của /outputs; `state.resultVideo` là MP4 trả về. */
function startFakeRunningHub(state) {
  return listen(
    http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fake');
      if (req.method === 'POST' && url.pathname === '/upload') {
        const body = await readBody(req);
        const name = url.searchParams.get('name') ?? '';
        const ext = name.endsWith('-videoKey') ? 'mp4' : 'png';
        const fileName = `rh-${crypto.randomUUID()}.${ext}`;
        state.uploads.push({ name, bytes: body.length, fileName });
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ fileName }));
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
        const rhId = url.pathname.slice('/outputs/'.length);
        if (state.mode === 'success') {
          state.active.delete(rhId);
          return res.end(
            JSON.stringify({
              status: 'SUCCESS',
              fileUrl: `http://host.docker.internal:${RH_PORT}/files/result.mp4`,
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
      if (req.method === 'GET' && url.pathname === '/files/result.mp4') {
        state.fileFetches += 1;
        res.setHeader('Content-Type', 'video/mp4');
        return res.end(state.resultVideo);
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


/** Sinh MP4 H.264 24 FPS bằng ffmpeg của máy chạy test (mảng đối số, không qua shell). */
function makeVideo(file, seconds, width = 720, height = 1280) {
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

describe('Smoke Motion Control FE-BE trên stack Compose (Story 5.9)', () => {
  it(
    'thành công, NO_POSE, Cap, ví FREE, hai Task song song, quá hạn, lệch độ dài, chia sẻ, dọn dẹp và đối soát',
    {
      skip:
        process.env.RUN_COMPOSE_E2E === '1'
          ? false
          : 'Đặt RUN_COMPOSE_E2E=1 để chạy (cần Docker, ffmpeg, build image, dựng cả stack)',
      timeout: 1_800_000,
    },
    async () => {
      const project = 'flowvis-smoke-mt';
      const apiPort = '3106';
      const base = `http://127.0.0.1:${apiPort}`;
      const env = {
        ...process.env,
        PORT: apiPort,
        API_PUBLIC_URL: base,
        POSTGRES_PORT: '15437',
        REDIS_PORT: '16384',
        RH_DEADLINE_MS: '25000',
        RUNNINGHUB_BASE_URL: `http://host.docker.internal:${RH_PORT}`,
        R2_ENDPOINT: `http://host.docker.internal:${S3_PORT}`,
        GOOGLE_TOKEN_URL: `http://host.docker.internal:${GOOGLE_PORT}/token`,
        GOOGLE_USERINFO_URL: `http://host.docker.internal:${GOOGLE_PORT}/userinfo`,
        ADMIN_EMAILS: 'admin@smoke.test',
      };
      delete env.DATABASE_URL;
      delete env.REDIS_URL;
      const compose = (args) =>
        execFileSync(
          'docker',
          ['compose', '-p', project, ...composeFiles.flatMap((f) => ['-f', f]), ...args],
          { cwd: repoRoot, env, encoding: 'utf8', stdio: 'pipe' },
        );

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvis-smoke-mt-'));
      const png = await makePng();
      const sample = makeVideo(path.join(tmp, 'sample.mp4'), 14);
      const sample5 = makeVideo(path.join(tmp, 'sample5.mp4'), 6);
      const results = {
        10: makeVideo(path.join(tmp, 'r10.mp4'), 10),
        5: makeVideo(path.join(tmp, 'r5.mp4'), 5),
        10.4: makeVideo(path.join(tmp, 'r104.mp4'), 10.4),
        10.6: makeVideo(path.join(tmp, 'r106.mp4'), 10.6),
      };
      const rh = {
        mode: 'running',
        resultVideo: results[10],
        submits: 0,
        submitBodies: [],
        uploads: [],
        fileFetches: 0,
        active: new Set(),
        maxActive: 0,
      };
      const servers = [];
      try {
        servers.push(await startFakeGoogle());
        servers.push(await startFakeRunningHub(rh));
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
        async function me(session) {
          const res = await api(session, 'GET', '/me');
          assert.equal(res.status, 200);
          return MeResponseSchema.parse(await res.json());
        }
        const balance = async (s) => (await me(s)).balance;
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
        const uploadImage = (s) => uploadFile(s, 'image/png', png);
        const uploadVideo = (s, bytes = sample) => uploadFile(s, 'video/mp4', bytes);
        async function createMotionRaw(session, trimStart, trimEnd, bytes) {
          const characterKey = await uploadImage(session);
          const videoKey = await uploadVideo(session, bytes);
          return api(session, 'POST', '/tasks/motion', { characterKey, videoKey, trimStart, trimEnd });
        }
        async function createMotion(session, trimStart, trimEnd, bytes) {
          const res = await createMotionRaw(session, trimStart, trimEnd, bytes);
          assert.equal(res.status, 201, await res.clone().text());
          const task = MotionCreateResponseSchema.parse(await res.json());
          assert.equal(task.pipeline, 'motion_control');
          assert.equal(task.status, 'queued');
          assert.equal(task.price, task.creditCost);
          return task;
        }
        async function waitFor(session, id, pred, label, timeoutMs = 90_000) {
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
        async function becomeTier(session, admin, pack, ref) {
          const r = await api(session, 'POST', '/topups', { pack });
          assert.equal(r.status, 201);
          const t = TopupSchema.parse(await r.json());
          assert.equal((await api(session, 'POST', `/topups/${t.id}/confirm-transfer`)).status, 200);
          const ap = await api(admin, 'POST', `/admin/topups/${t.id}/approve`, { bankRef: ref });
          assert.equal(ap.status, 200);
          assert.equal(AdminTopupSchema.parse(await ap.json()).status, 'approved');
        }

        const admin = await login('admin');
        assert.equal((await me(admin)).role, 'admin');
        // Mỗi IP chỉ nhận thưởng 500 credit cho 3 tài khoản/24 giờ (admin, bob, dave); các tài khoản còn lại lấy credit từ nạp tiền.
        const bob = await login('bob');
        const dave = await login('dave');

        // 1. Thành công: Creator, trim 10 s
        const alice = await login('alice');
        await becomeTier(alice, admin, 'creator', 'MT-REF-1');
        const aliceStart = await balance(alice);
        assert.equal(aliceStart, 30000, "Creator 30.000 credit từ nạp tiền (IP đã hết lượt thưởng đăng ký)");
        rh.mode = 'running';
        rh.resultVideo = results[10];
        const t1 = await createMotion(alice, 2, 12);
        assert.equal(t1.price, motionPrice(10));
        assert.equal(t1.price, 500);
        assert.equal(await balance(alice), aliceStart - 500, 'HOLD 500 credit');
        await waitFor(alice, t1.id, (t) => t.status === 'running', 'running');
        rh.mode = 'success';
        const done = await waitFor(alice, t1.id, (t) => t.status === 'succeeded', 'succeeded');
        assert.equal(await balance(alice), aliceStart - 500);
        const types1 = await ledgerTypes(alice, t1.id);
        assert.ok(types1.includes('HOLD') && types1.includes('CAPTURED') && !types1.includes('RELEASED'), `ledger ${types1}`);
        const resRes = await api(alice, 'GET', `/tasks/${t1.id}/result`);
        assert.equal(resRes.status, 200);
        const result = TaskResultResponseSchema.parse(await resRes.json());
        assert.equal(result.mediaType, 'video');
        assert.ok(result.resultUrl && result.posterUrl);
        assert.equal(result.durationSeconds, 10);
        assert.equal(result.sourceUrl, null);
        assert.equal((await fetch(toHost(result.resultUrl))).status, 200);
        assert.equal((await fetch(toHost(result.posterUrl))).status, 200);
        const sub1 = rh.submitBodies[0];
        assert.equal(sub1.workflowId, 'smoke-workflow-motion');
        assert.deepEqual(
          sub1.nodeInfoList.map((n) => [n.nodeId, n.fieldName]),
          [['30', 'image'], ['33', 'video'], ['134', 'value'], ['135', 'value'], ['277', 'text'], ['278', 'value']],
        );
        const upNames = new Set(rh.uploads.map((u) => u.fileName));
        assert.ok(upNames.has(sub1.nodeInfoList[0].fieldValue), 'node image là tên file đã tải lên RH');
        assert.ok(upNames.has(sub1.nodeInfoList[1].fieldValue), 'node video là tên file đã tải lên RH');
        assert.match(sub1.nodeInfoList[0].fieldValue, /\.png$/);
        assert.match(sub1.nodeInfoList[1].fieldValue, /\.mp4$/);

        // 8. Chia sẻ
        const shRes = await api(alice, 'POST', `/tasks/${t1.id}/share`);
        assert.ok(shRes.status === 200 || shRes.status === 201);
        const share = TaskShareResponseSchema.parse(await shRes.json());
        const noFollow = (p) => fetch(`${base}${p}`, { redirect: 'manual' });
        assert.equal((await noFollow(`/s/${share.token}`)).status, 302);
        const infoRes = await noFollow(`/s/${share.token}/info`);
        assert.equal(infoRes.status, 200);
        const info = ShareInfoResponseSchema.parse(await infoRes.json());
        assert.equal(info.mediaType, 'video');
        assert.equal(info.durationSeconds, 10);
        assert.equal((await noFollow(`/s/${share.token}/poster`)).status, 302);
        const revoke = await api(alice, 'DELETE', `/tasks/${t1.id}/share`);
        assert.equal(revoke.status, 200);
        for (const suffix of ['', '/info', '/poster']) {
          assert.equal((await noFollow(`/s/${share.token}${suffix}`)).status, 404, `sau thu hồi ${suffix}`);
        }

        // 2. NO_POSE
        assert.equal(await balance(bob), 500);
        rh.mode = 'no_pose';
        const t2 = await createMotion(bob, 0, 5, sample5);
        const failed = await waitFor(bob, t2.id, (t) => t.status === 'failed', 'failed NO_POSE');
        assert.equal(failed.reasonCode, 'NO_POSE');
        assert.equal(
          getReasonCodeMessageVi('NO_POSE', 'motion_control'),
          'Không nhận diện được chuyển động cơ thể trong video mẫu',
        );
        assert.equal(await balance(bob), 500, 'RELEASED 100%');
        assert.ok((await ledgerTypes(bob, t2.id)).includes('RELEASED'));

        // 3. Vượt Cap: Starter, trim 12 s
        const carol = await login('carol');
        await becomeTier(carol, admin, 'starter', 'MT-REF-2');
        const carolBal = await balance(carol);
        const capRes = await createMotionRaw(carol, 0, 12);
        assert.equal(capRes.status, 400);
        const capBody = await capRes.json();
        assert.equal(capBody.details.reason, 'TRIM_EXCEEDS_CAP');
        assert.equal(capBody.details.cap, 10);
        assert.equal(await balance(carol), carolBal, 'số dư không đổi');
        const carolLedger = WalletLedgerResponseSchema.parse(await (await api(carol, 'GET', '/wallet/ledger?pageSize=50')).json());
        assert.ok(!carolLedger.items.some((i) => ['HOLD', 'RELEASED', 'CAPTURED'].includes(i.type)), 'không bút toán HOLD');

        // 4. Ví FREE: 500 credit, hai video 5 s rồi video thứ ba
        rh.resultVideo = results[5];
        rh.mode = 'success';
        for (let i = 0; i < 2; i += 1) {
          const t = await createMotion(dave, 0, 5, sample5);
          assert.equal(t.price, 250);
          await waitFor(dave, t.id, (x) => x.status === 'succeeded', `FREE thành công ${i + 1}`);
        }
        assert.equal(await balance(dave), 0);
        const third = await createMotionRaw(dave, 0, 5, sample5);
        assert.equal(third.status, 402);
        assert.equal((await third.json()).code, 'INSUFFICIENT_CREDIT');
        assert.equal(await balance(dave), 0, 'không HOLD thứ ba');

        // 5. Hai Task song song
        const erin = await login('erin');
        await becomeTier(erin, admin, 'creator', 'MT-REF-3');
        rh.resultVideo = results[10];
        rh.mode = 'running';
        const [p1, p2] = await Promise.all([createMotion(erin, 0, 10), createMotion(erin, 1, 11)]);
        await waitFor(erin, p1.id, (t) => t.status === 'running', 'song song 1 running');
        await waitFor(erin, p2.id, (t) => t.status === 'running', 'song song 2 running');
        rh.mode = 'success';
        await waitFor(erin, p1.id, (t) => t.status === 'succeeded', 'song song 1');
        await waitFor(erin, p2.id, (t) => t.status === 'succeeded', 'song song 2');
        assert.ok(rh.maxActive <= 2);

        // 6. Quá hạn (RH_DEADLINE_MS = 25 s)
        const frank = await login('frank');
        await becomeTier(frank, admin, 'creator', 'MT-REF-4');
        const frankBal = await balance(frank);
        rh.mode = 'running';
        const t6 = await createMotion(frank, 0, 10);
        const timedOut = await waitFor(frank, t6.id, (t) => t.status === 'timed_out', 'timed_out', 120_000);
        assert.equal(timedOut.reasonCode, 'RH_TIMEOUT');
        assert.equal(await balance(frank), frankBal, 'RELEASED');
        assert.ok((await ledgerTypes(frank, t6.id)).includes('RELEASED'));
        const fetchesBefore = rh.fileFetches;
        rh.mode = 'success';
        await sleep(2500);
        assert.equal(rh.fileFetches, fetchesBefore, 'không tải kết quả đến muộn');
        const still = await waitFor(frank, t6.id, () => true, 'vẫn timed_out');
        assert.equal(still.status, 'timed_out', 'kết quả đến muộn bị bỏ qua');
        assert.equal(await balance(frank), frankBal);

        // 7. Lệch độ dài vẫn succeeded
        const gina = await login('gina');
        await becomeTier(gina, admin, 'creator', 'MT-REF-5');
        const ginaBal = await balance(gina);
        rh.mode = 'success';
        rh.resultVideo = results[10.4];
        const t7a = await createMotion(gina, 0, 10);
        await waitFor(gina, t7a.id, (t) => t.status === 'succeeded', '10,4 s succeeded');
        const ta = await ledgerTypes(gina, t7a.id);
        assert.ok(ta.includes('CAPTURED') && !ta.includes('RELEASED'));
        assert.equal(await balance(gina), ginaBal - 500, 'không hoàn phần lẻ');
        rh.resultVideo = results[10.6];
        const t7b = await createMotion(gina, 0, 10);
        const lenient = await waitFor(gina, t7b.id, (t) => t.status === 'succeeded', '10,6 s vẫn succeeded');
        assert.ok(!(await ledgerTypes(gina, t7b.id)).includes('RELEASED'));

        // Hợp đồng
        for (const t of Object.values(MOCK_MOTION_TASKS_BY_STATUS)) MotionCreateResponseSchema.parse(t);
        TaskResultResponseSchema.parse(MOCK_MOTION_RESULT_RESPONSE);
        ShareInfoResponseSchema.parse(MOCK_SHARE_INFO_VIDEO_RESPONSE);
        const mockKeys = new Set(Object.values(MOCK_MOTION_TASKS_BY_STATUS).flatMap((t) => Object.keys(t)));
        for (const t of [t1, done, failed, timedOut, lenient]) {
          for (const k of Object.keys(t)) assert.ok(mockKeys.has(k), `khóa Task thật lạ: ${k}`);
        }
        for (const k of Object.keys(result)) assert.ok(k in MOCK_MOTION_RESULT_RESPONSE, `khóa result lạ: ${k}`);
        for (const k of Object.keys(MOCK_MOTION_RESULT_RESPONSE)) assert.ok(k in result, `result thiếu khóa: ${k}`);

        // 9. Dọn dẹp thư mục tạm
        const listTmp = () =>
          compose([
            'exec', '-T', 'nestjs-worker', 'sh', '-c',
            'r="${TMPDIR:-/tmp}/flowvis-trim"; find "$r" -mindepth 1 -not -path "$r/ingest" 2>/dev/null; find "$r/ingest" -mindepth 1 2>/dev/null; true',
          ]).trim();
        const end = Date.now() + 20_000;
        let left = listTmp();
        while (left && Date.now() < end) {
          await sleep(1000);
          left = listTmp();
        }
        assert.equal(left, '', `còn thư mục tạm: ${left}`);

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
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  it('MOCK_MOTION_* và phản hồi BE cùng parse qua schema contracts (không cần Docker)', () => {
    for (const t of Object.values(MOCK_MOTION_TASKS_BY_STATUS)) {
      MotionCreateResponseSchema.parse(t);
      assert.equal(t.pipeline, 'motion_control');
    }
    TaskResultResponseSchema.parse(MOCK_MOTION_RESULT_RESPONSE);
    assert.equal(MOCK_MOTION_RESULT_RESPONSE.mediaType, 'video');
    assert.equal(MOCK_MOTION_RESULT_RESPONSE.sourceUrl, null);
    ShareInfoResponseSchema.parse(MOCK_SHARE_INFO_VIDEO_RESPONSE);
    assert.equal(motionPrice(10), 500);
    assert.equal(
      getReasonCodeMessageVi('NO_POSE', 'motion_control'),
      'Không nhận diện được chuyển động cơ thể trong video mẫu',
    );
  });
});
