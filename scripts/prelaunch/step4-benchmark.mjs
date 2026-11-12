#!/usr/bin/env node
// Bước 4: benchmark 20 mẫu qua API công khai bằng tài khoản benchmark (email trong BENCHMARK_USER_EMAILS,
// đã nạp gói Creator qua luồng nạp thật, bank_ref bắt đầu bằng BENCH-).
// Mỗi mẫu: upload -> confirm -> tạo Task -> poll tới khi kết thúc. Sau đó đọc gpu_coins/running_at/finished_at
// (CLI chỉ đọc prelaunch-task-metrics), đo độ dài video thật bằng ffprobe (nếu có), rồi gọi
// GET /admin/stats?scope=benchmark để đánh giá biên Creator (kịch bản nạp lẻ) và tỷ lệ lỗi kỹ thuật.
//
// Dùng: node scripts/prelaunch/step4-benchmark.mjs --manifest /đường/dẫn/ngoài-repo/manifest.json
//        [--sensitive] [--local-metrics] [--dry-run]
//   --sensitive: chỉ chạy các mẫu `"sensitive": true` (không tính vào 20 mẫu); chỉ ghi nhận, thoát 0 trừ khi lỗi chạy (2).
//   --local-metrics: chạy CLI đọc số liệu trên máy hiện tại (cần DATABASE_URL) thay vì trong container nestjs-worker.
//   --dry-run: chỉ kiểm tra manifest.
// Biến: PRELAUNCH_API_URL, PRELAUNCH_BENCH_JWT (access token tài khoản benchmark),
//       PRELAUNCH_ADMIN_JWT (access token Admin, đọc /admin/stats), ngưỡng PRELAUNCH_*.
// Access token hết hạn sau 15 phút. Nên đặt thêm PRELAUNCH_BENCH_REFRESH_TOKEN / PRELAUNCH_ADMIN_REFRESH_TOKEN
// (giá trị cookie `refreshToken`): script gọi POST /auth/refresh trước mỗi mẫu và trước /admin/stats, giữ token
// đã xoay vòng trong bộ nhớ (token cũ bị thu hồi sau lần gọi đầu).
// Thoát 0 đạt, 1 không đạt, 2 lỗi chạy (lỗi HTTP/upload/poll của bộ chạy, không đọc được số liệu).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXIT_ERROR,
  EXIT_FAIL,
  EXIT_PASS,
  TERMINAL_STATUSES,
  evaluateBenchmark,
  extractRawFailure,
  isHttpUrl,
  maskSecrets,
  mimeFromPath,
  missingEnv,
  sampleMetrics,
  validateManifest,
} from './lib.mjs';
import { REPO_ROOT, composeCommand, exec, fail, finish, flagValue, hasFlag, runApiCli, sleep, thresholdsOrExit } from './common.mjs';

const STEP = 'step4-benchmark';
const POLL_MS = 3000;
const TASK_TIMEOUT_MS = 15 * 60_000;
const thresholds = thresholdsOrExit(STEP);
const sensitiveMode = hasFlag('--sensitive');
const dryRun = hasFlag('--dry-run');

const manifestPath = flagValue('--manifest');
if (!manifestPath) fail(STEP, 'Thiếu --manifest <file JSON ngoài repo>.');
const absManifest = path.resolve(manifestPath);
if (!fs.existsSync(absManifest)) fail(STEP, `Manifest không tồn tại: ${absManifest}`);
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(absManifest, 'utf8'));
} catch {
  fail(STEP, 'Manifest không phải JSON hợp lệ.');
}
const checked = validateManifest(manifest, { baseDir: path.dirname(absManifest), repoRoot: REPO_ROOT, thresholds });
if (checked.errors.length > 0) fail(STEP, 'Manifest không hợp lệ.', { errors: checked.errors });
const queue = sensitiveMode ? checked.sensitive : checked.samples;
if (queue.length === 0) fail(STEP, sensitiveMode ? 'Manifest không có mẫu "sensitive": true.' : 'Manifest không có mẫu.');
for (const s of queue) {
  for (const f of Object.values(s.files)) if (!fs.existsSync(f)) fail(STEP, `File mẫu không tồn tại: ${f}`);
}
for (const w of checked.warnings) console.error(`Cảnh báo: ${w}`);
if (dryRun) finish(STEP, EXIT_PASS, { dryRun: true, samples: queue.length, warnings: checked.warnings });

if (hasFlag('--local-metrics') && missingEnv(['DATABASE_URL'], process.env).length > 0) {
  fail(STEP, 'Thiếu biến môi trường: DATABASE_URL (bắt buộc với --local-metrics).');
}
const required = sensitiveMode ? ['PRELAUNCH_API_URL', 'PRELAUNCH_BENCH_JWT'] : ['PRELAUNCH_API_URL', 'PRELAUNCH_BENCH_JWT', 'PRELAUNCH_ADMIN_JWT'];
const missing = missingEnv(required, process.env);
if (missing.length > 0) fail(STEP, `Thiếu biến môi trường: ${missing.join(', ')}.`);
if (!isHttpUrl(process.env.PRELAUNCH_API_URL)) fail(STEP, 'PRELAUNCH_API_URL không hợp lệ.');
const API = process.env.PRELAUNCH_API_URL.trim().replace(/\/+$/, '');
const POLL_RETRIES = 3;

/** Phiên theo vai trò: access token hiện hành + refresh token (đã xoay vòng) nếu có. */
const sessions = {
  bench: { access: process.env.PRELAUNCH_BENCH_JWT?.trim() ?? '', refresh: process.env.PRELAUNCH_BENCH_REFRESH_TOKEN?.trim() || null },
  admin: { access: process.env.PRELAUNCH_ADMIN_JWT?.trim() ?? '', refresh: process.env.PRELAUNCH_ADMIN_REFRESH_TOKEN?.trim() || null },
};
const issued = [];
const secrets = () => [
  ...Object.values(sessions).flatMap((x) => [x.access, x.refresh]),
  ...issued,
];

/** Lấy access token mới qua POST /auth/refresh (cookie refreshToken) nếu có refresh token; giữ token xoay vòng. */
async function refresh(role) {
  const sess = sessions[role];
  if (!sess.refresh) return;
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `refreshToken=${sess.refresh}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`POST /auth/refresh (${role}) HTTP ${res.status}: ${maskSecrets(text.slice(0, 300), secrets())}`);
    err.harness = true;
    throw err;
  }
  const rotated = res.headers
    .getSetCookie()
    .map((c) => /^refreshToken=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  if (rotated) {
    issued.push(sess.refresh);
    sess.refresh = decodeURIComponent(rotated);
  }
  const json = JSON.parse(text);
  if (typeof json?.accessToken === 'string') {
    issued.push(sess.access);
    sess.access = json.accessToken;
  }
}

async function api(role, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${sessions[role].access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // giữ text thô
  }
  if (!res.ok) {
    const err = new Error(`${method} ${route} HTTP ${res.status}: ${maskSecrets(text.slice(0, 500), secrets())}`);
    err.status = res.status;
    err.harness = true;
    throw err;
  }
  return json;
}

const bench = (m, r, b) => api('bench', m, r, b);

async function upload(file) {
  const bytes = fs.readFileSync(file);
  const up = await bench('POST', '/uploads', { mimeType: mimeFromPath(file), sizeBytes: bytes.length });
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers: up.headers, body: bytes, signal: AbortSignal.timeout(5 * 60_000) });
  if (!put.ok) throw Object.assign(new Error(`PUT upload HTTP ${put.status}`), { harness: true });
  const c = await bench('POST', `/uploads/${encodeURIComponent(up.key)}/confirm`);
  return c.key;
}

async function createTask(s) {
  if (s.pipeline === 'face_swap') {
    return bench('POST', '/tasks/face-swap', { sourceKey: await upload(s.files.source), targetKey: await upload(s.files.target) });
  }
  if (s.pipeline === 'body_retouch') {
    return bench('POST', '/tasks/body-retouch', { imageKey: await upload(s.files.image), intensity: s.intensity });
  }
  const body = {
    characterKey: await upload(s.files.character),
    videoKey: await upload(s.files.video),
    trimStart: s.trimStart,
    trimEnd: s.trimEnd,
  };
  if (s.aspectRatio) body.aspectRatio = s.aspectRatio;
  if (s.prompt) body.prompt = s.prompt;
  return bench('POST', '/tasks/motion', body);
}

async function waitDone(taskId) {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    let t;
    for (let attempt = 1; ; attempt++) {
      try {
        t = await bench('GET', `/tasks/${taskId}`);
        break;
      } catch (err) {
        // Lỗi tạm thời (mạng, 5xx, 429) thử lại vài lần; 401 thử làm mới token một lần.
        const transient = err.status == null || err.status >= 500 || err.status === 429 || err.status === 401;
        if (!transient || attempt >= POLL_RETRIES) throw err;
        if (err.status === 401) await refresh('bench');
        await sleep(POLL_MS * attempt);
      }
    }
    if (TERMINAL_STATUSES.includes(t.status)) return t;
    if (Date.now() > deadline) return { ...t, pollTimedOut: true };
    await sleep(POLL_MS);
  }
}

/** Độ dài thật của video kết quả: tải về thư mục tạm và ffprobe (null nếu máy không có ffprobe). */
async function measureOutputSeconds(taskId) {
  const r = await bench('GET', `/tasks/${taskId}/result`);
  const res = await fetch(r.resultUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvis-bench-'));
  const file = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const out = await new Promise((resolve) =>
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, stdout) =>
        resolve(err ? null : stdout),
      ),
    );
    const n = Number(String(out ?? '').trim());
    return out != null && Number.isFinite(n) ? n : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function workerLog(taskIds) {
  if (taskIds.length === 0 || hasFlag('--local-metrics')) return {};
  const c = composeCommand();
  const r = await exec(c.cmd, [...c.base, 'logs', '--no-color', '--since', '24h', 'nestjs-worker']);
  if (r.code !== 0) return {};
  return Object.fromEntries(taskIds.map((id) => [id, extractRawFailure(r.stdout, id)]));
}

const startedAt = new Date(Date.now() - 60_000).toISOString();
const runs = [];
for (const s of queue) {
  console.error(`Chạy ${s.id} (${s.pipeline})...`);
  let createdId = null;
  try {
    await refresh('bench');
    const created = await createTask(s);
    createdId = created.id;
    const task = await waitDone(created.id);
    runs.push({ sample: s, task });
  } catch (err) {
    // Lỗi của bộ chạy: giữ taskId (nếu đã tạo) để tra cứu, không tính là lỗi kỹ thuật của Task.
    runs.push({
      sample: s,
      task: createdId ? { id: createdId, status: null, reasonCode: null } : null,
      error: maskSecrets(err.message, secrets()),
      harnessError: true,
    });
  }
}

const taskIds = runs.filter((r) => r.task?.id).map((r) => r.task.id);
let metricsById = {};
let metricsError = null;
if (taskIds.length > 0) {
  const m = await runApiCli('prelaunch-task-metrics', taskIds, { useCompose: !hasFlag('--local-metrics') });
  if (m.json?.tasks) metricsById = Object.fromEntries(m.json.tasks.map((t) => [t.id, t]));
  if (m.spawnError || !m.json?.tasks || m.code !== 0) {
    metricsError = m.spawnError ?? `prelaunch-task-metrics thoát ${m.code}${m.json?.error ? ` (${m.json.error})` : ''}`;
    console.error(`Không đọc được gpu_coins/mốc thời gian: ${metricsError}`);
  }
}

// Làm mới token trước khi tải kết quả video (đo độ dài) vì có thể đã quá 15 phút từ lần làm mới cuối.
await refresh('bench').catch((err) => console.error(maskSecrets(err.message, secrets())));
const results = [];
for (const r of runs) {
  const metrics = r.task ? { ...(metricsById[r.task.id] ?? {}) } : {};
  if (r.harnessError) metrics.harnessError = true;
  if (r.task?.status === 'succeeded' && r.sample.pipeline === 'motion_control') {
    metrics.outputSeconds = await measureOutputSeconds(r.task.id).catch(() => null);
  }
  const row = sampleMetrics(r.sample, r.task, metrics, thresholds);
  if (r.error) row.error = r.error;
  if (r.task?.pollTimedOut) row.pollTimedOut = true;
  results.push(row);
}

const failedIds = results.filter((r) => r.taskId && r.status !== 'succeeded').map((r) => r.taskId);
const rawLogs = await workerLog(failedIds);
for (const r of results) if (r.taskId && rawLogs[r.taskId]?.length) r.rawFailure = rawLogs[r.taskId];

// Mỗi lượt một dòng JSON (stderr) để dán vào báo cáo; dòng tổng hợp cuối cùng ở stdout.
for (const r of results) console.error(JSON.stringify(r));

const harnessErrors = results.filter((r) => r.harnessError).map((r) => r.id);
// Lỗi chạy: bộ chạy lỗi HTTP/upload/poll hoặc không đọc được số liệu -> thoát 2, không kết luận đạt/không đạt.
const runError = harnessErrors.length > 0 || metricsError != null;

if (sensitiveMode) {
  finish(STEP, runError ? EXIT_ERROR : EXIT_PASS, {
    mode: 'sensitive',
    harnessErrors,
    ...(metricsError ? { metricsError } : {}),
    results,
    note: 'Ghi nguyên văn chuỗi lỗi (đã loại nội dung nhạy cảm) vào docs/runninghub-api-notes.md; không tính vào 20 mẫu.',
  });
}

let stats = null;
let statsError = null;
try {
  await refresh('admin');
  const q = new URLSearchParams({ from: startedAt, to: new Date().toISOString(), scope: 'benchmark' });
  stats = await api('admin', 'GET', `/admin/stats?${q}`);
} catch (err) {
  statsError = maskSecrets(err.message, secrets());
}

const verdict = evaluateBenchmark(results, stats, thresholds);
const code = runError || statsError ? EXIT_ERROR : verdict.pass ? EXIT_PASS : EXIT_FAIL;
finish(STEP, code, {
  ...verdict,
  statsWindow: stats ? { from: stats.from, to: stats.to, scope: stats.scope } : null,
  ...(statsError ? { statsError } : {}),
  ...(metricsError ? { metricsError } : {}),
  results,
});
