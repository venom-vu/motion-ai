---
title: 'Story 5.9: [INTEGRATION] Nối FE với BE và smoke test Motion Control'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'a90f27d251822cbfb586ee7c0ce08e27858266b9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE (5.7–5.8) và BE (5.2–5.6) của Motion Control mới được kiểm thử riêng rẽ. Chưa có bằng chứng pipeline `motion_control` chạy trọn vẹn trên stack thật: tải video, ffmpeg thật cắt, giá, Cap theo Tier, hàng đợi chung, ví, nhập kết quả video, chia sẻ và đối soát.

**Approach:** Thêm smoke HTTP trên stack Compose bốn container (mẫu `smoke-body-retouch.test.mjs`), RunningHub và R2 giả trong tiến trình test, ffmpeg/ffprobe thật trên video mẫu nhỏ sinh bằng ffmpeg của máy chạy test. Cấp Tier bằng luồng nạp tiền thật (Admin duyệt đơn). Kịch bản theo AC Story 5.9 của `epics.md`; cập nhật CI và README.

## Decisions

- Smoke chỉ gọi HTTP API thật (không trình duyệt, không dựng FE SSR), theo tiền lệ Story 4.6. "FE ở chế độ live" được phủ ở mức hợp đồng: `MOCK_MOTION_*` và phản hồi BE thật cùng parse qua schema, cùng tập khóa. Nút "Tạo" bị vô hiệu ở FE đã có test của Story 5.8 (`apps/web/test/motion-control.test.mjs`). Trang `/share/<token>` và `og:image` được kiểm ở mức BE: `/s/<token>`, `/s/<token>/info`, `/s/<token>/poster` (302 tới ảnh bìa) trước thu hồi, 404 cả ba sau `DELETE`.
- Gói Creator/Starter lấy bằng `POST /topups` + `confirm-transfer` + Admin `approve` (`admin@smoke.test` nằm trong `ADMIN_EMAILS` của compose smoke), không sửa DB trực tiếp.
- Video mẫu: test tự sinh bằng `ffmpeg -f lavfi` (H.264, 24 FPS, 720x1280, vài giây), cần `ffmpeg` trên máy chạy test. Video kết quả giả cũng sinh cùng cách với độ dài 10 s, 5 s, 10,4 s, 10,6 s.
- "Đồng hồ tăng tốc" cho 360 giây: dùng `RH_DEADLINE_MS` đã có (chỉ có tác dụng khi `NODE_ENV=test`), không thêm biến mới. Thời gian ffmpeg không bị tính vì `deadline_at` đặt từ lúc bắt đầu tải input lên RunningHub.
- "Không còn thư mục tạm": kiểm bằng `docker compose exec nestjs-worker` liệt kê `$TMPDIR/flowvis-trim` và thư mục video kết quả, kỳ vọng rỗng.
- Không sửa logic ví, máy trạng thái, bộ quét, pipeline-config. Nếu smoke lộ lỗi thật ở BE thì sửa nhỏ nhất kèm ghi chú, hoặc dừng và hỏi.

## Boundaries & Constraints

**Always:**
- Nhánh `shared/*` được sửa toàn repo; schema `packages/contracts` là nguồn sự thật.
- Smoke mặc định bị bỏ qua, chỉ chạy khi `RUN_COMPOSE_E2E=1`.
- Project/cổng riêng, không trùng smoke khác: project `flowvis-smoke-mt`, api `3106`, Postgres `15437`, Redis `16384`; RH giả `3197`, S3 giả `3198`, Google giả `3199`.
- `ffmpeg`/`ffprobe` gọi bằng mảng đối số (`execFileSync`), không qua shell.

**Never:**
- Không thêm container thứ năm; không làm yếu `isPublicHttpUrl` ở production.
- Không đo tải ffmpeg/đĩa trên VPS, không đo SLA (thuộc Epic 6); không điền ánh xạ `CONTENT_BLOCKED`.
- Không xác nhận `nodeId`/`fieldName` thật của workflow Motion (đánh dấu `[ASSUMPTION]` ở pipeline-config, đối chiếu ở benchmark Epic 6); smoke chỉ khẳng định payload khớp cấu hình hiện tại.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | Creator, video mẫu, trim 10 s, RH giả SUCCESS + MP4 10 s | `price` 500; số dư −500 (HOLD) rồi CAPTURED; `queued→running→succeeded`; `/result` có `mediaType` `video`, `resultUrl`, `posterUrl`, `durationSeconds` 10, `sourceUrl` `null` | N/A |
| Không có khung xương | RH giả FAILED `NO_POSE` | Task `failed` `NO_POSE`, RELEASED, số dư hoàn; thông báo Motion "Không nhận diện được chuyển động cơ thể trong video mẫu" | N/A |
| Vượt Cap | Starter, trim 12 s, gọi API trực tiếp | 4xx `TRIM_EXCEEDS_CAP` kèm `cap` 10; sổ cái không bút toán | Số dư không đổi |
| Ví FREE | 500 credit, hai video 5 s rồi video thứ ba | Hai lần thành công (250 mỗi lần), lần ba `INSUFFICIENT_CREDIT` | Không HOLD thứ ba |
| Hai Task cùng lúc | Hai Task `motion` song song, 2 Lane | Hai ffmpeg không chạy chồng; cả hai `succeeded` | N/A |
| Quá hạn | RH giả luôn RUNNING, `RH_DEADLINE_MS` rút ngắn | `timed_out`, RELEASED, kết quả đến muộn bị bỏ qua | ffmpeg không tính vào hạn |
| Lệch độ dài | Kết quả giả 10,4 s rồi 10,6 s so với đoạn 10 s | 10,4 s `succeeded` CAPTURED đủ; 10,6 s `failed` `OUTPUT_INVALID`, RELEASED | N/A |
| Chia sẻ | Task video `succeeded`, tạo token | `/s/<token>`, `/info` (`mediaType`, `durationSeconds`), `/poster` (302); sau `DELETE` cả ba 404 | N/A |
| Dọn dẹp, đối soát | Sau mọi kịch bản | Không còn thư mục tạm; `reconcile.js` thoát 0 | Lệch thì fail |

</frozen-after-approval>

## Code Map

- `apps/api/test/smoke-body-retouch.test.mjs` -- mẫu: fake Google/RH/S3, `login`, `waitFor`, `ledgerTypes`, reconcile; sao chép phần cần thiết, không sửa file này.
- `apps/api/test/smoke-topup.test.mjs:172-256` -- mẫu cấp Tier: `POST /topups`, `confirm-transfer`, Admin `approve`.
- `apps/api/test/smoke-motion-control.test.mjs` (mới) -- các kịch bản trên; fake RH nhận `/upload` video và ảnh, trả MP4 theo `state.resultVideo`, ghi `submitBodies`.
- `apps/api/src/modules/pipelines/pipeline-config.ts:68` -- node `1/image`, `2/video`, `deadlineMs` 360 000 (khẳng định payload).
- `apps/api/src/modules/tasks/result-ingestor.ts:42` -- `evaluateIngestProbe` (dung sai 0,5 s, H.264, 24 FPS, cạnh ngắn 720), `OUTPUT_INVALID`, thư mục tạm `VIDEO_DIR_NAME`.
- `apps/api/src/modules/tasks/video-trim.service.ts:13` -- `flowvis-trim`, `FifoLock` một ffmpeg mỗi lúc.
- `apps/api/src/modules/storage/share.controller.ts`, `tasks.service.ts:351` -- `/s/:token`, `/info`, `/poster`, `getResult` video.
- `packages/contracts/src/tasks.ts:241`, `mocks.ts:501` -- `MotionCreateRequestSchema`, `MotionCreateResponseSchema`, mock Motion; không sửa schema.
- `deploy/compose.smoke.yml` -- đã có `RUNNINGHUB_WORKFLOW_MOTION`; kiểm tra, chỉ sửa nếu thiếu.
- `.github/workflows/ci.yml:58-84`, `README.md:64`, `deploy/README.md:48` -- đổi tên bước smoke, ghi cách chạy, nhắc benchmark Epic 6.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/smoke-motion-control.test.mjs` -- thêm smoke các kịch bản của ma trận + hợp đồng + đối soát, một `it` Docker bị skip khi thiếu `RUN_COMPOSE_E2E` và một `it` hợp đồng không cần Docker -- theo mẫu 4.6
- [x] `deploy/compose.smoke.yml` -- xác nhận env Motion cho api và worker; chỉ sửa nếu thiếu
- [x] `.github/workflows/ci.yml` -- cập nhật tên job/bước smoke có Motion Control; bảo đảm runner có `ffmpeg`
- [x] `README.md`, `deploy/README.md` -- mục Smoke Motion Control (Story 5.9): cách chạy, kịch bản, yêu cầu `ffmpeg` trên máy chạy test, nhắc đối chiếu node workflow và benchmark ffmpeg ở Epic 6

**Acceptance Criteria:**
- Given stack bốn container, RH và R2 giả, ffmpeg thật, when chạy mọi kịch bản của ma trận, then từng kết quả khớp ma trận.
- Given RH giả nhận payload Motion, then `workflowId` `smoke-workflow-motion` và node `1/image`, `2/video` có tên file đã tải lên RH.
- Given test hợp đồng ở CI, then `MOCK_MOTION_*` và phản hồi BE thật cùng parse qua schema và cùng tập khóa.
- Given README, then ghi cách chạy và nhắc Epic 6.

## Implementation Notes

- Thêm `apps/api/test/smoke-motion-control.test.mjs` (chín kịch bản + hợp đồng); smoke Docker pass ở lần chạy thứ sáu. Cập nhật `ci.yml`, `README.md`, `deploy/README.md`; `compose.smoke.yml` không cần sửa.
- Smoke lộ hai lỗi thật, đã sửa tối thiểu: (1) `apps/api/src/modules/storage/video-probe.service.ts`: whitelist giao thức của ffprobe chỉ có `https`, nên không đọc được URL `http` của S3 giả; nay chỉ thêm `http` khi `NODE_ENV=test` và có `R2_ENDPOINT`, production vẫn `https,tls,tcp`. (2) `packages/contracts/src/tasks.ts`: regex `resultKey` không nhận đuôi `.mp4` của kết quả video; nay cho phép `(\.mp4)?`.
- Mỗi IP chỉ nhận thưởng 500 credit cho 3 tài khoản/24 giờ, nên chỉ admin, bob, dave dùng thưởng; alice, carol, erin, frank, gina lấy credit từ nạp tiền (Creator 30.000).
- `pnpm test` cục bộ cần `RUNNINGHUB_WORKFLOW_MOTION` và không có `RUNNINGHUB_API_KEY` trong môi trường; thiếu thì `test-overrides` và `reconcile-script` fail (không liên quan diff).

## Spec Change Log

## Review Triage Log

- F1 Khẳng định trạng thái HTTP của lần tạo thứ ba (ví FREE) là tautology (Edge, Blind, Verification): `medium`, patch -- đổi thành `assert.equal(third.status, 402)`; đã áp dụng.
- F2 Không có test đơn vị cho whitelist `http` của ffprobe ở production/test (Verification, Blind, Edge): `medium`, patch -- thêm test ở `uploads-video.test.mjs` cho `production`, không đặt, `test` có và không có `R2_ENDPOINT`; đã áp dụng, pass.
- F3 Regex `resultKey` cho `.mp4` không có test hợp đồng (Verification, Blind): `medium`, patch -- thêm cặp test dương/âm vào `packages/contracts/test/index.test.mjs`; đã áp dụng, pass.
- F4 Kiểm "kết quả đến muộn bị bỏ qua" chỉ ngủ 2,5 giây rồi đọc trạng thái (Edge, Blind, Verification): `low`, patch -- thêm khẳng định `rh.fileFetches` không tăng; đã áp dụng.
- F5 Kiểm thư mục tạm bỏ qua `ingest` (thư mục kết quả video) (Edge): `medium`, patch -- thêm liệt kê nội dung `ingest`; đã áp dụng.
- F6 Hai Task song song chỉ khẳng định `maxActive <= 2`, không quan sát ffmpeg chồng nhau (Edge, Blind, Verification): `medium`, defer -- khóa FIFO đã được test đơn vị ở Story 5.4 (`video-trim.test.mjs`); quan sát chồng ffmpeg trong container cần cơ chế đo mới, thuộc benchmark ffmpeg của Epic 6.
- F7 `RH_DEADLINE_MS=25000` áp cho mọi kịch bản, runner chậm có thể làm `timed_out` giả (Edge, Blind, Verification): `low`, reject -- hạn tính từ lúc bắt đầu tải lên RunningHub (không gồm ffmpeg), smoke đã chạy sạch nhiều lần; đổi sang hạn theo từng Task cần biến môi trường mới ngoài phạm vi.
- F8 Whitelist `http` nên ràng buộc host bằng `R2_ENDPOINT` (Edge, Blind): `low`, reject -- chỉ có tác dụng khi `NODE_ENV=test`, cùng mẫu các ghi đè chỉ-khi-`test` đã chấp nhận ở Story 2.14; thêm ràng buộc host là phức tạp mới.
- F9 Regex `resultKey` áp cho mọi pipeline, ảnh cũng nhận `.mp4` (Edge, Blind): `low`, reject -- tên khóa do server sinh (`ingest` ghi `.mp4` chỉ cho video), schema chỉ kiểm hình dạng; tách theo pipeline là đổi hợp đồng.
- F10 Spec ghi "không sửa schema" nhưng đã sửa regex `resultKey` (Blind): `low`, reject -- ràng buộc đó nói về schema Motion đã chốt ở Story 5.1; lỗi hợp đồng thật do smoke lộ ra, đã ghi ở Implementation Notes.
- F11 Thiếu kịch bản âm (hủy giữa lúc cắt, trim dưới 1 giây, trim ngược, độ dài khai man, video không H.264, không đăng nhập, token của người khác) (Blind): `low`, reject -- ngoài ma trận của Story 5.9; validate trim và đo lại độ dài đã có test ở 5.3–5.4, dọn khi hủy/khởi động ở `video-trim.test.mjs`.
- F12 CI không cài/kiểm `ffmpeg` trên runner cho smoke (Blind): `medium`, defer -- job `smoke` chạy test trên host `ubuntu-latest`; dựa vào ffmpeg có sẵn của image là rủi ro thật nhưng thêm bước cài đặt/kiểm là thay đổi hạ tầng CI, cần quyết định riêng; ghi vào deferred-work.
- F13 `waitFor` khẳng định 200 trong vòng lặp nên một lỗi 5xx thoáng qua làm hỏng cả smoke; một `it` lớn che các kịch bản sau; thứ tự đánh số kịch bản; fake RH/S3 đơn giản; `makeVideo` ngoài `try` (Blind, Edge): `low`, reject -- cùng mẫu đã chấp nhận ở 2.14 (F10) và 4.6 (F10); các kịch bản chạy tuần tự.
- F14 `pnpm test` cục bộ đỏ khi thiếu `RUNNINGHUB_WORKFLOW_MOTION` hoặc có `RUNNINGHUB_API_KEY` (Blind): `false` -- CI đặt đúng môi trường; lỗi xuất phát từ `.env` cục bộ, không từ diff (đã chạy lại, 5/5 pass khi đặt biến).
- F15 `host.docker.internal` trên Linux CI cần `extra_hosts` (Blind): `false` -- `deploy/compose.smoke.yml` đã có `extra_hosts: host.docker.internal:host-gateway` cho api và worker.
- F16 Kiểm hợp đồng chỉ so tập khóa, không so kiểu hay độ phủ mã lý do (Blind): `low`, reject -- cùng mẫu đã chấp nhận ở 2.14 (F17) và 4.6 (F7); `TaskSchema.parse` đã chặn thiếu trường.
- F17 Tài liệu JSDoc chèn trước chú thích cũ của `buildFfprobeArgs` làm hai khối nằm chồng (Blind): `low`, reject -- cosmetic, không ảnh hưởng chạy.

## Verification

**Commands:**
- `pnpm run typecheck` -- expected: không lỗi
- `pnpm run lint` -- expected: không lỗi
- `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` -- expected: smoke Motion Control và các smoke khác pass (Docker và ffmpeg có sẵn)
- `pnpm test` -- expected: pass, smoke Docker bị bỏ qua
