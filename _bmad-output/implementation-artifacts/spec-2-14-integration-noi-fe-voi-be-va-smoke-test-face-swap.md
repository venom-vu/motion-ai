---
title: 'Story 2.14: [INTEGRATION] Nối FE với BE và smoke test Face Swap'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: 'eaae857c67fd23abfcb42196114fa298bc933f92'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE (2.10–2.13) và BE (2.2–2.9) của Face Swap mới được kiểm thử riêng rẽ. Chưa có bằng chứng chạy trọn vẹn tạo Task → HOLD → worker → CAPTURED/RELEASED → xem/tải/chia sẻ trên stack thật. Stack hiện chỉ có `UnconfiguredRunningHubAdapter` (luôn lỗi), nên worker không thể chạy thành công ngoài test đơn vị.

**Approach:** Thêm smoke test HTTP trên stack Compose bốn container (mẫu Story 1.11) với RunningHub và R2 được giả bằng máy chủ chạy trong tiến trình test. Thêm một adapter RunningHub HTTP chỉ được bật khi `NODE_ENV === 'test'` và có `RUNNINGHUB_BASE_URL`. Cho phép ghi đè endpoint R2, hạn chót ảnh và host kết quả chỉ khi `NODE_ENV === 'test'`. Ba kịch bản: thành công, `NO_FACE`, quá hạn 180 giây (tăng tốc). Thêm kiểm tra chia sẻ/thu hồi, đối soát, test hợp đồng mock và BE thật, cập nhật README.

## Decisions

- "Mock" vẫn là các hằng `MOCK_*` trong `packages/contracts`; FE chỉ có chế độ `live`. Test hợp đồng kiểm tra `MOCK_*` và phản hồi BE thật cùng parse qua schema.
- Smoke chỉ gọi HTTP API thật (không trình duyệt, không dựng FE SSR). Phần chia sẻ chỉ kiểm tra `GET /s/<token>` ở BE (302 rồi 404 sau thu hồi); thẻ Open Graph của `/share/<token>` đã được test SSR của Story 2.13 bao phủ và không lặp lại ở đây. (Quyết định của người dùng.)
- Mọi cơ chế giả chỉ có tác dụng khi `NODE_ENV === 'test'`; ở production bị bỏ qua (có test chứng minh).
- Không thêm container thứ năm; máy chủ RunningHub giả và S3 giả chạy trong tiến trình test, container tới qua `host.docker.internal`.

## Boundaries & Constraints

**Always:**
- Nhánh `shared/*` được sửa toàn repo; schema `packages/contracts` là nguồn sự thật.
- Smoke mặc định bị bỏ qua, chỉ chạy khi `RUN_COMPOSE_E2E=1`.
- Không đặt bí mật thật vào repo.

**Never:**
- Không sửa logic ví, máy trạng thái Task, bộ quét; chỉ thêm điểm vào cấu hình/adapter.
- Không làm yếu `isPublicHttpUrl` ở production; chỉ cho phép host kiểm thử khi `NODE_ENV === 'test'`.
- Không đo SLA 60 giây ở đây (thuộc benchmark Epic 6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thành công | User 500 credit, RH giả trả SUCCESS + ảnh hợp lệ | HOLD còn 400; `queued→running→succeeded`; CAPTURED; `/tasks/:id/result` trả URL tải được | N/A |
| Không có mặt | RH giả FAILED `NO_FACE` | Task `failed` reason `NO_FACE`, số dư về 500 (RELEASED); FE map "Không nhận diện được khuôn mặt trong ảnh" | N/A |
| Quá hạn | RH giả luôn RUNNING, hạn chót ép 3 giây | Task `timed_out`, RELEASED, kết quả đến muộn bị bỏ qua | N/A |
| Chia sẻ | Token từ `POST /tasks/:id/share` | `GET /s/<token>` không đăng nhập 302; sau `DELETE` trả 404 | N/A |
| Đối soát | Sau cả ba kịch bản | `reconcile.js` thoát mã 0 | Lệch thì fail |
| Production | `NODE_ENV=production` + biến ghi đè | Biến giả bị bỏ qua | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/runninghub-http.adapter.ts` (mới) -- adapter `RunningHubPort` qua HTTP (`uploadFile`, `submit`, `outputs`), URL từ `RUNNINGHUB_BASE_URL`.
- `apps/api/src/modules/tasks/tasks.module.ts` -- chọn adapter: HTTP khi `NODE_ENV==='test'` và có `RUNNINGHUB_BASE_URL`, còn lại giữ `UnconfiguredRunningHubAdapter`.
- `apps/api/src/modules/tasks/task-worker.service.ts:25` -- `DEADLINE_MS` hằng 180000; đọc `RH_DEADLINE_MS` chỉ khi test.
- `apps/api/src/modules/tasks/result-ingestor.ts:59,206` -- `isPublicHttpUrl` chặn `.internal`/loopback; thêm `RESULT_URL_ALLOW_HOSTS` chỉ khi test.
- `apps/api/src/modules/storage/s3-storage.adapter.ts:19` -- `createR2Client`; thêm `forcePathStyle` khi có `R2_ENDPOINT` và `NODE_ENV==='test'`.
- `deploy/compose.smoke.yml` -- thêm env R2, RunningHub, `RH_*`, `PIPELINES` workflow `RUNNINGHUB_WORKFLOW_FACESWAP` cho cả api và worker (hiện chỉ có api), `MOTION_*`.
- `apps/api/test/smoke-face-swap.test.mjs` (mới) -- máy chủ RH giả + S3 giả; ba kịch bản, chia sẻ, đối soát, hợp đồng.
- `apps/api/test/test-overrides.test.mjs` (mới) -- chứng minh biến giả bị bỏ qua ngoài `test`.
- `packages/contracts/src/mocks.ts`, `tasks.ts` -- tái sử dụng `MOCK_TASK_*`, `MOCK_TASK_RESULT_RESPONSE`; không sửa schema.
- `.github/workflows/ci.yml`, `README.md`, `deploy/README.md` -- chạy smoke, ghi cách chạy ba smoke test và SLA 60 giây thuộc Epic 6.
- Tái sử dụng mẫu `apps/api/test/smoke-login.test.mjs` (dựng compose, fake Google, login, reconcile).

## Tasks & Acceptance

**Execution:**
- [x] `runninghub-http.adapter.ts` + `tasks.module.ts` -- adapter HTTP chỉ bật ở test.
- [x] `task-worker.service.ts`, `result-ingestor.ts`, `s3-storage.adapter.ts` -- ghi đè chỉ khi `NODE_ENV==='test'`.
- [x] `compose.smoke.yml` -- env cho api và worker.
- [x] `smoke-face-swap.test.mjs`, `test-overrides.test.mjs` -- test mới.
- [x] CI + README -- gắn smoke, hướng dẫn.

**Acceptance Criteria:**
- Given stack bốn container, RH và R2 giả, when chạy đường thành công, then số dư 500→400, Task `queued→running→succeeded`, CAPTURED, ảnh kết quả xem và tải được.
- Given RH giả trả `NO_FACE`, then Task `failed`, số dư về 500, FE có chuỗi "Không nhận diện được khuôn mặt trong ảnh".
- Given RH giả không bao giờ trả kết quả và hạn chót tăng tốc, then Task `timed_out`, RELEASED, kết quả muộn bị bỏ qua.
- Given chia sẻ, when mở `/s/<token>` không đăng nhập thì 302; sau thu hồi thì 404.
- Given đối soát chạy sau smoke, then thoát mã 0.
- Given test hợp đồng, then `MOCK_*` và phản hồi BE thật đều parse qua schema.
- Given `NODE_ENV` khác `test`, then mọi biến ghi đè bị bỏ qua.
- Given README, then ghi cách chạy ba smoke test và SLA 60 giây đo ở Epic 6.

## Review Triage Log

- F1 `R2_ENDPOINT` bị bỏ qua ngoài `test` (Blind): `medium`, `patch` -- `.env.example` ghi đây là ghi đè tùy chọn ở mọi môi trường (vd. endpoint khu vực); Code Map chỉ yêu cầu gate `forcePathStyle`. Sửa: luôn nhận `R2_ENDPOINT`, chỉ `forcePathStyle` gắn với `test`.
- F2 `RH_DEADLINE_MS=3000` cho mọi Task làm kịch bản thành công có thể flake trên CI chậm (Blind, Edge, Verification): `medium`, `patch` -- tăng hạn chót smoke lên 10 giây, chỉnh thời gian chờ kịch bản quá hạn cho khớp. Phần "ảnh hưởng smoke đăng nhập" là `false` vì smoke đó không tạo Task.
- F3 Kiểm tra "kết quả đến muộn bị bỏ qua" không quan sát việc bỏ qua (Blind, Verification, Edge): `medium`, `patch` -- fake RH đếm lượt tải `/files/result.png` và `/outputs`; test khẳng định không có lượt tải file nào sau khi hết hạn.
- F4 Fake RH không ghi nhận payload, không kiểm số lần submit (Verification, Blind): `medium`, `patch` -- ghi lại `workflowId`, `nodeInfoList`, kích thước upload; khẳng định `workflowId`, hai tên file và `submits === 3`.
- F5 `GET /s/<token>` chỉ khẳng định 302, không kiểm đích (Edge): `low`, `patch` -- tải `location` (đổi host) và kỳ vọng 200 trước khi thu hồi; sửa một dòng.
- F6 README nói "ba smoke test" nhưng code là một `it` gồm ba kịch bản (Blind): `low`, `patch` -- sửa câu chữ README và `deploy/README.md` thành "ba kịch bản".
- F7 Không có guard khởi động khi `NODE_ENV=test` ở production (Blind): `low`, reject -- cùng mẫu với ghi đè Google của Story 1.11; thêm guard là phức tạp mới ngoài phạm vi.
- F8 Không có test restart worker giữa Task, `consumeMoney`, số tiền CAPTURED (Blind): `low`, reject -- ngoài tiêu chí chấp nhận của spec.
- F9 Cổng cố định, bind `0.0.0.0` (Blind, Edge): `low`, reject -- cần `0.0.0.0` để `host-gateway` tới được, cùng mẫu fake Google; cổng không trùng smoke đăng nhập.
- F10 Teardown có thể treo, `compose down` nuốt lỗi (Blind): `false` -- Node >= 22 đóng kết nối rảnh khi `server.close`; dọn dẹp best-effort là cố ý.
- F11 Adapter HTTP: JSON lỗi ném `SyntaxError`, 5xx không retry (Blind, Edge): `low`, reject -- adapter chỉ dành cho fake trong test, worker đã phân loại lỗi lạ thành `RH_SUBMIT_UNKNOWN`.
- F12 `UnconfiguredRunningHubAdapter` còn trong providers, factory tạo bản thứ hai (Blind, Edge): `low`, reject -- không có hành vi sai; giữ provider vì test hiện có import nó.
- F13 `RESULT_URL_ALLOW_HOSTS` bỏ qua kiểm tra IP nội bộ trên redirect (Edge, Verification): `false` -- chỉ khớp hostname được liệt kê, chỉ khi `test`; test khẳng định `127.0.0.1` vẫn bị chặn.
- F14 `s3` không endpoint ở `test`, `RH_DEADLINE_MS` không hợp lệ (Edge, Blind): `false` -- giá trị không hợp lệ rơi về mặc định đã có test; thiếu endpoint chỉ xảy ra khi cấu hình sai.
- F15 Chuỗi lỗi FE chỉ kiểm qua contracts (Edge): `false` -- `api-client.ts`, `TaskProgressCard.vue`, `TaskHistoryCard.vue` đều dùng cùng `getReasonCodeMessageVi`.
- F16 Worker/compose thiếu env, `test-overrides` phụ thuộc `dist` (Edge, Blind): `false` -- compose gộp map theo khóa nên env gốc còn; `pnpm test` build trước.
- F17 EXIF kiểm bằng chuỗi con, transitions phụ thuộc thời điểm poll, không kiểm `Content-Disposition`, so với mock (Edge, Blind, Verification): `low`, reject -- chứng cứ đủ cho AC, sửa tăng phức tạp.
- F18 `rh.mode` toàn cục gây nhiễm chéo (Edge): `false` -- các kịch bản chạy tuần tự, mỗi kịch bản đặt lại mode trước khi tạo Task.
