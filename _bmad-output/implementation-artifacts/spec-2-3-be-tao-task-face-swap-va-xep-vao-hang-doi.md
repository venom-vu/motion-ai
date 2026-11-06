---
title: 'Story 2.3: [BE] Tạo Task Face Swap và xếp vào hàng đợi'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'db6bbabdc21458ab8b8edfa1e42681e0eba551dd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chưa có đường tạo Task: không có bảng `tasks`, không có `POST /tasks/face-swap`, nên credit chưa được giữ (HOLD) và ảnh `in/` đã xác nhận ở Story 2.2 chưa được dùng vào đâu.

**Approach:** Module `tasks` (chủ duy nhất của bảng `tasks`) cung cấp `tasks.create` mở transaction: kiểm giới hạn → `wallet.hold` → INSERT Task `queued`; sau commit enqueue BullMQ `jobId = taskId`. Migration dựng bảng `tasks` và khóa ngoại `ledger_entries.task_id`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` (tiền tố `be/*`); dùng `FaceSwapCreateRequestSchema`, `TaskSchema`, `ApiErrorCode` từ `@motion-ai/contracts`; không sửa `packages/contracts`.
- Route `POST /tasks/face-swap` (201) dùng `JwtAuthGuard` + `AccountLockedGuard`. Body parse lỗi ở trường `consent` → `CONSENT_REQUIRED`; lỗi khác → `VALIDATION_FAILED`; không HOLD, không tạo Task.
- Giá lấy từ `PRICING_CONFIG.pipelines.faceSwapCredits` (100); client không gửi giá. `tos_version` lấy từ `users.tos_version` của người dùng; `consent = true` lưu trên Task.
- Hai khóa `in/` phải thuộc `user.sub` và đã `confirmed` (đọc qua một phương thức công khai mới của `UploadsService`, không SQL thô vào bảng `uploads`); sai chủ hoặc chưa xác nhận → `VALIDATION_FAILED`, không lộ tồn tại khóa người khác.
- `tasks.create` mở `tx` (`prisma.$transaction`): khóa dòng user (`FOR UPDATE`) → đếm Task `queued`/`running` của user, ≥ 3 → `TASK_LIMIT` → `wallet.hold(tx, userId, taskId, 100)` (nhận Tier Snapshot; thiếu số dư → `INSUFFICIENT_CREDIT`) → INSERT Task. `taskId` sinh trước bằng `crypto.randomUUID()`.
- Bảng `tasks`: `id`, `user_id`, `pipeline`, `status`, `reason_code`, `tier_snapshot` (JSONB), `consent`, `tos_version`, `input_keys` (JSONB), `params` (JSONB), `hold_amount`, `queued_at`, `enqueue_attempts` (mặc định 0), `created_at`, `updated_at`. `CHECK` trong SQL thô: `status` ∈ 6 trạng thái, `pipeline` ∈ `face_swap`, `consent = true`, `hold_amount > 0`. Chỉ mục `(user_id, status)` và `(status, queued_at)`.
- Khóa ngoại `ledger_entries.task_id → tasks(id)` khai báo `DEFERRABLE INITIALLY DEFERRED` (HOLD được INSERT trước Task trong cùng transaction). Chưa có Task nào trong DB nên mọi `task_id` hiện có trong sổ cái phải là NULL hoặc migration xóa/bỏ qua kiểm tra dữ liệu cũ bằng `NOT VALID` rồi `VALIDATE` sau; chọn `NOT VALID` để migration không thất bại trên DB dev có dữ liệu thử.
- Các test hiện có gọi `wallet.hold`/`capture`/`release` với `taskId` ngẫu nhiên (`wallet.test.mjs`, `reconcile-script.test.mjs`, `tier.test.mjs`…) sẽ vi phạm FK: sửa phần chuẩn bị của các test đó để INSERT một dòng `tasks` hợp lệ trước khi HOLD; không đổi logic `wallet.service.ts`.
- Sau commit mới enqueue hàng đợi `tasks` với `jobId = taskId`, `priority = tier_snapshot.priority`, `removeOnComplete: true`, `removeOnFail: true`. Enqueue lỗi chỉ log (Task `queued` vẫn nằm trong DB, bộ quét sau này enqueue lại), phản hồi vẫn 201.
- Phản hồi là `Task` hợp lệ theo `TaskSchema`: `queuePosition` tính từ DB theo `(priority, queued_at, id)` trong số Task `queued`, `creditCost = hold_amount`.
- Mọi test dùng Queue giả và PostgreSQL thật; không gọi RunningHub/R2.

**Never:**
- Không viết worker/processor, bộ quét, chuyển trạng thái, hủy, GET /tasks (Story 2.4–2.8, 2.12); không sửa logic `wallet.service.ts`; không nhận `holdAmount`/`priority` từ client; không enqueue trong transaction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo thành công | số dư ≥ 100, 2 khóa `in/` confirmed, `consent: true` | 201 Task `queued`, HOLD −100, `held` +100, job `jobId = taskId` với priority theo Tier | N/A |
| Thiếu/sai consent | `consent: false` hoặc vắng | Không HOLD, không Task, không job | `CONSENT_REQUIRED` |
| Tài khoản khóa | `locked_at` khác rỗng | Không Task | `ACCOUNT_LOCKED` |
| Thiếu số dư | balance 99 | Không Task, số dư giữ nguyên | `INSUFFICIENT_CREDIT` |
| Đã 3 Task hoạt động | 3 Task `queued`/`running` | Không HOLD | `TASK_LIMIT` |
| Khóa không hợp lệ | khóa người khác / chưa confirmed / sai định dạng | Không Task | `VALIDATION_FAILED` |
| Ba request song song | số dư 250, 3 request | Đúng 2 thành công, 1 `INSUFFICIENT_CREDIT`, balance ≥ 0 | N/A |
| Crash sau commit | enqueue ném lỗi | Task `queued` + HOLD còn trong DB, phản hồi 201 | log lỗi |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/index.ts`, `tasks.module.ts` -- hiện `TasksModule` rỗng; thêm service, controller, đăng ký queue `tasks`, import `AuthModule`, `WalletModule`, `StorageModule`.
- `apps/api/src/modules/wallet/wallet.service.ts` -- `hold(tx, userId, taskId, amount)` đã khóa user, trả `TierSnapshot`; tái dùng, không sửa. `PRICING_CONFIG` ở `wallet/tier.ts`.
- `apps/api/src/modules/storage/uploads.service.ts` -- thêm phương thức công khai kiểm khóa `in/` thuộc user và `confirmed`.
- `apps/api/src/modules/storage/uploads.controller.ts` -- mẫu controller/guard/`safeParse`.
- `apps/api/src/infra/infra.module.ts` -- `BullModule.forRootAsync` đã có; dùng `BullModule.registerQueue({ name: 'tasks' })`.
- `apps/api/prisma/schema.prisma`, `prisma/migrations/` -- model `Task`, quan hệ `User`/`LedgerEntry`; migration mới kèm `CHECK` và FK hoãn.
- `apps/api/test/wallet.test.mjs`, `uploads.test.mjs` -- mẫu `ensureInfra`, bootstrap API, JWT test; ghi đè provider bằng Queue giả.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, migration mới -- bảng `tasks`, `CHECK`, chỉ mục, FK `ledger_entries.task_id` hoãn -- AC migration
- [x] `apps/api/src/modules/storage/uploads.service.ts` -- phương thức kiểm khóa `in/` đã xác nhận của user -- giữ AD-1
- [x] `apps/api/src/modules/tasks/*` -- `TasksService.create`, `TasksController`, module, hằng số giới hạn 3 -- logic chính
- [x] `apps/api/test/{wallet,reconcile-script,tier,...}.test.mjs` -- thêm helper tạo dòng `tasks` trước mỗi HOLD dùng `taskId` giả -- giữ test ví xanh sau khi có FK
- [x] `apps/api/test/tasks.test.mjs` -- phủ I/O Matrix trên PostgreSQL thật với Queue giả, gồm 3 request song song và kiểm `CHECK`/FK -- xác minh

**Acceptance Criteria:**
- Given migration, when chạy trên PostgreSQL thật, then có bảng `tasks` đủ cột và `ledger_entries.task_id` có khóa ngoại tới `tasks`.
- Given đủ điều kiện, when gọi `POST /tasks/face-swap`, then HOLD và Task được ghi cùng một transaction, enqueue sau commit, phản hồi dưới 2 giây.

## Implementation Notes

- Mã trạng thái HTTP chọn: `TASK_LIMIT` 429, `INSUFFICIENT_CREDIT` 402 (spec không quy định).
- FK `ledger_entries.task_id` là `NOT VALID`; có thể `VALIDATE CONSTRAINT` ở migration sau.
- Fixture test `withTaskRows` tạo Task `succeeded` để không làm nhiễu hàng đợi của test khác.
- Xác minh: lint, typecheck, build, `check:boundaries` qua; `pnpm --filter @motion-ai/api test` 145 pass, 0 fail, 2 skip có sẵn; `tasks.test.mjs` 16/16.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `queuePosition` bind lại `queued_at` từ `Date` JS (mất micro giây) nên `<=` có thể loại chính dòng, `Math.max(1,…)` che lỗi | medium | patch | Postgres lưu micro giây, JS Date chỉ mili giây; sửa: so sánh với subselect theo id; test vị trí 1,2,3 và priority 1 xếp trước, đảo `<=` làm test fail |
| Lỗi sau commit (`queuePosition` ném) trả 500 dù HOLD và Task đã commit, retry HOLD lần hai | medium | patch | Code cũ không bọc try/catch; sửa: rơi về vị trí 1 và log cảnh báo |
| Không kiểm lại `locked_at` dưới khóa dòng user (AD-18) | low | patch | Guard chạy trước transaction, khoảng hở có thật; sửa: chọn `locked_at` trong câu FOR UPDATE, ném `ACCOUNT_LOCKED`; có test gọi thẳng service |
| Thiếu test: vị trí chính xác, TASK_LIMIT song song 4 request, `running` tính/terminal không tính, priority hạng trả phí | medium | patch | Verification-gap đã xác minh; đảo `running`, hard-code priority 10 hoặc đảo `<=` ban đầu không làm test nào fail; đã thêm test và chạy đột biến, cả ba lần đều fail |
| Fixture `withTaskRows` tạo Task `queued` làm nhiễu vị trí/giới hạn của test chạy song song | low | patch | Chạy toàn bộ suite làm test vị trí fail; sửa: fixture tạo Task `succeeded` |
| Thiếu patch test `reconcile-script`/khác khi có FK | false | - | Các file đó không gọi `wallet.hold`; toàn bộ suite 145 pass |
| `queue.add` có thể treo khi Redis mất kết nối, vi phạm AC 2 giây | maybe-false | defer | `maxRetriesPerRequest: null` nên lệnh xếp hàng chờ; cần thử tắt Redis để xác nhận trước khi thêm timeout |
| `enqueue_attempts` không tăng khi enqueue lỗi | low | reject | Spec giao việc tăng cho bộ quét (AD-6), chưa có trong story này |
| Giao dịch tương tác quá timeout mặc định 5 giây khi chờ khóa user (P2028) | maybe-false | defer | Chưa chứng minh được tải đạt ngưỡng; cần test chờ khóa lâu |
| `sourceKey` trùng `targetKey` | low | reject | Hợp đồng 2.1 không cấm; không gây hại tiền/dữ liệu, đổi cần sửa contracts |
| Khóa upload kiểm ngoài transaction | false | - | Upload `confirmed` không quay lại trạng thái khác; chỉ `pending` mới hết hạn |
| `tos_version` null | false | - | Cột `users.tos_version` NOT NULL |
| Thiếu Idempotency-Key | low | reject | Ngoài AC; giới hạn 3 Task chặn hậu quả lớn, thuộc AD-17 |
| CONSENT_REQUIRED che lỗi khóa khác; thông báo Zod lộ nguyên văn | low | reject | Do thiết kế của story (consent ưu tiên); thông báo từ contracts đã bằng tiếng Việt |
| FK `NOT VALID` chưa validate; CASCADE `tasks.user_id` so với RESTRICT sổ cái; thiếu CHECK `reason_code` | low | reject | Spec đã chốt `NOT VALID`; xóa user không phải luồng MVP; ràng buộc `reason_code` thuộc Story 2.4 |
| `Queue.prototype.add` bị ghi đè không khôi phục; assert `Date.now()` 2 giây; chuỗi `.replace` khó đọc | low | reject | `node --test` chạy mỗi file một tiến trình; 2 giây theo AC; chỉ là thẩm mỹ test |
| Thiếu test rollback khi INSERT Task lỗi | low | reject | Atomicity do `$transaction`; sửa thêm nhánh giả lập lỗi, không đáng |
| Tên `createFaceSwap` thay vì `tasks.create` | low | reject | Chỉ là tên; phản hồi theo AC |
| Test throttle auth `signup-grant` flaky khi chạy cả bộ | low | defer | Có từ trước: các file test chạy song song dùng chung bộ đếm Redis; diff này không đụng auth |

## Design Notes

FK `ledger_entries.task_id` phải `DEFERRABLE INITIALLY DEFERRED` vì thứ tự AD-3 là `wallet.hold` (INSERT `HOLD` có `task_id`) rồi mới INSERT Task. `taskId` sinh ở ứng dụng để truyền cho `hold`. Khóa dòng user dùng chung với `wallet.hold` nên đếm giới hạn 3 an toàn trước các request song song.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass

### Review Findings

- [x] [Review][Patch] Test "khóa chưa confirmed" không ghim điều kiện `status: 'confirmed'`: helper `confirmedKeys(u, 1, false)` tạo upload `pending` với `confirmedKey: null`, nên ca này trùng ca "không tồn tại"; xóa `status: 'confirmed'` khỏi `where` thì test vẫn xanh. Cần tạo upload `pending` có `confirmedKey` đặt sẵn rồi kỳ vọng 400, 0 Task, `held == 0` [apps/api/test/tasks.test.mjs:809-828]
- [x] [Review][Patch] `queue.add` không có timeout: Redis treo (`maxRetriesPerRequest: null`) làm phản hồi vượt 2 giây (AC2); test thay `Queue.prototype.add` bằng stub nên không bao giờ chạm ca treo. Bọc bằng `Promise.race` có timeout, lỗi thì chỉ log như hiện tại (bộ quét ở 2.7 enqueue lại) [apps/api/src/modules/tasks/tasks.service.ts:459-472]
- [x] [Review][Patch] Chưa có test rollback khi INSERT Task lỗi: tính nguyên tử HOLD + Task (AD-3) không được test nào khẳng định [apps/api/test/tasks.test.mjs]
- [x] [Review][Defer] FK `ledger_entries_task_id_fkey` ở trạng thái `NOT VALID`, chưa có migration `VALIDATE CONSTRAINT` [apps/api/prisma/migrations/20261105000000_tasks/migration.sql:206-208] — deferred: spec đã chủ ý chấp nhận; cần migration validate sau khi dữ liệu dev sạch
- [x] [Review][Defer] `areConfirmedKeysOwnedBy` chưa lọc `kind: 'image'`; khi Story 5.2 thêm upload video, khóa video `in/` sẽ lọt vào Face Swap [apps/api/src/modules/storage/uploads.service.ts:266] — deferred: hiện chỉ có kind `image`; xử lý khi làm Epic 5
- [x] [Review][Defer] Không có Idempotency-Key/chống bấm đúp: double-click tạo 2 Task, HOLD 200 credit (giới hạn 3 Task chặn mức thiệt hại) [apps/api/src/modules/tasks/tasks.service.ts:411-457] — deferred: xử lý ở FE (khóa nút khi đang gửi, Story 2.11); hoàn credit được qua hủy Task
- [x] [Review][Defer] Enqueue lỗi chỉ được log, `enqueue_attempts` giữ 0, không dấu vết cho ops [apps/api/src/modules/tasks/tasks.service.ts:459-472] — deferred: bộ quét ở Story 2.7 sẽ tìm Task `queued` chưa có job và ghi nhận số lần thử
- [x] [Review][Defer] Test `signup-grant` về throttle chập chờn làm bộ test đầy đủ kém tin cậy — deferred: đã có trong deferred-work từ trước, không do Story 2.3

#### Rejected

- `queued_at` là thời điểm bắt đầu transaction (low): lệch cỡ mili giây, FIFO đảo gần như không gặp; sửa thêm logic không đáng.
- Thiếu index cho `queuePosition` (low): hàng đợi MVP nhỏ; sửa cần cột `priority` thật và migration, vượt mức hợp lý lúc này.
- `tasks.user_id` CASCADE mâu thuẫn RESTRICT của ledger (low): xóa user đã bị `ledger_entries.user_id RESTRICT` chặn trước, CASCADE không bao giờ chạy trên user có sổ cái.
- `sourceKey === targetKey` vẫn bị trừ 100 credit (low): do chính người dùng chọn, chặn thêm nhánh không đáng.
- Khóa upload kiểm tra ngoài transaction (false): upload `confirmed` không bị xóa hay hết hạn (chỉ `pending` mới `expired`), nên không có cửa sổ lỗi.
- `rows.length === unique.length` sai khi trùng/rỗng (false): schema bắt buộc 2 khóa; `confirmedKey` dẫn xuất từ `key` duy nhất nên không trùng.
- `priority` bằng 0 hoặc không nguyên (false): `tier.ts` chỉ có 5/10/15/20, luôn nguyên dương.
- P2028 do tx quá 5 giây thành 500 (low): chỉ khi tranh chấp khóa của chính một user; hiếm, sửa thêm ánh xạ lỗi.
- `queuePosition` fallback `Math.max(1, …)` (low): chỉ là giá trị hiển thị.
- Lỗi validation lộ câu Zod, `CONSENT_REQUIRED` ghi đè lỗi khác (low): chỉ thông điệp, không ảnh hưởng nghiệp vụ.
- Helper test `withTaskRows` vá `wallet.hold`, vá `Queue.prototype.add`, mẹo SQL `consent` (low): chỉ trong test, vẫn kiểm đúng hành vi.
- Tên `createFaceSwap` thay `tasks.create`; `reconcile-script.test.mjs` không được vá; frontmatter `done` lệch sprint-status: sửa đều là sửa chính spec, mà mã đã khớp hành vi.
