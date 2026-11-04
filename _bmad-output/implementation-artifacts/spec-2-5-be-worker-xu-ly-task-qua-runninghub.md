---
title: 'Story 2.5: [BE] Worker xử lý Task qua RunningHub'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '8fe59a736d1b753cd5576e0effcc6622a76a4e9c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Task `queued` có job BullMQ nhưng không có ai lấy: chưa có worker, cổng đồng thời, nhánh khôi phục sau restart, `RunningHubPort` thật, nên không Task nào được xử lý và credit HOLD chỉ chờ.

**Approach:** Module `tasks` thêm bộ xử lý job (BullMQ `Worker`, `concurrency = 2`, chỉ ở tiến trình worker) theo AD-5/AD-6: CAS `queued→running`, chuẩn bị, cổng đồng thời, upload và submit lên RunningHub qua `RunningHubPort`, poll mỗi 3 giây, rồi giao `ResultIngestor` khi `SUCCESS`. Cấu hình pipeline đặt ở `pipelines`. Chỉ có adapter giả/chưa cấu hình; adapter HTTP thật làm sau.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; không sửa `packages/contracts`, không sửa `wallet.service.ts`. Mọi cột `tasks` chỉ `tasks` ghi; mọi đổi trạng thái qua `TasksService.transition`.
- Migration thêm vào `tasks`: `running_at`, `prep_deadline_at`, `deadline_at`, `submit_started_at`, `finished_at`, `rh_orphan_until`, `gate_deadline` (đều `timestamptz` null), `runninghub_task_id` (text null), `gpu_coins` (integer null).
- `transition` đặt `finished_at = now()` trong cùng UPDATE ở mọi chuyển sang trạng thái kết thúc; chuyển `queued→running` đặt `running_at = now()`, `prep_deadline_at = now()+120s`, `gate_deadline = now()+15 phút` trong cùng UPDATE. `opts` nhận thêm `gpuCoins` và `orphanForMs` (đặt `rh_orphan_until = now()+orphanForMs`).
- `RunningHubPort` (trong `ports/index.ts`): `uploadFile(bytes, name, signal)` → tên file đã upload; `submit(workflowId, nodeInfoList, signal)` → `runninghubTaskId`; `outputs(runninghubTaskId, signal)` → `{ status: 'RUNNING'|'SUCCESS'|'FAILED', fileUrl?, errorMessage?, consumeMoney? }`. Lỗi mạng ném `RunningHubNetworkError` có cờ `requestSent`. Provider mặc định là adapter "chưa cấu hình" ném `RH_ERROR`; không viết HTTP thật.
- Mỗi HTTP gọi RunningHub có timeout ≤ 10 giây (`AbortSignal.timeout(10000)` kết hợp tín hiệu hủy của Task).
- Trình tự job (AD-6): (a) chuẩn bị: tải hai ảnh `input_keys` từ R2 qua `StoragePort` (lỗi → `failed`/`INPUT_FETCH_ERROR`), chạy bước `prepare` tùy chọn của cấu hình nếu có; (b) cổng đồng thời; (c) ghi `deadline_at = COALESCE(deadline_at, now()+180s)` ngay khi qua cổng rồi upload; (d) ghi `submit_started_at`, submit, ghi `runninghub_task_id` ngay; (e) poll; (f) `SUCCESS` → `ResultIngestor.ingest`.
- Cổng: mutex trong tiến trình bao quanh đếm + ghi `deadline_at`. Số "đã qua cổng" = Task `running` có `deadline_at` khác null; cộng Task kết thúc còn `rh_orphan_until > now()`. Nếu tổng ≥ `RH_MAX_CONCURRENT` (mặc định 2) thì nhả mutex, chờ `RH_GATE_RETRY_MS` (mặc định 5000) ngay trong job (có thể hủy), thử lại; quá `gate_deadline` → `timed_out`/`RH_GATE_TIMEOUT`. Không dùng job trì hoãn của BullMQ để chờ cổng.
- Nhánh khôi phục khi nhận job (đọc Task, tối đa một lần đọc lại sau CAS 0 dòng): đã kết thúc → bỏ job; `queued` → CAS sang `running`; `running` có `runninghub_task_id` → poll tiếp, không submit lại; có `submit_started_at` mà chưa có id → `failed`/`RH_SUBMIT_UNKNOWN` + `orphanForMs` 10 phút; chưa có `submit_started_at`: có `deadline_at` thì quá hạn → `timed_out`/`RH_TIMEOUT`, chưa quá thì chạy lại từ (c) không đặt lại `deadline_at`; chưa có `deadline_at` thì quá `prep_deadline_at` → `timed_out`/`PREP_TIMEOUT`, chưa quá thì chạy lại (a).
- Submit: lỗi mạng với `requestSent = false` thử lại đúng một lần; lỗi khác không thử lại (sau khi request đã gửi mà không có id → `RH_SUBMIT_UNKNOWN`; hai lần chưa gửi được → `failed`/`RH_ERROR`).
- Poll mỗi `RH_POLL_INTERVAL_MS` (mặc định 3000); trước mỗi lần poll đọc Task, không còn `running` thì dừng im lặng không chuyển trạng thái; quá `deadline_at` → `timed_out`/`RH_TIMEOUT` + `orphanForMs` 10 phút; thao tác dài nhận `AbortSignal`.
- `FAILED` từ RunningHub ánh xạ bằng danh sách cấu hình theo tiền tố: `NO_FACE`→`NO_FACE`, `NO_POSE`→`NO_POSE`, từ khóa hết tiền→`RH_BUDGET`, danh sách `CONTENT_BLOCKED` để trống, còn lại `RH_ERROR`; chuyển `failed` + RELEASED qua `transition`, lưu `gpu_coins` từ `consumeMoney` nếu có. Thông báo người dùng sinh từ `reasonCode`.
- `ResultIngestor` là cổng (token DI) nhận Task, `fileUrl`, `consumeMoney`, signal; bản mặc định chuyển `failed`/`OUTPUT_UPLOAD_ERROR` (RELEASED) để không bao giờ CAPTURED khi chưa có kết quả thật. Story 2.6 thay bản thật.
- Cấu hình pipeline ở `modules/pipelines`: `face_swap` khai báo biến môi trường workflow ID `RUNNINGHUB_WORKFLOW_FACESWAP`, ánh xạ `sourceKey`/`targetKey` → node/field (giá trị node là `[ASSUMPTION]` ghi rõ), `prepare` tùy chọn; worker không có mã riêng theo pipeline. Biến môi trường mới vào `.env.example`.
- BullMQ `Worker` tạo trong `onModuleInit` chỉ khi `MOTION_PROCESS_ROLE === 'worker'`, `concurrency = 2`, đóng khi tắt; hàm xử lý job là hàm công khai gọi trực tiếp được trong test.
- Mọi test dùng PostgreSQL và Redis thật, `RunningHubPort`/`StoragePort` giả; không gọi RunningHub/R2 thật.

**Never:**
- Không viết adapter HTTP RunningHub thật, nhập kết quả về R2, EXIF, `CAPTURED` (Story 2.6), bộ quét (2.7), ffmpeg/video, cờ `rh_budget_exhausted`/`intake_paused`/ngắt mạch (Epic 6), sửa `packages/contracts`.
- Không submit lại khi đã có `submit_started_at`; không đặt lại `deadline_at`; không dùng `status NOT IN`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chạy thành công | Task `queued`, RH trả `RUNNING` rồi `SUCCESS` | CAS `running`, `running_at`/`prep_deadline_at` đặt, `deadline_at`/`submit_started_at`/`runninghub_task_id` đặt đúng một lần, `ingest` gọi một lần với `fileUrl` | N/A |
| Giao lại có id | `running` + `runninghub_task_id` | Không upload, không submit, poll tiếp | N/A |
| Submit không có id | `running` + `submit_started_at`, chưa id | `failed`/`RH_SUBMIT_UNKNOWN`, RELEASED, `rh_orphan_until` ≈ +10 phút | N/A |
| Chạy lại giữa chừng | `running`, chưa `submit_started_at`, `deadline_at` còn hạn | Chạy lại từ upload, `deadline_at` giữ nguyên | N/A |
| Quá hạn khôi phục | có `deadline_at` đã quá; hoặc không có và quá `prep_deadline_at` | `timed_out`/`RH_TIMEOUT`; hoặc `PREP_TIMEOUT`; RELEASED | N/A |
| Task đã kết thúc | `succeeded`/`failed`/… | Bỏ job, không gọi RH | N/A |
| Cổng đầy | 2 Task đã qua cổng hoặc orphan | Task thứ ba chưa upload, chờ; có slot thì chạy | quá `gate_deadline` → `RH_GATE_TIMEOUT` |
| RH báo lỗi | `NO_FACE…`, `NO_POSE…`, hết tiền, lỗi khác | `NO_FACE`/`NO_POSE`/`RH_BUDGET`/`RH_ERROR`, RELEASED, `gpu_coins` lưu | N/A |
| Lỗi mạng submit | chưa gửi (1 lần) / chưa gửi (2 lần) / đã gửi | thành công sau retry / `RH_ERROR` / `RH_SUBMIT_UNKNOWN` | không retry khi đã gửi |
| Task bị đổi khi poll | Task thành `timed_out` bởi bên khác | Poll dừng im lặng, sổ cái không đổi | N/A |
| 5 Task, concurrency | 5 job cùng lúc | Không quá 2 xử lý đồng thời | N/A |
| Không đọc được input | R2 lỗi | `failed`/`INPUT_FETCH_ERROR`, RELEASED | N/A |
| SUCCESS với ingestor mặc định | RH `SUCCESS` | `failed`/`OUTPUT_UPLOAD_ERROR`, RELEASED, không CAPTURED | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/tasks.service.ts` -- `transition` thêm cột thời gian/`gpuCoins`/`orphanForMs`; thêm phương thức công khai hẹp cho worker (đọc Task, ghi `deadline_at`/`submit_started_at`/`runninghub_task_id`).
- `apps/api/src/modules/tasks/task-worker.service.ts` (mới) -- `Worker` BullMQ, hàm xử lý job, cổng, poll, khôi phục, ánh xạ lỗi.
- `apps/api/src/modules/tasks/tasks.module.ts` -- đăng ký worker service, provider `RUNNING_HUB_PORT` mặc định, `RESULT_INGESTOR`; import `PipelinesModule`.
- `apps/api/src/modules/pipelines/` -- `pipeline-config.ts` và service trả cấu hình theo `pipeline`.
- `apps/api/src/ports/index.ts` -- `RunningHubPort`, `RunningHubNetworkError`, `RESULT_INGESTOR`; `StoragePort.getObject` có sẵn.
- `apps/api/src/modules/storage/uploads-expiry.service.ts` -- mẫu gating bằng `MOTION_PROCESS_ROLE`.
- `apps/api/prisma/schema.prisma`, `prisma/migrations/` -- cột mới; `apps/api/.env.example` -- biến mới.
- `apps/api/test/task-transitions.test.mjs`, `tasks.test.mjs` -- mẫu bootstrap; test hiện có phải còn xanh.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, migration mới -- 9 cột mới -- AC migration
- [x] `apps/api/src/ports/index.ts`, `modules/pipelines/*` -- port, lỗi mạng, cấu hình pipeline -- cô lập RunningHub
- [x] `apps/api/src/modules/tasks/tasks.service.ts` -- `transition` mở rộng + phương thức ghi cột worker -- chủ sở hữu duy nhất
- [x] `apps/api/src/modules/tasks/task-worker.service.ts`, `tasks.module.ts`, `.env.example` -- worker, cổng, khôi phục, poll, ingestor mặc định -- logic chính
- [x] `apps/api/test/task-worker.test.mjs` -- phủ I/O Matrix trên PostgreSQL/Redis thật, kèm đột biến -- xác minh

**Acceptance Criteria:**
- Given migration, when chạy, then `tasks` có đủ 9 cột và `transition` đặt `finished_at` ở mọi chuyển sang kết thúc.
- Given job được giao lại sau restart, when Task đã có id, then không submit lại và poll tiếp.
- Given 5 Task cùng lúc, when worker chạy `concurrency = 2`, then không quá 2 xử lý đồng thời.

## Implementation Notes

- Chọn thêm (spec không nói): pipeline hoặc biến môi trường workflow chưa cấu hình → `failed`/`RH_ERROR`; lỗi mạng/timeout khi poll là tạm thời, thử lại tới `deadline_at`; lỗi lạ khi submit (kể cả timeout) → `RH_SUBMIT_UNKNOWN`.
- `[ASSUMPTION]`: nút `10`/`11`, field `image` của workflow Face Swap chưa xác nhận; adapter HTTP thật chưa có (mặc định `UnconfiguredRunningHubAdapter` ném `RH_ERROR`), ingestor mặc định chuyển `failed`/`OUTPUT_UPLOAD_ERROR` nên chưa Task nào `succeeded` cho tới Story 2.6.
- BullMQ `Worker` nhận tùy chọn kết nối (không phải instance ioredis) để BullMQ tự đóng; trước đó làm treo cả bộ test.
- Xác minh: lint, typecheck, build, `check:boundaries` qua; `pnpm --filter @motion-ai/api test` 187 test, 185 pass, 0 fail, 2 skip có sẵn (ba lần liên tiếp); `task-worker.test.mjs` 22/22; đột biến cổng, retry khi đã gửi, nhánh có id, `RH_SUBMIT_UNKNOWN`, concurrency, `job.data.taskId`, `finished_at` và các guard `poll` đều làm test fail.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `onModuleInit` thật chưa có test; test 5 job dùng Worker riêng nên đổi `concurrency`, tên queue hay `job.data.taskId` vẫn xanh | medium | patch | Verification-gap đã xác minh; thêm test wiring thật; đổi concurrency 10 hoặc đọc `job.data.id` thì test 21 fail |
| `poll` không kiểm tra sau `ingest()`: ingestor trả về mà không chuyển trạng thái thì Task kẹt `running` giữ credit | medium | patch | Hợp đồng ingestor là tự chuyển trạng thái; sửa: đọc lại, còn `running` thì `failed`/`OUTPUT_UPLOAD_ERROR`; có test, bỏ guard thì fail |
| `SUCCESS` không có `fileUrl` vẫn gọi ingestor | low | patch | Sửa nhỏ một nhánh: bỏ qua ingestor, `OUTPUT_UPLOAD_ERROR`; có test |
| `consumeMoney` lớn làm tràn `gpu_coins` int4, `transition` ném, Task kẹt `running` | medium | patch | Cột integer; sửa: kẹp 0..2147483647; có test với 5000000000 |
| `finished_at` chưa được kiểm cho `timed_out`, `cancelled`, `succeeded` | medium | patch | Đảo `isTerminal(to)` thành `to === 'failed'` ban đầu không làm test nào fail; đã thêm test, đột biến bây giờ fail |
| `clearGate` trong test force-fail mọi Task `running` của DB dùng chung mà không RELEASED | medium | patch | Có thể phá dữ liệu dev; sửa: chỉ động tới Task của user test, đặt `RH_MAX_CONCURRENT` = số slot ngoài + 2 |
| Thiếu test khi biến môi trường workflow không đặt | low | patch | Một nhánh rẻ để kiểm; đã thêm test |
| Giao lại giữa `markSubmitStarted` và `setRunninghubTaskId` làm hỏng Task đang sống (`RH_SUBMIT_UNKNOWN` giả) | false | - | BullMQ giữ khóa job và `jobId = taskId` nên không có hai bên cùng xử lý một Task; giao lại chỉ sau khi lock hết hạn (worker đã chết) |
| Chờ cổng chiếm slot BullMQ nên Task FREE chặn Task ưu tiên cao | false | - | Cổng cho tối đa `RH_MAX_CONCURRENT` (2) Task, bằng concurrency; nên slot BullMQ không thể bị chờ cổng chiếm mà không có Task thật đang chạy |
| Timeout 10 giây dùng chung cho upload, không retry upload | false | - | Spec yêu cầu mọi HTTP timeout ≤ 10 giây; upload retry không có trong spec |
| `PREP_TIMEOUT` và `deadline_at` chỉ kiểm khi nhận job, không kiểm khi chạy | maybe-false | defer | Bộ quét Story 2.7 cưỡng chế hạn chót bất kể job còn sống; cần quyết định có kiểm trong job hay không |
| Cổng chỉ an toàn trong một tiến trình (count-then-set không nguyên tử giữa các tiến trình) | low | reject | AD-6 quy định đúng một tiến trình worker và cổng là mutex trong tiến trình; deploy tắt worker cũ trước khi bật mới |
| Task `running` không còn job sau shutdown (`processTask` thoát khi abort) | maybe-false | defer | Bộ quét Story 2.7 (mục 4) enqueue job khôi phục; cần thử shutdown giữa chừng |
| Từ khóa `balance`/`insufficient` quá rộng; `CONTENT_BLOCKED` chưa có chuỗi lỗi | maybe-false | defer | Cần chuỗi lỗi thật của RunningHub (benchmark Epic 6) để thu hẹp |
| Mặc định chưa cấu hình: Task bị HOLD rồi `RH_ERROR`; không fail-fast khi khởi động | maybe-false | defer | Có chủ đích tới khi có adapter thật (Story 2.14); cần cờ cấu hình ở `ops` hoặc từ chối tạo Task |
| `__proto__` làm cấu hình pipeline; `pipeline` không hợp lệ | false | - | Cột `pipeline` có `CHECK` chỉ cho `face_swap` |
| Chính sách cứng trong SQL (120 giây, 15 phút); `orphanForMs`/`gpuCoins` nhận ở mọi chuyển; poll không retry `RunningHubError` tạm thời | low | reject | Hằng số theo spec; adapter thật sẽ phân biệt lỗi tạm bằng `RunningHubNetworkError` |
| Retry submit không backoff; abort khi shutdown thành lỗi; lỗi lạ khi poll bị nuốt | low | reject | Spec quy định retry đúng một lần; lỗi lạ dừng ở deadline; sửa thêm nhánh không đáng |
| Test `rh_orphan_until` flaky do đồng hồ | low | reject | Ba lần chạy toàn bộ liên tiếp đều xanh, không tái hiện; so sánh dùng `now()` của DB |
| `outputs()` của adapter mặc định ném đồng bộ; `Queue.prototype` ghi đè; mã chết `realAdd` | low | reject | `await` trong `try` bắt được; mỗi file test một tiến trình |

## Design Notes

Chờ cổng nằm trong job chứ không trì hoãn job BullMQ: giao lại job chạy nhánh khôi phục AD-5, mà khi chưa có `deadline_at` nó so `prep_deadline_at` (120 giây) nên một Task chờ cổng lâu sẽ bị `PREP_TIMEOUT` thay vì `RH_GATE_TIMEOUT`. Cũng vì vậy restart giữa lúc chờ cổng cho `PREP_TIMEOUT`, đúng với AD-6 (không tính vào ngắt mạch). Ghi `deadline_at` cùng lúc qua cổng, trong mutex, nên "đã qua cổng" đọc được từ DB.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass
