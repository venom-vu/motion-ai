#!/usr/bin/env node
// Bước 2: chạy trên host VPS. Cắt clip nguồn (mặc định 20 s, 1080p) bằng đúng lệnh sản xuất của Story 5.4
// trong container nestjs-worker, song song lấy mẫu `docker stats --no-stream` liên tục (mỗi lần gọi tự mất ~2 s,
// nên thực tế mỗi 2–3 s một mẫu), `GET /health` mỗi 200 ms, và so `RestartCount`/`StartedAt`/`OOMKilled`
// (docker inspect) trước và sau.
// Dùng: node scripts/prelaunch/step2-ffmpeg.mjs <clip.mp4> [--start 0] [--seconds 20] [--service nestjs-worker]
// Biến: PRELAUNCH_COMPOSE (mặc định "docker compose -f deploy/compose.yml --env-file deploy/.env"),
//       PRELAUNCH_HEALTH_URL (mặc định http://127.0.0.1:${PORT:-3001}/health), ngưỡng PRELAUNCH_*.
// Thoát 0 đạt, 1 không đạt, 2 lỗi chạy (clip không tồn tại, docker lỗi...).
import fs from 'node:fs';
import path from 'node:path';
import {
  EXIT_FAIL,
  EXIT_PASS,
  INSPECT_FORMAT,
  diffInspect,
  evaluateTrim,
  parseInspectLines,
  summarizeDockerStats,
} from './lib.mjs';
import { composeCommand, exec, fail, finish, flagValue, positionalArgs, runApiCli, sleep, thresholdsOrExit } from './common.mjs';

const STEP = 'step2-ffmpeg';
const thresholds = thresholdsOrExit(STEP);
const [clipArg] = positionalArgs();
const start = Number(flagValue('--start') ?? 0);
const seconds = Number(flagValue('--seconds') ?? 20);
const service = flagValue('--service') ?? 'nestjs-worker';
const healthUrl = process.env.PRELAUNCH_HEALTH_URL || `http://127.0.0.1:${process.env.PORT || 3001}/health`;

if (!clipArg) fail(STEP, 'Thiếu đường dẫn clip nguồn (ví dụ clip 20 giây 1080p, để ngoài repo).');
const clip = path.resolve(clipArg);
if (!fs.existsSync(clip) || !fs.statSync(clip).isFile()) fail(STEP, `Clip không tồn tại: ${clip}`);
if (!Number.isInteger(start) || start < 0 || !Number.isInteger(seconds) || seconds <= 0) {
  fail(STEP, '--start/--seconds phải là số nguyên giây hợp lệ.');
}

const compose = composeCommand();
const docker = (args, opts) => exec('docker', args, opts);

async function containerIds() {
  const r = await exec(compose.cmd, [...compose.base, 'ps', '-q']);
  if (r.code !== 0) fail(STEP, `Không liệt kê được container: ${r.stderr.trim() || r.spawnError}`);
  const ids = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) fail(STEP, 'Không có container nào đang chạy trong stack compose.');
  return ids;
}

async function inspect(ids) {
  const r = await docker(['inspect', '--format', INSPECT_FORMAT, ...ids]);
  if (r.code !== 0) fail(STEP, `docker inspect lỗi: ${r.stderr.trim() || r.spawnError}`);
  return parseInspectLines(r.stdout);
}

const ids = await containerIds();
const before = await inspect(ids);

// Đưa clip vào container worker (thư mục tạm, xóa sau khi đo).
const remoteClip = `/tmp/prelaunch-clip-${Date.now()}${path.extname(clip) || '.mp4'}`;
const cp = await exec(compose.cmd, [...compose.base, 'cp', clip, `${service}:${remoteClip}`]);
if (cp.code !== 0) fail(STEP, `Không chép được clip vào ${service}: ${cp.stderr.trim() || cp.spawnError}`);
// `compose cp` giữ uid/quyền của host; worker chạy USER node nên cấp quyền đọc bằng root.
const chmod = await exec(compose.cmd, [...compose.base, 'exec', '-T', '-u', 'root', service, 'chmod', '644', remoteClip]);
if (chmod.code !== 0) fail(STEP, `Không cấp quyền đọc clip trong ${service}: ${chmod.stderr.trim() || chmod.spawnError}`);

let running = true;
const statsSamples = [];
const healthLatenciesMs = [];
let healthErrors = 0;

const statsLoop = (async () => {
  while (running) {
    const r = await docker(['stats', '--no-stream', '--format', '{{json .}}', ...ids], { timeoutMs: 10_000 });
    if (r.code === 0) {
      const rows = r.stdout.split('\n').filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      statsSamples.push(rows);
    }
    await sleep(250);
  }
})();

const healthLoop = (async () => {
  while (running) {
    const t0 = performance.now();
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      await res.arrayBuffer();
      if (res.ok) healthLatenciesMs.push(Math.round(performance.now() - t0));
      else healthErrors++;
    } catch {
      healthErrors++;
    }
    await sleep(200);
  }
})();

let cli;
try {
  cli = await runApiCli('prelaunch-trim', [remoteClip, '--start', String(start), '--seconds', String(seconds)], {
    useCompose: true,
    service,
  });
} finally {
  running = false;
  await Promise.all([statsLoop, healthLoop]);
  await exec(compose.cmd, [...compose.base, 'exec', '-T', '-u', 'root', service, 'rm', '-f', remoteClip]);
}

if (cli.spawnError) fail(STEP, cli.spawnError);
if (!cli.json) fail(STEP, `CLI prelaunch-trim không in kết quả (mã ${cli.code}).`);
if (cli.code === 2) fail(STEP, `CLI prelaunch-trim lỗi đầu vào: ${cli.json.error ?? ''}`, { cli: cli.json });

const after = await inspect(await containerIds());
const { restarts, oomKilled } = diffInspect(before, after);
const verdict = evaluateTrim(
  { trimOk: cli.json.ok === true, trimMs: cli.json.trimMs, healthLatenciesMs, healthErrors, restarts, oomKilled },
  thresholds,
);

finish(STEP, verdict.pass ? EXIT_PASS : EXIT_FAIL, {
  clip: path.basename(clip),
  start,
  seconds,
  trimMs: cli.json.trimMs,
  trimMaxMs: thresholds.trimMaxSeconds * 1000,
  probeOk: cli.json.probeOk,
  outputDurationSeconds: cli.json.durationSeconds,
  maxTmpBytes: cli.json.maxTmpBytes,
  freeBytesBefore: cli.json.freeBytesBefore,
  containers: summarizeDockerStats(statsSamples),
  statsSamples: statsSamples.length,
  healthSamples: healthLatenciesMs.length,
  healthErrors,
  healthP95Ms: verdict.healthP95Ms,
  healthP95MaxMs: thresholds.healthP95MaxMs,
  restarts,
  oomKilled,
  checks: verdict.checks,
  ...(cli.json.error ? { cliError: cli.json.error } : {}),
});
