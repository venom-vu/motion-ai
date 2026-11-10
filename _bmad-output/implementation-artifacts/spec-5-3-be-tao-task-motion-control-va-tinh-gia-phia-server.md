---
title: 'Story 5.3: [BE] Tạo Task Motion Control và tính giá phía server'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '7b3aa278131967b25e94e1ef192e04f93715b79f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/api` chưa có `POST /tasks/motion`: chưa đăng ký pipeline `motion_control`, chưa tính giá theo số giây Trim đối chiếu với độ dài video đã đo ở 5.2, và chưa kiểm Cap theo Tier Snapshot, nên người dùng chưa thể bị HOLD đúng 50 × số giây và đưa Task vào hàng đợi.

**Approach:** Thêm `createMotionControl` vào `TasksService` dùng lại `createPipelineTask` (khóa user, giới hạn 3 Task, HOLD, INSERT, enqueue). Số giây lấy từ `durationSeconds` lưu ở `uploads`; Cap kiểm bên trong transaction ngay sau `wallet.hold` để rollback toàn bộ khi vượt. Đăng ký pipeline kèm `RUNNINGHUB_WORKFLOW_MOTION` bắt buộc khi khởi động và mở rộng CHECK `pipeline` bằng migration.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`, `deploy/**` (nhánh `be/*`); dùng hợp đồng 5.1 (`MotionCreateRequestSchema`, `MotionCreateResponseSchema`, `motionPrice`, `ValidationDetailsSchema`); không thêm `ApiErrorCode`/`ReasonCode`; không sửa `packages/contracts`.
- **Quyết định đã chốt:** pipeline tên `motion_control` (route vẫn là `POST /tasks/motion`); body không có `consent` (ToS đồng ý một lần khi đăng nhập; `CONSENT_REQUIRED` do đường đăng nhập xử lý, `consent: true` ghi vào Task như Face Swap/Body Retouch).
- Giá = `motionPrice(seconds)` với `seconds = trimEnd − trimStart`, HOLD đúng số này; `params` chứa `trimStart`, `trimEnd`, `seconds`, `price`; `hold_amount` = `price`; `inputKeys` = `{ characterKey, videoKey }`. Không tin độ dài hay giá từ client.
- `trimEnd` so với `durationSeconds` đã lưu của khóa video; khóa ảnh phải là ảnh `in/` đã xác nhận, khóa video phải là video `in/` đã xác nhận, cả hai của chính người dùng và còn trong thời hạn lưu. Chỉ module `storage` đọc bảng `uploads` (AD-1).
- Lỗi Trim là `VALIDATION_FAILED` kèm `details.reason`, không HOLD, không tạo Task: không phải số nguyên → `TRIM_NOT_WHOLE_SECOND`; `trimStart < 0` hoặc `trimEnd > durationSeconds` → `TRIM_OUT_OF_VIDEO`; `seconds < 3` (gồm `trimEnd ≤ trimStart`) → `TRIM_TOO_SHORT`.
- Cap lấy từ Tier Snapshot do `wallet.hold` trả về trong cùng transaction; `seconds > cap` → ném lỗi để rollback HOLD, trả `VALIDATION_FAILED` `TRIM_EXCEEDS_CAP` kèm `details.cap`; sổ cái không còn bút toán của yêu cầu. Thứ tự lỗi: Trim sai kiểu/khoảng → `ACCOUNT_LOCKED` → `TASK_LIMIT` → `INSUFFICIENT_CREDIT` → `TRIM_EXCEEDS_CAP`.
- **Quyết định:** chặn có chủ đích giữa 5.3 và 5.5: khi worker nhấc Task `motion_control` mà pipeline chưa sẵn sàng, chuyển `failed`/`INTERNAL_ERROR` qua `tasks.transition` và RELEASED 100%, không gọi RunningHub; nhánh mã tạm này được gỡ ở Story 5.5.
- Task xếp vào hàng đợi chung theo Priority của Tier Snapshot, `jobId = taskId`, như mọi pipeline. Phản hồi theo `MotionCreateResponseSchema` (Task kèm `price` = `creditCost`).
- Pipeline `motion_control` đăng ký trong `PIPELINE_CONFIGS` với `workflowEnvVar: 'RUNNINGHUB_WORKFLOW_MOTION'`, `requiredAtStartup: true`; thiếu biến thì `api` và `worker` không khởi động và nêu tên biến. Nối biến vào `deploy/compose.yml`, `compose.smoke.yml`, `apps/api/.env.example` và các test khởi động bằng `??=`.
- Migration SQL thô mở rộng `tasks_pipeline_valid_chk` thêm `motion_control` (mẫu migration body_retouch); RunningHub giả ở `RunningHubPort` trong test.

**Never:**
- Không làm bước ffmpeg, mapping node RunningHub, nhập kết quả (5.4–5.6); không đổi hành vi ảnh/Face Swap/Body Retouch; không tính giá hay Cap bằng giá trị client; không SQL thô vào bảng của module khác.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Giá mọi độ dài | `seconds` 3…20, Creator, đủ credit | HOLD = `motionPrice(seconds)`, `params.price` khớp, Task `queued` | N/A |
| FREE | 5 s; 6 s | 250 credit tạo được; 6 s bị từ chối | `TRIM_EXCEEDS_CAP`, `cap: 5`, không bút toán |
| Starter / Creator | 12 s; 20 s | từ chối (`cap: 10`); 1.000 credit | `TRIM_EXCEEDS_CAP` |
| Tier đổi sau tải video | Pro rơi về FREE, trim 8 s | Cap theo snapshot lúc tạo | `TRIM_EXCEEDS_CAP`, `cap: 5` |
| Trim sai | 1.5; `trimStart` −1; `trimEnd` > độ dài; 2 s; `trimEnd ≤ trimStart` | không HOLD, không Task | `TRIM_NOT_WHOLE_SECOND`; `TRIM_OUT_OF_VIDEO` ×2; `TRIM_TOO_SHORT` ×2 |
| Thiếu credit | số dư < giá | không Task | `INSUFFICIENT_CREDIT` |
| Khóa / giới hạn | tài khoản khóa; đã 3 Task queued/running | không Task | `ACCOUNT_LOCKED`; `TASK_LIMIT` |
| Khóa không hợp lệ | khóa người khác, ảnh dùng làm video, chưa xác nhận, hết hạn | không Task | `VALIDATION_FAILED` |
| Thiếu biến workflow | không có `RUNNINGHUB_WORKFLOW_MOTION` | `api` và `worker` không khởi động | lỗi nêu tên biến |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/tasks.service.ts` -- `createFaceSwap`/`createBodyRetouch` gọi `createPipelineTask` (khóa user `FOR UPDATE`, `TASK_LIMIT`, `wallet.hold` trả `TierSnapshot`, `tx.task.create`, enqueue timeout 1,5 s). Thêm `createMotionControl`; mở rộng `spec.pipeline` và hàm chung để nhận `postHold(snapshot)` kiểm Cap trong transaction. Dòng ~399 `areConfirmedKeysOwnedBy` chỉ lọc `kind: 'image'` — không dùng cho khóa video.
- `apps/api/src/modules/tasks/tasks.controller.ts` -- `@Post('face-swap')`/`@Post('body-retouch')` là mẫu; thêm `@Post('motion')`, parse `MotionCreateRequestSchema`, ánh xạ lỗi zod của `trimStart`/`trimEnd` sang `details.reason` (không nguyên → `TRIM_NOT_WHOLE_SECOND`, âm → `TRIM_OUT_OF_VIDEO`).
- `apps/api/src/modules/storage/uploads.service.ts` -- `areConfirmedKeysOwnedBy` (lọc image, cửa sổ `CONFIRMED_RETENTION_MS`); thêm phương thức công khai trả `durationSeconds` của video `in/` hợp lệ của chủ (hoặc `null`) và kiểm khóa ảnh/video theo `kind`. Chỉ storage đọc `uploads`.
- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `PIPELINE_CONFIGS`; thêm `motion_control` (`requiredAtStartup`, `RUNNINGHUB_MODE_MOTION`, `defaultRunMode`). `pipelines.service.ts` `onModuleInit` đã ném lỗi nêu tên biến thiếu.
- `apps/api/src/modules/tasks/task-worker.service.ts` -- `processTask` → `runFromUpload` (dòng ~188): đặt nhánh chặn tạm ngay đầu `runFromUpload` cho `row.pipeline === 'motion_control'` bằng `this.finish(taskId, 'failed', 'INTERNAL_ERROR')` (đi qua `tasks.transition`, wallet RELEASED 100%), trước `loadInputs` và cổng RunningHub; ghi chú `// TẠM: gỡ ở Story 5.5`.
- `apps/api/src/modules/wallet/tier.ts` -- `PRICING_CONFIG.pipelines.motionControlCreditsPerSecond` (50) và `motionControlMinSeconds` (3) đã có; `snapshotFromPack` cho `maxVideoSeconds`. Hằng 50 không được lặp ở nơi khác: dùng `motionPrice`.
- `apps/api/prisma/migrations/20261109000000_tasks_pipeline_body_retouch/migration.sql` -- mẫu; thêm migration mới `…_tasks_pipeline_motion_control` đổi CHECK thành `('face_swap','body_retouch','motion_control')`.
- `deploy/compose.yml`, `deploy/compose.smoke.yml`, `apps/api/.env.example` -- thêm `RUNNINGHUB_WORKFLOW_MOTION` (+ `RUNNINGHUB_MODE_MOTION`) cho cả `api` và `worker`.
- `apps/api/test/*.test.mjs` -- ~18 file đặt `process.env.RUNNINGHUB_WORKFLOW_BODY_RESHAPE ??= …`; thêm `RUNNINGHUB_WORKFLOW_MOTION ??= …` (tìm bằng grep tên biến). Mẫu test mới: `body-retouch.test.mjs`, `tasks.test.mjs`, `test/helpers/task-fixture.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/tasks/task-worker.service.ts` -- nhánh chặn tạm `motion_control` → `failed`/`INTERNAL_ERROR`, không gọi RunningHub, kèm test worker (RELEASED 100%, `RunningHubPort` giả không bị gọi) -- an toàn giữa 5.3 và 5.5
- [x] `apps/api/src/modules/pipelines/pipeline-config.ts` + migration SQL mới -- đăng ký `motion_control`, mở rộng CHECK -- cho phép lưu Task
- [x] `apps/api/src/modules/storage/uploads.service.ts` -- lấy `durationSeconds` video `in/` hợp lệ và kiểm khóa theo loại -- nguồn độ dài thật
- [x] `apps/api/src/modules/tasks/tasks.service.ts`, `tasks.controller.ts` -- `createMotionControl`, `POST /tasks/motion`, kiểm Trim, Cap trong transaction, ánh xạ `details.reason` -- logic chính
- [x] `deploy/compose.yml`, `deploy/compose.smoke.yml`, `apps/api/.env.example`, các file test hiện có -- nối biến `RUNNINGHUB_WORKFLOW_MOTION` -- để `api`/`worker`/test vẫn khởi động
- [x] `apps/api/test/motion-control.test.mjs` -- mọi `seconds` 3…20, Cap theo Tier (kể cả Tier đổi), các lỗi Trim, thiếu credit/khóa/`TASK_LIMIT`, khóa sai loại, thiếu biến khởi động, rollback sổ cái; test I/O Matrix -- phủ ranh giới

**Acceptance Criteria:**
- Given Task `motion_control` đã tạo, when worker nhấc lên trước khi 5.5 hoàn tất, then Task `failed` với `INTERNAL_ERROR`, credit RELEASED 100% và `RunningHubPort` không bị gọi.
- Given Task Motion tạo thành công, when đọc DB, then `params` có `trimStart`, `trimEnd`, `seconds`, `price`, `hold_amount = price`, job BullMQ có `jobId = taskId`.
- Given yêu cầu vượt Cap, when kiểm tra sổ cái, then không có bút toán HOLD hay Task của yêu cầu đó.
- Given Face Swap/Body Retouch, when chạy lại test hiện có, then pass nguyên vẹn.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build`, when chạy, then pass.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Ánh xạ lỗi Trim: mọi lỗi không phải `too_small` thành `TRIM_NOT_WHOLE_SECOND` | medium | patch | Đọc controller; đã chỉ ánh xạ theo nguyên nhân thật, kiểu sai/thiếu là `VALIDATION_FAILED`, kèm test |
| Cap bị bỏ qua nếu `maxVideoSeconds` không phải số hợp lệ | low | patch | So sánh với `NaN` luôn sai; đã ném lỗi và rollback HOLD, kèm test |
| Ca "chưa xác nhận" kiểm sai thứ (khóa không có dòng) | medium | patch | `.catch` nuốt lỗi; đã tạo dòng `pending` thật |
| Env khôi phục thành chuỗi 'undefined'; `after()` không dọn `uploads` | low | patch | Đã `delete` và `try/finally`, dọn thêm |
| Task Motion được tạo rồi luôn `failed` đến khi 5.5 | maybe-false | defer | Chủ ý theo quyết định 3A; cần cờ chặn route nếu triển khai trước 5.5 |
| `requiredAtStartup: true` làm hỏng môi trường thiếu biến | false | - | Biến đã thêm vào 19 file test, `compose.yml`, `compose.smoke.yml`, `.env.example`; có test khởi động thiếu biến |
| `TRIM_EXCEEDS_CAP` sau `INSUFFICIENT_CREDIT`/`TASK_LIMIT` | false | - | Spec ghi Cap kiểm trong transaction sau `wallet.hold` |
| Migration không `IF EXISTS`/`NOT VALID` | low | reject | Cùng mẫu migration body_retouch; bảng `tasks` nhỏ |
| Cap/độ dài làm tròn, TOCTOU giữa kiểm khóa và HOLD | low | defer | 5.2 lưu `floor`; cửa sổ ngắn, cùng mẫu pipeline khác |
| Thiếu test đồng thời cùng khóa | low | defer | Khóa dòng user đã có từ Epic 2 |

## Design Notes

`TRIM_EXCEEDS_CAP` chỉ biết được sau `wallet.hold` vì Cap nằm trong Tier Snapshot do ví khóa dòng và đọc trong transaction (AD-3); vì vậy kiểm ở bên trong transaction rồi ném lỗi để Prisma rollback cả HOLD, không hoàn tiền bằng bút toán mới. Hệ quả: người dùng thiếu credit và vượt Cap cùng lúc thấy `INSUFFICIENT_CREDIT` trước.

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần Postgres/Redis local; đặt `DATABASE_URL` khớp container)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
