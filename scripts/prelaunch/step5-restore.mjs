#!/usr/bin/env node
// Bước 5: sao lưu thủ công PostgreSQL lên R2 (BackupService của Story 6.7) rồi chạy restore-drill
// vào CSDL tạm; in thời gian khôi phục (RTO ban đầu).
// Dùng trên VPS: node scripts/prelaunch/step5-restore.mjs [--local]
//   mặc định chạy trong container nestjs-worker (có pg_dump/pg_restore 16 và biến R2/DATABASE_URL);
//   --local: chạy `node apps/api/dist/scripts/...` trên máy hiện tại (cần DATABASE_URL, R2_*).
// Thoát 0 đạt, 1 sao lưu hoặc drill thất bại, 2 lỗi chạy.
import { EXIT_FAIL, EXIT_PASS, missingEnv } from './lib.mjs';
import { fail, finish, hasFlag, runApiCli } from './common.mjs';

const STEP = 'step5-restore';
const useCompose = !hasFlag('--local');

if (!useCompose) {
  const missing = missingEnv(['DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'], process.env);
  if (missing.length > 0) fail(STEP, `Thiếu biến môi trường: ${missing.join(', ')}.`);
}

const backup = await runApiCli('backup-now', [], { useCompose });
if (backup.spawnError) fail(STEP, backup.spawnError);
if (!backup.json) fail(STEP, `backup-now không in kết quả (mã ${backup.code}).`);
if (backup.code === 2) fail(STEP, 'backup-now lỗi khởi động (xem stderr).', { backup: backup.json });
if (backup.json.ok !== true) {
  finish(STEP, EXIT_FAIL, { backup: backup.json, drill: null, rtoMs: null });
}

const t0 = Date.now();
const drill = await runApiCli('restore-drill', [], { useCompose });
const wallMs = Date.now() - t0;
if (drill.spawnError) fail(STEP, drill.spawnError);
if (!drill.json) fail(STEP, `restore-drill không in kết quả (mã ${drill.code}).`);

const pass = drill.code === 0 && drill.json.ok === true;
finish(STEP, pass ? EXIT_PASS : EXIT_FAIL, {
  backup: backup.json,
  drill: drill.json,
  // RTO ban đầu: thời gian khôi phục + đối soát do restore-drill tự đo; wallMs gồm cả khởi động tiến trình.
  rtoMs: drill.json.durationMs ?? null,
  wallMs,
});
