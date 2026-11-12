---
title: 'Story 6.11: [OPS] Cổng trước khi bật VietQR thương mại'
type: 'chore'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
baseline_commit: 'bc6768a6b2c107ce5bdd9909a73b579389855552'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chưa có công cụ nào kiểm chứng kinh tế đơn vị và hạ tầng thật (Discord, ffmpeg trên VPS, endpoint RunningHub, benchmark 20 mẫu, khôi phục DB) trước khi bật VietQR thương mại; ánh xạ `CONTENT_BLOCKED` còn rỗng.

**Approach:** Phần AI: viết `scripts/prelaunch/` (một lệnh cho mỗi bước trong 5 bước), CLI phụ trợ trong `apps/api`, `docs/prelaunch-checklist.md`, mẫu `docs/prelaunch-report.md`, khung `docs/runninghub-api-notes.md`, và ghi chú README "không bật VietQR thương mại khi còn dòng chưa đạt". Phần người vận hành (chạy với RunningHub/VPS/Discord thật, điền báo cáo, PM ký) nằm ngoài lượt build này.

## Boundaries & Constraints

**Always:** Mọi bí mật (khóa API, webhook, JWT, DATABASE_URL) đọc từ biến môi trường, thiếu thì thoát mã ≠ 0 với thông báo tiếng Việt. Bước 2 dùng đúng `buildFfmpegArgs` của Story 5.4 (import từ `dist`), không chép lại đối số. Script in kết quả JSON một dòng để dán vào báo cáo; mã thoát 0 = đạt, 1 = không đạt, 2 = lỗi chạy. Phần thuần (parse, tính toán ngưỡng) có unit test chạy trong `pnpm test`.

**Quyết định (người dùng, 2026-11-12):** (1) Giữ spec đầy đủ 5 bước trong một story, chấp nhận vượt 1600 token. (2) Sau lượt build: spec `done`, sprint-status `6-11` → `review`, Implementation Notes ghi rõ phần người vận hành còn mở; story chưa hoàn tất theo AC cho tới khi PM ký báo cáo. (3) Giữ các ngưỡng `[ASSUMPTION]` của epic làm mặc định (cắt ≤ 60 s, `/health` p95 < 1 s, `intensity` 3,3,5,5,8, biên Creator ≥ 70% theo kịch bản nạp lẻ), cho ghi đè bằng biến môi trường.

**Never:** Không commit ảnh/video mẫu hay ảnh nhạy cảm; không thêm giá trị `ApiErrorCode`; không đổi kiến trúc hay giá (`PRICING_CONFIG`); không đoán chuỗi lỗi RunningHub thật — `RH_CONTENT_BLOCKED_PREFIXES` giữ rỗng cho tới khi người vận hành ghi chuỗi thật; không thêm endpoint hủy task; không sửa `terms.ts`/`privacy.ts` sang `final`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bước 1 Discord | `DISCORD_WEBHOOK_URL` hợp lệ | Gửi 1 tin qua `DiscordNotifierAdapter`, in `{ok, latencyMs}`; đạt nếu ≤ 10 s | Thiếu/không hợp lệ URL → exit 2, không rơi về `LogNotifierAdapter` |
| Bước 2 ffmpeg | Clip 20 s 1080p trên VPS | In thời gian cắt, CPU/đĩa tạm cao nhất, p95 `/health`, số lần restart/OOM; đạt khi cắt ≤ 60 s, p95 < 1 s, 0 restart | Clip không tồn tại → exit 2 |
| Bước 3 RunningHub | `RUNNINGHUB_API_KEY`, `RH_BALANCE_ENDPOINT` | In host, endpoint, HTTP status và phản hồi thô (đã che khóa) để chép vào `runninghub-api-notes.md` | Lỗi HTTP → ghi nguyên văn, exit 1 |
| Bước 4 benchmark | Manifest JSON 20 mẫu (đường dẫn ngoài repo) + JWT tài khoản benchmark | Tạo Task qua API công khai, chờ xong, in mỗi lượt `gpu_coins`, giây GPU = coins/0,4, giây GPU/giây video, sai số độ dài (±0,5 s), `running_at→finished_at`, rồi gọi `/admin/stats?scope=benchmark` đánh giá biên Creator ≥ 70% và 0% lỗi kỹ thuật | Task `failed` ghi `reasonCode` + chuỗi lỗi thô; mẫu nhạy cảm chạy cờ riêng, không tính vào 20 |
| Bước 5 khôi phục | DB thật | Gọi sao lưu thủ công lên R2 rồi `restore-drill`, in thời gian khôi phục (RTO) | Drill fail → exit 1 |

</frozen-after-approval>

## Code Map

- `apps/api/src/ports/index.ts` -- `NotifierPort` (dòng 125-132), `RunningHubPort.getBalance` (57); không có cancel
- `apps/api/src/modules/ops/discord-notifier.adapter.ts` -- `DiscordNotifierAdapter` dùng trực tiếp ở CLI bước 1
- `apps/api/src/scripts/reconcile.ts` -- mẫu CLI bootstrap Nest (`MOTION_PROCESS_ROLE='script'`, exit 0/1/2); `restore-drill.ts` mẫu CLI không Nest
- `apps/api/src/modules/tasks/video-trim.service.ts:82` -- `buildFfmpegArgs`, chạy với `nice -n 19 ffmpeg` (dòng 259)
- `apps/api/src/modules/tasks/runninghub-openapi.adapter.ts:232` -- `getBalance` đọc `data.remainCoins|data.coins|coins`; host `RUNNINGHUB_API_HOST`
- `apps/api/src/modules/pipelines/pipeline-config.ts:97-127` -- `RH_FAILURE_PREFIX_MAP`, `RH_BUDGET_KEYWORDS`, `RH_CONTENT_BLOCKED_PREFIXES=[]`, `mapRunningHubFailure`
- `apps/api/src/modules/ops/backup.service.ts:69` -- `backup(now)` công khai; chưa có trigger thủ công
- `apps/api/src/modules/admin-stats/` + `packages/contracts/src/ops.ts:58` -- `AdminStatsQuerySchema` (`scope`, `motionPricePerSecond`, `imagePrice` cho Kế hoạch B)
- `apps/api/src/modules/wallet/tier.ts:12` -- `PRICING_CONFIG` (gói Creator 199k/30.000)
- `apps/web/scripts/check-legal-release.mjs` -- cổng `status: 'draft'` cho `/terms`, `/privacy`; checklist tham chiếu
- `deploy/.env.example` -- thiếu `RH_*`, `BENCHMARK_USER_EMAILS`, `NUXT_PUBLIC_REPORT_EMAIL`
- Root `package.json` -- `lint` quét `scripts/`; `test` liệt kê file test tường minh (phải thêm test mới)

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/scripts/prelaunch-notify.ts` -- gửi tin thử Discord, đo độ trễ -- bước 1
- [x] `apps/api/src/scripts/prelaunch-trim.ts` -- cắt clip bằng `buildFfmpegArgs`, in thời gian -- bước 2
- [x] `apps/api/src/scripts/prelaunch-rh-probe.ts` -- gọi endpoint số dư, in phản hồi thô đã che khóa -- bước 3
- [x] `apps/api/src/scripts/backup-now.ts` -- bootstrap Nest, gọi `BackupService.backup()` -- bước 5
- [x] `scripts/prelaunch/{step1-discord,step2-ffmpeg,step3-runninghub,step4-benchmark,step5-restore}.mjs` + `lib.mjs` (hàm thuần: p95, giây GPU, đánh giá ngưỡng, che bí mật) -- một lệnh mỗi bước
- [x] `scripts/prelaunch/lib.test.mjs` + thêm vào `test` gốc -- unit test ngưỡng/biên/che bí mật
- [x] `scripts/prelaunch/benchmark-manifest.example.json` -- mẫu 20 mục + mục nhạy cảm tùy chọn
- [x] `docs/prelaunch-checklist.md`, `docs/prelaunch-report.md` (cột kết quả, ngày, người chạy; mục PM ký), `docs/runninghub-api-notes.md` (khung)
- [x] `deploy/.env.example` -- bổ sung biến còn thiếu
- [x] `README.md` -- mục "Cổng trước khi bật VietQR thương mại": cách chạy 5 bước và cảnh báo không bật khi còn dòng chưa đạt

**Acceptance Criteria:**
- Given `grep` toàn bộ `scripts/prelaunch/` và CLI mới, when tìm khóa/URL webhook, then không có giá trị bí mật nào
- Given `pnpm run lint && pnpm run typecheck && pnpm test`, when chạy ở gốc, then pass

## Implementation Notes

- **Phần AI đã xong (lượt build 2026-11-12).** CLI mới trong `apps/api/src/scripts/`: `prelaunch-notify.ts` (bước 1, dùng thẳng `DiscordNotifierAdapter`, không rơi về adapter log), `prelaunch-trim.ts` (bước 2, `nice -n 19 ffmpeg` + `buildFfmpegArgs` + `evaluateTrimmedProbe` import từ `video-trim.service`, chạy từ `dist`), `prelaunch-rh-probe.ts` (bước 3, POST như adapter thật, che khóa, rồi gọi `RunningHubOpenApiAdapter.getBalance()`), `backup-now.ts` (bước 5, bootstrap Nest, `BackupService.backup()`), và thêm `prelaunch-task-metrics.ts` (bước 4, chỉ SELECT `gpu_coins`/`queued_at`/`running_at`/`finished_at` vì API công khai không trả các cột này; không ghi bảng nào nên không vi phạm AD-1).
- `scripts/prelaunch/`: `lib.mjs` (hàm thuần), `common.mjs` (chạy lệnh/compose/in JSON), `step1…step5`, `benchmark-manifest.example.json`, `lib.test.mjs` (33 test, đã thêm vào `test` gốc). Mỗi script in một dòng JSON ở stdout; mã thoát 0/1/2.
- Bước 4: chạy mẫu tuần tự qua API công khai (`/uploads` → PUT → confirm → `/tasks/*` → poll `/tasks/{id}`), đo độ dài video Motion thật bằng `ffprobe` cục bộ, đọc chuỗi lỗi thô từ `docker compose logs nestjs-worker` cho Task không thành công, rồi `/admin/stats?scope=benchmark` (cửa sổ từ lúc bắt đầu chạy). "Lỗi kỹ thuật" = mọi kết thúc không thành công trừ `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `USER_CANCEL`, `FREE_WAIT_EXPIRED`. Sai số độ dài ±0,5 s cũng là điều kiện đạt; SLA Face Swap chỉ ghi nhận.
- Ngưỡng `[ASSUMPTION]` là mặc định, ghi đè bằng `PRELAUNCH_*` (liệt kê trong `deploy/.env.example`).
- Không đổi `ApiErrorCode`, `PRICING_CONFIG`, `RH_CONTENT_BLOCKED_PREFIXES` (vẫn rỗng), `terms.ts`/`privacy.ts`; không thêm endpoint hủy.
- **Phần người vận hành còn mở:** chạy 5 bước với Discord/VPS/RunningHub thật, điền `docs/prelaunch-report.md` và `docs/runninghub-api-notes.md`, duyệt mục thủ công, điền chuỗi lỗi thật vào ánh xạ (story riêng kèm fixture), cập nhật spine/PRD/`.memlog.md`, PM ký. Story chưa hoàn tất theo AC cho tới khi PM ký báo cáo.
- Kiểm chứng: lint, typecheck pass; `scripts/prelaunch/lib.test.mjs` pass; chạy thử bước 1 và 3 với server giả cục bộ (đạt/không đạt/che khóa đúng), CLI cắt với clip 22 s 1080p sinh bằng ffmpeg (2 s, probe đạt), các trường hợp thiếu env/thiếu file thoát 2. Bước 2 (docker trên VPS), 4, 5 chưa chạy thật đầu-cuối.
- Sau review (13 bản vá): bước 4 làm mới token qua `PRELAUNCH_*_REFRESH_TOKEN`, lỗi harness → exit 2 (không tính lỗi kỹ thuật), độ dài chưa đo được → không đạt, lỗi metrics → exit 2; `diffInspect` so `StartedAt` và OOM trước/sau; step2 `chmod`/`rm` bằng root; thêm `apps/api/test/prelaunch-cli.test.mjs`. Kiểm lại: lint, typecheck, test gốc 53/53, `prelaunch-cli` 3/3, ranh giới nhánh pass. Chưa chạy trọn `pnpm test` của `apps/api`/`apps/web` (môi trường DB/worker cục bộ; xem báo cáo cài đặt).
- Câu hỏi mở cho PM: sai số độ dài Motion ±0,5 s hiện là điều kiện chặn của bước 4 (epic chỉ ghi "ngưỡng"); đổi thành chỉ ghi nhận nếu PM muốn.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence |
|---------|---------|----------|
| Bước 4 dùng JWT cố định, access token hết hạn 15 phút; chạy 20 mẫu tuần tự (cả `/admin/stats` cuối) chắc chắn quá 15 phút → 401 | high → patch | `auth.module.ts:35` `expiresIn: 900`; `POST /auth/refresh` đọc cookie `refreshToken` và xoay vòng (`auth.controller.ts:177-195`). Sửa gọn trong `step4-benchmark.mjs` (biến refresh token, làm mới trước mỗi mẫu và trước `/admin/stats`), không thêm bề mặt API. |
| Lỗi harness (401, 5xx khi poll, PUT lỗi) tính là lỗi kỹ thuật; `waitDone` ném thì mất `taskId` của Task đã tạo | medium → patch | `step4-benchmark.mjs` push `task: null` → `sampleMetrics` đặt `technicalFailure: true`. |
| Thiếu `ffprobe`/tải kết quả lỗi → `durationOk = null` → điều kiện ±0,5 s vẫn đạt | medium → patch | `evaluateBenchmark` chỉ lọc `durationOk === false`. |
| `--local-metrics` thiếu `DATABASE_URL`/CLI metrics lỗi → `gpu_coins` null im lặng, bước vẫn có thể đạt | medium → patch | `step4-benchmark.mjs` chỉ `console.error` khi `m.json?.tasks` rỗng; AC bắt buộc ghi `gpu_coins`. |
| `diffInspect`: OOM cũ trước khi đo bị tính; container tạo lại (RestartCount về 0) không bị tính | medium → patch | `lib.mjs` `diffInspect` không so `before.oomKilled`, khóa theo tên không theo id. |
| `docker cp` tạo file root, worker chạy `USER node`; file host 0600 không đọc được, `rm` trong `/tmp` sticky lỗi | medium → patch | `deploy/Dockerfile:40` `USER node`; `step2-ffmpeg.mjs` `cp` rồi `exec rm` không `-u root`. |
| Test "step3/step4 thiếu env" không chạm tới kiểm tra env của step4 (thoát 2 ở `--manifest`) | medium → patch | `lib.test.mjs` gọi step4 không đối số; reviewer chạy lại xác nhận. |
| Hợp đồng JSON giữa CLI `apps/api` và script bước không có test thực thi | medium → patch | Không test nào chạy `dist/scripts/prelaunch-*.js`. |
| Chú thích `NON_TECHNICAL_REASONS` nói trùng danh sách ngắt mạch nhưng khác (`RH_BUDGET`, `RH_GATE_TIMEOUT`) | low → patch | `tasks.service.ts:48-58` `SYSTEM_FAILURE_REASONS`; sửa chú thích (benchmark cố ý nghiêm hơn). |
| `docker stats --no-stream` thực tế ~3 s/mẫu, tài liệu ghi "mỗi giây" | low → patch | Sửa câu chữ trong chú thích và checklist. |
| README "mã thoát 0/1/2 mọi script" nhưng `--sensitive` luôn thoát 0 | low → patch | Ghi rõ trong README/checklist. |
| `.env.example` liệt kê `RH_DEADLINE_MS` nhưng chỉ có tác dụng khi `NODE_ENV=test` | low → patch | `task-worker.service.ts:30-34`; xóa dòng. |
| Báo cáo cố định "coins/0,4", thiếu dòng đơn giá coin/giây thật trong ghi chú RH | low → patch | Thêm dòng vào `runninghub-api-notes.md`. |
| Ổn định hợp đồng `/admin/stats` (fixture không gắn `@flowvis/contracts`) | low → defer | Thất bại kiểu fail-closed (FAIL giả, không PASS giả). |
| `manualReviewPending` không chặn exit 0 | low → reject | Đã liệt kê trong JSON và bảng điều kiện của báo cáo; người vận hành điền tay. |
| Cửa sổ `/admin/stats` có thể lẫn Task khác của tài khoản benchmark | low → reject | Tài khoản chỉ dùng cho benchmark; cửa sổ bắt đầu từ lượt chạy này. |
| `backup-now` có thể đụng job 03:00; drill có thể khôi phục bản khác | low → reject | Drill lấy key mới nhất = bản vừa tạo; chạy tay ngoài 03:00. |
| `prelaunch-task-metrics` bỏ query `sslmode`/`schema` của `DATABASE_URL` | low → reject | Triển khai dùng PostgreSQL container nội bộ, không SSL/schema riêng. |
| Manifest vượt giới hạn dung lượng/độ dài server | low → reject | Sau bản vá lỗi harness thành lỗi chạy (exit 2), không còn tính sai thành lỗi kỹ thuật. |
| `maskSecrets` trên JSON đã serialize có thể làm hỏng escape | low → reject | Chỉ khi phản hồi RH chứa URL webhook Discord; không thực tế. |
| step5 `--local` thiếu `R2_ENDPOINT` thoát 1 thay vì 2; drill bị kill sau 15 phút; timeout notify cố định 10 s; kiểm tra miền giá trị ngưỡng | low → reject | Ít gặp, sửa cần thêm nhánh. |
| Không chặn commit báo cáo đã điền/manifest | low → reject | Tài liệu đã yêu cầu che bí mật và để mẫu ngoài repo. |

## Design Notes

Bước 2 chạy trên host VPS: script `.mjs` gọi `docker compose exec nestjs-worker node apps/api/dist/scripts/prelaunch-trim.js`, song song lấy mẫu `docker stats --no-stream` mỗi giây, `curl /health` mỗi 200 ms, và đọc `RestartCount`/`OOMKilled` qua `docker inspect` trước và sau. Bước 4 dùng `fetch` của Node, không thêm dependency.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm test` -- expected: exit 0
- `node scripts/prelaunch/step1-discord.mjs` (không có env) -- expected: exit 2, thông báo thiếu biến
