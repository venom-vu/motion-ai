#!/usr/bin/env node
// Bước 1: gửi tin thử Discord qua DiscordNotifierAdapter (CLI apps/api), đạt khi nhận trong ngưỡng (mặc định 10 s).
// Dùng: node scripts/prelaunch/step1-discord.mjs [--compose]
//   --compose: chạy CLI trong container nestjs-worker (dùng DISCORD_WEBHOOK_URL của container).
// Thoát 0 đạt, 1 không đạt, 2 lỗi chạy (thiếu/sai DISCORD_WEBHOOK_URL, chưa build...).
import { EXIT_ERROR, EXIT_FAIL, EXIT_PASS, evaluateDiscord, isHttpUrl, missingEnv } from './lib.mjs';
import { fail, finish, hasFlag, runApiCli, thresholdsOrExit } from './common.mjs';

const STEP = 'step1-discord';
const thresholds = thresholdsOrExit(STEP);
const useCompose = hasFlag('--compose');

if (!useCompose) {
  if (missingEnv(['DISCORD_WEBHOOK_URL'], process.env).length > 0) {
    fail(STEP, 'Thiếu biến môi trường DISCORD_WEBHOOK_URL (URL webhook Discord thật, không commit).');
  }
  if (!isHttpUrl(process.env.DISCORD_WEBHOOK_URL)) {
    fail(STEP, 'DISCORD_WEBHOOK_URL không hợp lệ (cần URL http/https).');
  }
}

const r = await runApiCli('prelaunch-notify', [], { useCompose });
if (r.spawnError) fail(STEP, r.spawnError);
if (!r.json || r.code === EXIT_ERROR) fail(STEP, 'CLI prelaunch-notify lỗi cấu hình hoặc không in kết quả.', { cli: r.json });

const verdict = evaluateDiscord(r.json, thresholds);
finish(STEP, verdict.pass ? EXIT_PASS : EXIT_FAIL, {
  ok: r.json.ok,
  latencyMs: r.json.latencyMs,
  maxMs: verdict.maxMs,
  ...(r.json.error ? { cliError: r.json.error } : {}),
  note: 'Người vận hành xác nhận tin đã hiện trong kênh Discord và ghi vào docs/prelaunch-report.md.',
});
