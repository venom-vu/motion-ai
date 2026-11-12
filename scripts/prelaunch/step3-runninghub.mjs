#!/usr/bin/env node
// Bước 3: gọi endpoint số dư RunningHub (RH_BALANCE_ENDPOINT) như adapter thật, in host, endpoint, HTTP status
// và phản hồi thô đã che khóa để chép vào docs/runninghub-api-notes.md.
// Dùng: node scripts/prelaunch/step3-runninghub.mjs [--compose]
// Biến: RUNNINGHUB_API_KEY, RH_BALANCE_ENDPOINT, RUNNINGHUB_API_HOST (tùy chọn).
// Thoát 0 đạt, 1 lỗi HTTP/phản hồi không đọc được (ghi nguyên văn), 2 thiếu cấu hình.
// Không có endpoint hủy task trong RunningHubPort: ghi chú điều đó trong runninghub-api-notes.md, không thêm code hủy.
import { EXIT_ERROR, EXIT_FAIL, EXIT_PASS, maskSecrets, missingEnv } from './lib.mjs';
import { fail, finish, hasFlag, runApiCli } from './common.mjs';

const STEP = 'step3-runninghub';
const useCompose = hasFlag('--compose');

if (!useCompose) {
  const missing = missingEnv(['RUNNINGHUB_API_KEY', 'RH_BALANCE_ENDPOINT'], process.env);
  if (missing.length > 0) fail(STEP, `Thiếu biến môi trường: ${missing.join(', ')}.`);
}

const r = await runApiCli('prelaunch-rh-probe', [], { useCompose, service: 'nestjs-worker' });
if (r.spawnError) fail(STEP, r.spawnError);
if (!r.json || r.code === EXIT_ERROR) fail(STEP, 'CLI prelaunch-rh-probe lỗi cấu hình hoặc không in kết quả.', { cli: r.json });

// Che lần nữa phòng khi khóa xuất hiện ở dạng khác (CLI đã che).
const data = JSON.parse(maskSecrets(JSON.stringify(r.json), [process.env.RUNNINGHUB_API_KEY]));
finish(STEP, r.code === 0 && data.ok === true ? EXIT_PASS : EXIT_FAIL, data);
