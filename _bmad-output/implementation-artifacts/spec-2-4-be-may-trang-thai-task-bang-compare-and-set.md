---
title: 'Story 2.4: [BE] Máy trạng thái Task bằng compare-and-set'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '89e5ab02dfab049ef70fbebd75720c3d35063cff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Task chỉ mới được tạo (Story 2.3); chưa có cách đổi trạng thái an toàn nên credit đang HOLD không bao giờ được CAPTURED hay RELEASED, kết quả đến muộn có thể ghi đè trạng thái, người dùng không hủy được Task `queued` và không xem được Task của mình.

**Approach:** Module `tasks` thêm `TasksService.transition(taskId, from, to, reasonCode)` là cửa duy nhất đổi trạng thái: một `UPDATE … WHERE id AND status=from` trong transaction do `tasks` mở, kèm `wallet.capture`/`wallet.release` cùng transaction. Thêm `POST /tasks/:id/cancel` và `GET /tasks/:id` dựa trên đó.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` (tiền tố `be/*`); dùng `TaskSchema`, `TaskIdParamsSchema`, `getReasonCodeMessageVi`, `ApiErrorCode` từ `@motion-ai/contracts`; không sửa `packages/contracts`, không sửa logic `wallet.service.ts`.
- Bảng chuyển hợp lệ duy nhất: `queued→running|cancelled|timed_out|failed`, `running→succeeded|failed|timed_out`; mọi cặp khác bị từ chối trước khi chạm DB bằng lỗi lập trình (`Error`, không phải HTTP) để không ai gọi nhầm.
- `reasonCode` phải thỏa bất biến của `TaskSchema`: `failed`/`timed_out`/`cancelled` bắt buộc có; `running`/`succeeded` không được có; `cancelled` chỉ `USER_CANCEL`; `PREP_TIMEOUT`, `FREE_WAIT_EXPIRED`, `RH_TIMEOUT`, `RH_GATE_TIMEOUT` chỉ cho `timed_out`; `timed_out` chỉ nhận bốn mã đó. Vi phạm → từ chối như trên.
- `transition` mở `prisma.$transaction`: `UPDATE tasks SET status=to, reason_code=?, updated_at=now() [, result_key] WHERE id=? AND status=from RETURNING …`. 0 dòng → trả `{ applied: false }` im lặng, sổ cái không đổi. 1 dòng → sang `succeeded` gọi `wallet.capture(tx, taskId)`; sang `failed|timed_out|cancelled` gọi `wallet.release(tx, taskId)`; sang `running` không đụng ví. Lỗi ví làm rollback cả UPDATE.
- Chuyển sang `succeeded` nhận `resultKey` (định dạng `out/<userId>/<uuid>` theo `TaskSchema`) lưu vào cột mới `result_key` (nullable); migration thêm cột này và `CHECK (status <> 'succeeded' OR result_key IS NOT NULL)` cùng `CHECK (status = 'succeeded' OR result_key IS NULL)`. Không thêm cột thời gian nào khác (Story 2.5).
- Redis `SET task:terminal:<taskId> 1 NX EX 30` chỉ là bộ lọc nhanh khi chuyển sang trạng thái kết thúc: bọc try/catch, lỗi hoặc Redis tắt thì bỏ qua và vẫn đi tiếp tới UPDATE; khóa tồn tại (mồ côi) cũng không được chặn UPDATE.
- `POST /tasks/:id/cancel` (200; `JwtAuthGuard` + `AccountLockedGuard`): chỉ chủ Task; không phải chủ hoặc không tồn tại → `NOT_FOUND`; Task `running` hoặc đã kết thúc, hoặc CAS ảnh hưởng 0 dòng → `CONFLICT`. Thành công: `transition(queued→cancelled, USER_CANCEL)` rồi xóa job BullMQ `jobId = taskId` (nỗ lực tốt nhất, lỗi chỉ log), trả `Task`.
- `GET /tasks/:id` (200): chỉ chủ Task, người khác hoặc không tồn tại → `NOT_FOUND`. Trả `Task` hợp lệ theo `TaskSchema`: `queuePosition` chỉ khi `queued`, tính từ CSDL theo số Task `queued` đứng trước theo `(priority, queued_at, id)` (tái dùng truy vấn hiện có của 2.3); `reasonCode`, `resultKey` từ cột; `creditCost = hold_amount`.
- Mọi test dùng PostgreSQL thật, Queue giả, không gọi RunningHub/R2.

**Never:**
- Không viết worker/processor, bộ quét, cột thời gian `running_at`/`deadline_at`/`finished_at`…, `GET /tasks` (danh sách), `GET /tasks/:id/result`, chia sẻ (Story 2.5–2.9, 2.12).
- Không `UPDATE tasks SET status` ngoài `transition`; không dùng `status NOT IN (…)` làm điều kiện; không để Redis quyết định có đi tiếp hay không.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hoàn thành | Task `running` có HOLD, `transition(running→succeeded, resultKey)` | `applied: true`, đúng một `CAPTURED`, `held` −100, `result_key` ghi | N/A |
| Thất bại / hết hạn | `running→failed(NO_FACE)` hoặc `queued→timed_out(FREE_WAIT_EXPIRED)` | `applied: true`, đúng một `RELEASED` +100, balance hoàn | N/A |
| Kết quả đến muộn | Task đã `timed_out`, gọi `running→succeeded` | `applied: false`, sổ cái và trạng thái không đổi | im lặng |
| Hai bên kết thúc song song | `running→succeeded` và `running→timed_out` cùng lúc | Đúng một bên `applied: true`, đúng một `CAPTURED` hoặc `RELEASED` | N/A |
| Chuyển ngoài bảng | `succeeded→running`, `queued→succeeded` | Từ chối trước khi chạm DB | `Error` |
| reasonCode sai | `failed` không mã; `cancelled` + `NO_FACE`; `failed` + `PREP_TIMEOUT` | Từ chối trước khi chạm DB | `Error` |
| Redis tắt / khóa mồ côi | `task:terminal:<id>` còn hoặc Redis lỗi | Chuyển vẫn chạy, ghi đúng một bút toán | N/A |
| Hủy Task `queued` | chủ Task gọi cancel | 200 `cancelled`/`USER_CANCEL`, RELEASED, gọi xóa job `jobId` | N/A |
| Hủy sai | Task `running`/đã kết thúc | Không đổi | `CONFLICT` |
| Hủy/xem Task người khác | user B với Task của A | Không đổi, không lộ tồn tại | `NOT_FOUND` |
| Xem Task `queued` | 2 Task `queued` cùng priority | `queuePosition` 1 và 2 theo FIFO | N/A |
| Xem Task `failed` | có `reason_code` | `reasonCode` trả về, không có `queuePosition` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/tasks.service.ts` -- thêm `transition`, `cancel`, `getById`; tái dùng `queuePosition(taskId)` (private, sẽ dùng chung), `TASKS_QUEUE`, tiêm `RedisService`.
- `apps/api/src/modules/tasks/tasks.controller.ts` -- thêm `POST :id/cancel` (HttpCode 200) và `GET :id`; mẫu `safeParse` + guard đã có cho `face-swap`.
- `apps/api/src/modules/tasks/task-transitions.ts` (mới) -- bảng chuyển hợp lệ và hàm thuần kiểm `reasonCode` theo bất biến `TaskSchema`.
- `apps/api/src/modules/wallet/wallet.service.ts` -- `capture(tx, taskId)`, `release(tx, taskId)` đã khóa user và chống chốt hai lần (`WalletConflictException`); tái dùng, không sửa.
- `apps/api/src/infra/redis.service.ts` -- `RedisService.client` (ioredis) cho `SET NX EX`; `InfraModule` là `@Global`.
- `apps/api/prisma/schema.prisma`, `prisma/migrations/` -- thêm `resultKey` vào model `Task` và migration cột `result_key` + hai `CHECK`.
- `apps/api/test/tasks.test.mjs`, `test/helpers/task-fixture.mjs` -- mẫu `newUser`, `post`, Queue giả; fixture tạo Task `succeeded` (không dùng cho test mới, tạo Task thật qua API hoặc SQL).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, migration mới -- cột `result_key` + `CHECK` -- lưu kết quả để `Task` hợp lệ
- [x] `apps/api/src/modules/tasks/task-transitions.ts` -- bảng chuyển và kiểm `reasonCode` -- chặn chuyển sai
- [x] `apps/api/src/modules/tasks/tasks.service.ts` -- `transition` (CAS + ví + Redis hint), `cancel`, `getById` -- logic chính
- [x] `apps/api/src/modules/tasks/tasks.controller.ts` -- `POST /tasks/:id/cancel`, `GET /tasks/:id` -- bề mặt API
- [x] `apps/api/test/task-transitions.test.mjs` -- phủ I/O Matrix trên PostgreSQL thật, gồm hai bên kết thúc song song, Redis lỗi, khóa mồ côi, đột biến CAS -- xác minh

**Acceptance Criteria:**
- Given chuyển hợp lệ, when CAS thành công, then trạng thái và bút toán ví (CAPTURED hoặc RELEASED) được ghi trong cùng một transaction.
- Given hai chuyển kết thúc song song trên PostgreSQL thật, when chạy, then đúng một bên thắng và đúng một bút toán kết thúc được ghi.
- Given Redis tắt hoặc khóa mồ côi, when chuyển trạng thái, then vẫn chạy bình thường.

## Implementation Notes

- `transition(taskId, from, to, reasonCode, { resultKey })`; `resultKey` phải là `out/<user_id của Task>/<uuid>` và chỉ dùng khi sang `succeeded`.
- Hint Redis `task:terminal:<id>` đặt sau commit, chỉ khi `applied`; lỗi Redis bị bỏ qua.
- `cancel` xóa job BullMQ nỗ lực tốt nhất: Story 2.5 phải bỏ job nếu CAS `queued→running` ảnh hưởng 0 dòng.
- Script `test` của api thêm `--test-concurrency=1` vì các file test dùng chung PostgreSQL/Redis.
- Xác minh: lint, typecheck, build, `check:boundaries` qua; `pnpm --filter @motion-ai/api test` 165 test, 163 pass, 0 fail, 2 skip có sẵn (hai lần liên tiếp); `task-transitions.test.mjs` 18/18; đột biến CAS, capture, release, guard `resultKey`, hint Redis đều làm test fail.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `resultKey` dùng regex `[0-9a-f-]{36}` nhận chuỗi 36 dấu gạch và không kiểm chủ Task, worker lỗi có thể gắn key người khác | medium | patch | `GET /tasks/:id` trả `resultKey` nguyên văn; sửa: regex UUID thật, so tiền tố `out/<user_id>/` trong transaction (rollback, chưa capture); bỏ guard thì test 7, 8 fail |
| Hint Redis `task:terminal` đặt trước transaction, còn lại khi CAS trả `applied:false` hoặc rollback | medium | patch | Khóa NX bỏ qua kết quả; sửa: đặt sau commit và chỉ khi `applied`; đặt vô điều kiện thì test 8 fail |
| Test "lỗi ví rollback" có thể pass mà không kiểm gì (HOLD không xóa được) | medium | patch | Đã viết lại: chèn sẵn `RELEASED` làm `wallet.release` ném sau UPDATE, kiểm Task vẫn `running` |
| Thiếu test: `resultKey` rác/người khác, `resultKey` với đích khác `succeeded`, `queued→failed`, cancel khi `getJob`/`remove` lỗi | medium | patch | Verification-gap đã xác minh; đã thêm, xóa guard hoặc rethrow ở `catch` làm test fail |
| Test chạy song song gây lỗi giữa các file (DB/Redis dùng chung) | medium | patch | Chạy cả bộ ở mặc định fail ngẫu nhiên; thêm `--test-concurrency=1` vào script `test` của api, chạy hai lần xanh |
| Redis treo khi mất kết nối làm `transition` kẹt | false | - | `RedisService.client` có `commandTimeout` 1500ms và `maxRetriesPerRequest` 1, lệnh lỗi sau khoảng 1,5 giây và bị `catch` |
| `uploads` mồ côi khi dọn test | false | - | `Upload.user` có `onDelete: Cascade` |
| Lỗi ví trong `cancel` thành 500 thô | false | - | `WalletConflictException` là `HttpException` 409 |
| Migration CHECK hỏng trên DB đã có Task `succeeded` | low | reject | Chưa có worker ghi `succeeded` nên không tồn tại hàng như vậy ngoài fixture test (đã sửa fixture) |
| Cặp `queued→timed_out` nhận mọi mã hết hạn (`RH_TIMEOUT` từ `queued`) | low | reject | Spec cố ý chỉ ràng buộc theo bất biến `TaskSchema`; ràng buộc theo trạng thái nguồn thuộc Story 2.7 |
| `queuePosition` có thể lệch khi Task rời `queued` giữa hai lần đọc | low | reject | Chỉ hiển thị trễ vài mili giây; client poll lại |
| Giao dịch quá timeout 5 giây khi chờ khóa (P2028) | maybe-false | defer | Đã ghi cho Story 2.3; cần test chờ khóa lâu |
| Job BullMQ của Task đã hủy còn tồn tại nếu `remove` lỗi | maybe-false | defer | Worker chưa có; Story 2.5 phải bỏ job khi CAS `queued→running` trả 0 dòng |
| `transition` public, ai cũng gọi được; `cancel` đọc Task hai lần; raw `resultKey` lộ ra API; thiếu URL tải kết quả | low | reject | Đúng kiến trúc (`transition` là API nội bộ của `tasks`); URL kết quả thuộc Story 2.6/2.12 |
| `Queue.prototype` ghi đè toàn cục không khôi phục; dọn test chưa hoàn hảo; thiếu test cancel-vs-start song song | low | reject | `node --test` chạy mỗi file một tiến trình; cancel-vs-start dùng cùng CAS đã có đột biến phủ |
| Thiếu test bảng chuyển theo enum `TaskStatus`; `assertValidTransition` ném `Error` thô | low | reject | Spec quy định lỗi lập trình, không phải HTTP; bảng tĩnh và bất biến đã có test |

## Design Notes

`UPDATE … RETURNING` trả dòng mới nên không cần đọc lại. Thứ tự khóa: `transition` khóa dòng `tasks` (qua UPDATE) rồi dòng `users` (trong `wallet.capture/release`); luồng tạo Task khóa `users` trước rồi INSERT Task mới nên không giành cùng dòng `tasks`, không có vòng đợi. Redis chỉ giúp giảm việc thừa khi nhiều bên cùng kết thúc một Task; vì mọi đường đều tới UPDATE có điều kiện nên mất hay mồ côi khóa không làm Task kẹt.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass
