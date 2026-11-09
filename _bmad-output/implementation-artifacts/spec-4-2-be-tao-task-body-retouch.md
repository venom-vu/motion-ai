---
title: 'Story 4.2: [BE] Tạo Task Body Retouch'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: 'dce5e17cc463f3013865027044d89655126ddc23'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BE chỉ hỗ trợ pipeline `face_swap`: không có `POST /tasks/body-retouch`, không đăng ký pipeline `body_retouch`, và worker không truyền `intensity` cho RunningHub, nên người dùng chưa thể HOLD 100 credit để chạy Body Retouch.

**Approach:** Đăng ký `body_retouch` trong `PIPELINE_CONFIGS` (workflow ID từ `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`, ảnh tham chiếu là ảnh đầu vào), thêm `createBodyRetouch` dùng lại khung transaction của `createFaceSwap`, và để worker thêm node `intensity` vào `nodeInfoList` từ `tasks.params`. Cùng hàng đợi, cổng, poll, sweeper và đường lỗi `NO_POSE` của Epic 2, không có đường riêng.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` và `deploy/` (nhánh `be/*`); dùng hợp đồng 4.1 (`BodyRetouchCreateRequestSchema`, `BodyRetouchCreateResponse`) từ `@flowvis/contracts`, không định nghĩa lại.
- Giá lấy từ `PRICING_CONFIG.pipelines.bodyRetouchCredits` (100), không nhận từ client. Chuyển trạng thái và bút toán chỉ qua `tasks.transition`/`wallet` (HOLD trong cùng transaction, enqueue sau commit, `jobId = taskId`).
- `intensity` lưu `params: { intensity }`; thiếu thì 5 theo schema; ngoài 1–10 hoặc không nguyên thì `VALIDATION_FAILED`, không HOLD, không tạo Task.
- Lỗi giống Face Swap: `ACCOUNT_LOCKED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT` (3 Task `queued`/`running`), khóa ảnh không thuộc người dùng thì `VALIDATION_FAILED` như hiện có. `consent` không có trong body (ToS đồng ý một lần khi đăng nhập, theo hợp đồng 4.1).
- Khởi động: thiếu `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` thì tiến trình `api` và `worker` không khởi động, thông báo nêu rõ tên biến thiếu. `.env.example` và `deploy/compose.smoke.yml` thêm biến này.
- Worker: node `intensity` khai báo trong cấu hình pipeline (`nodeId`/`fieldName` đánh dấu `[ASSUMPTION]` như Face Swap vì chưa xác nhận trên RunningHub), giá trị truyền dạng chuỗi; ảnh upload như hiện có.
- Test giả RunningHub qua `RunningHubPort`, không gọi mạng thật.

**Never:**
- Không sửa `apps/web`, `packages/contracts`; không thêm mã lỗi/`ReasonCode`; không thêm đường chuyển trạng thái hay bút toán riêng; không điền ánh xạ `CONTENT_BLOCKED` (Epic 6); không đổi hành vi Face Swap.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo hợp lệ | Số dư ≥ 100, `imageKey` hợp lệ, `intensity` 8 | Task `queued`, HOLD 100, `params.intensity`=8, enqueue sau commit | N/A |
| Thiếu intensity | Body chỉ có `imageKey` | `params.intensity`=5 | N/A |
| Intensity sai | `0`, `11`, `5.5`, `'5'` | 400 `VALIDATION_FAILED` | Không HOLD, không Task |
| Lỗi nghiệp vụ | Bị khóa / số dư < 100 / đã 3 Task hoạt động | `ACCOUNT_LOCKED` / `INSUFFICIENT_CREDIT` / `TASK_LIMIT` | Không HOLD, không Task |
| Worker gửi RunningHub | Task `body_retouch`, `intensity` 8 | `nodeInfoList` có node ảnh và node `intensity` = "8" | N/A |
| Workflow trả `NO_POSE…` | Lỗi RunningHub có tiền tố `NO_POSE` | Task `failed`/`NO_POSE`, RELEASED 100% qua `transition` | N/A |
| Thiếu biến workflow | Không có `RUNNINGHUB_WORKFLOW_BODY_RESHAPE` | `api` và `worker` không khởi động, báo tên biến | Thoát lỗi khi bootstrap |
| Hai pipeline cùng chạy | Face Swap + Body Retouch trong hàng đợi | Một hàng đợi, tối đa 2 Lane, Priority rồi FIFO | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/pipelines/pipeline-config.ts` -- `PIPELINE_CONFIGS`: thêm `body_retouch`; mở rộng `PipelineConfig` với ánh xạ tham số (`params.intensity` → node). `RH_FAILURE_PREFIX_MAP` đã có `NO_POSE`, không sửa.
- `apps/api/src/modules/pipelines/pipelines.service.ts` -- `getWorkflowId`; thêm kiểm tra biến môi trường lúc khởi động.
- `apps/api/src/modules/tasks/tasks.service.ts` -- `createFaceSwap` (~dòng 362) là mẫu; thêm `createBodyRetouch`, cân nhắc tách phần chung HOLD/enqueue; `getResult` đã dùng `referenceInputKey`.
- `apps/api/src/modules/tasks/tasks.controller.ts` -- thêm `@Post('body-retouch')`, parse bằng `BodyRetouchCreateRequestSchema`.
- `apps/api/src/modules/tasks/task-worker.service.ts` -- `runFromUpload` (~dòng 188–230) dựng `nodeInfo`: thêm node từ `row.params`.
- `apps/api/.env.example`, `deploy/compose.smoke.yml` -- thêm `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`.
- `apps/api/test/` -- mẫu: `task-worker.test.mjs`, `tasks.test.mjs`, `task-priority.test.mjs` (đều set `RUNNINGHUB_WORKFLOW_FACESWAP`: bổ sung biến mới nếu kiểm tra khởi động bắt buộc).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/pipelines/pipeline-config.ts`, `pipelines.service.ts` -- đăng ký `body_retouch`, ánh xạ `intensity`, kiểm tra biến lúc khởi động -- cấu hình pipeline
- [x] `apps/api/src/modules/tasks/tasks.service.ts`, `tasks.controller.ts` -- `createBodyRetouch` và endpoint -- HOLD + enqueue
- [x] `apps/api/src/modules/tasks/task-worker.service.ts` -- thêm node `intensity` vào `nodeInfoList` -- truyền tham số workflow
- [x] `apps/api/.env.example`, `deploy/compose.smoke.yml`, các test hiện có cần biến mới -- khai báo biến môi trường
- [x] `apps/api/test/body-retouch.test.mjs` -- test đủ I/O Matrix với `RunningHubPort` giả -- phủ ranh giới

**Acceptance Criteria:**
- Given người dùng đủ điều kiện, when gọi `POST /tasks/body-retouch`, then phản hồi trong 2 giây là Task `queued` cùng hình dạng Face Swap và sổ cái có đúng một HOLD 100.
- Given Face Swap và Body Retouch cùng trong hàng đợi, when worker chạy, then dùng chung hàng đợi, không quá 2 Task đồng thời.
- Given test BE, when chạy `pnpm --filter @flowvis/api test`, then toàn bộ test cũ và mới đều qua.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Thiếu test `referenceInputKey` của `body_retouch` (ingestor bị stub trong test mới) | medium | patch | Chỉ có assert cho `face_swap`; đã thêm assert cấu hình cạnh test Face Swap trong `task-result.test.mjs`. Ingestor đọc cấu hình theo pipeline nên assert cấu hình đủ bắt hồi quy |
| Test khởi động chỉ gọi trực tiếp `onModuleInit`, không boot `bootstrapApi`/worker | low | reject | `AppModule` nạp `PipelinesModule` (đã kiểm), hook là vòng đời Nest chuẩn; bản boot thật làm treo tiến trình test. Sửa phức tạp hơn mức lợi |
| Tham số thiếu/null trong `params` bị bỏ qua âm thầm ở worker; `String(v)` với đối tượng; vòng lặp nằm trong try của upload | low | reject | `params` chỉ do `createBodyRetouch` ghi, luôn có `intensity` số nguyên đã validate; không có đường tạo hàng thiếu |
| `nodeId` 10/20 chưa xác nhận trên RunningHub | low | reject | Đã đánh dấu `[ASSUMPTION]` theo spec; chỉ chạy thật mới xác nhận được. Ghi vào tóm tắt cho người dùng |
| Biến env khác tên chỉ có ở `.env.example`/smoke; thiếu ở compose khác | false | - | Grep `deploy/`: `RUNNINGHUB_WORKFLOW_FACESWAP` cũng chỉ có ở `compose.smoke.yml`, các compose khác không liệt kê biến RunningHub |
| Upload không phải ảnh dùng làm `imageKey` | false | - | `areConfirmedKeysOwnedBy` lọc `kind: 'image'` (`uploads.service.ts:239`) |
| Khóa trùng làm lệch đếm sở hữu | false | - | Hàm đã khử trùng bằng `Set` (`uploads.service.ts:234`) |
| `onModuleInit` chấp nhận biến toàn khoảng trắng | false | - | `getWorkflowId` đã `trim()` và coi rỗng là thiếu |
| Truy vấn giới hạn/vị trí hàng đợi lọc theo `face_swap` | false | - | Grep `tasks.service.ts`: không truy vấn nào lọc theo pipeline |
| `saved` thành chuỗi "undefined" khi khôi phục env | false | - | Test đặt `??=` ở đầu file nên `saved` luôn có giá trị |
| Migration thiếu `IF EXISTS`/`NOT VALID`, khóa bảng | low | reject | Tên ràng buộc đã xác nhận ở migration `20261105000000_tasks`; bảng nhỏ ở MVP; cùng phong cách migration cũ |
| Validate trùng lặp (controller + service), message khác nhau | low | reject | Service parse lại là phòng thủ có chủ đích, nhánh lỗi không tới được qua HTTP |
| Test hàng đợi chung yếu; thiếu ca `intensity` null/âm; thiếu test EXIF/hủy/PREP_TIMEOUT cho Body Retouch | low | reject | Hàng đợi/EXIF/hủy dùng chung mã Epic 2 đã có test; Body Retouch gọi cùng `createPipelineTask`; ca `intensity` sai thuộc schema 4.1 đã test |
| Chuỗi pipeline lặp ở 4 nơi; boilerplate env ở 14 file test | low | reject | Nợ thiết kế nhỏ, chưa gây lỗi; sửa là refactor ngoài phạm vi story |

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: chỉ báo các file `_bmad-output/**` chưa commit (ngoài mã story)

### Review Findings

- [x] [Review][Patch] Test khởi động chỉ gọi tay `onModuleInit()`, không chứng minh Nest gọi hook; nếu `PipelinesService` mất `implements OnModuleInit` hoặc `PipelinesModule` không được nạp thì test vẫn pass và api/worker vẫn khởi động thiếu biến [apps/api/test/body-retouch.test.mjs:519]
- [x] [Review][Defer] `nodeId`/`fieldName` của `body_retouch` (`10`/`image`, `20`/`intensity`) còn `[ASSUMPTION]`, test chỉ phản chiếu lại chính cấu hình qua `rh` giả [apps/api/src/modules/pipelines/pipeline-config.ts:58] — deferred: cần một lần chạy thật trên RunningHub (smoke Story 4.6) để xác nhận; cùng tình trạng với `face_swap`

#### Rejected

- Worker bỏ qua `intensity` thiếu/`null` rồi vẫn tính phí — low, reject: `createBodyRetouch` luôn ghi `intensity` (mặc định 5), chỉ xảy ra với dòng chèn tay; thêm nhánh chặn là thêm phức tạp.
- `String(v)` ra `[object Object]`/`NaN`, `row.params` sai kiểu — low, reject: `params` do server ghi từ schema đã kiểm.
- Lỗi ánh xạ param nằm trong try upload — false: khối đó không có đường ném lỗi nào cho param.
- Biến môi trường rỗng/khoảng trắng qua được kiểm tra — false: `getWorkflowId` đã `trim()` và coi rỗng là thiếu.
- Các manifest deploy khác thiếu biến — false: `deploy/compose.yml` và `compose.local.yml` không khai báo bất kỳ `RUNNINGHUB_*` nào (kể cả Face Swap); spec chỉ yêu cầu `.env.example` và `compose.smoke.yml`.
- `inputKeys` rỗng/trùng bỏ qua kiểm tra sở hữu; nhánh khác chỉ xử lý `face_swap` — false: người gọi cố định khóa; grep `apps/api/src` không còn nhánh `face_swap` nào khác.
- Migration khóa bảng, thiếu `IF EXISTS`/rollback — low, reject: bảng `tasks` nhỏ ở MVP, ràng buộc tên cố định do chính migration đầu tạo.
- Migration không có trong Code Map của spec — reject: sửa là chỉnh spec đang review.
- `process.env` khôi phục thành chuỗi `'undefined'` — low, reject: `??=` đầu file đảm bảo `saved` luôn có giá trị.
- Re-parse trong service trả thông báo chung — low, reject: vẫn đúng mã `VALIDATION_FAILED`.
- Thiếu test hàng đợi hỗn hợp/FIFO/đo 2 giây/`nodeId`; boilerplate `??=` ở ~14 file test; dọn dẹp bảng `upload`; kiểu `params` lỏng — low, reject: không gặp trong dùng thực tế, sửa là thêm test hoặc refactor.
