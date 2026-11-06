---
title: 'Story 2.7: [BE] Bộ quét Task treo và hạn chót'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '653f0e84692547c453f3a32920e61a6e2cf3f68b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Task `queued` mất job, Task `running` mất job hoặc quá hạn hiện giữ HOLD và Lane vô thời hạn vì chưa có bộ quét (AD-6); thao tác dài của Task đã bị kết thúc không bị hủy.

**Approach:** Thêm `TaskSweeperService` trong module `tasks`, chạy mỗi 30 giây ở tiến trình worker: enqueue lại Task `queued` thiếu job, `timed_out` Task `running` quá hạn, enqueue job khôi phục cho Task `running` mất job, rồi dọn job và hủy `AbortSignal` của Task vừa kết thúc.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; không sửa `packages/contracts`, `wallet.service.ts`, không migration mới. Mọi đổi trạng thái qua `TasksService.transition`.
- `@nestjs/schedule` (`@Interval(30_000)`), chỉ chạy khi `MOTION_PROCESS_ROLE === 'worker'`; không chạy chồng chu kỳ (cờ trong tiến trình); mỗi nhánh xử lý theo lô `LIMIT 100`, lỗi một Task không chặn Task khác. Hàm `sweep()` gọi trực tiếp được trong test.
- Task `queued` có `queued_at` cũ hơn 30 giây mà `queue.getJob(taskId)` rỗng (hoặc job ở `completed`/`failed` thì xóa trước): `add('process', { taskId }, { jobId: taskId, priority: tier_snapshot.priority, removeOnComplete: true, removeOnFail: true })`, giữ `queued_at` gốc, tăng `enqueue_attempts` trước khi enqueue; đã đạt 5 lần mà vẫn thiếu job → `queued→failed`/`INTERNAL_ERROR` (RELEASED).
- Task `running` có `deadline_at` đã qua → `timed_out`/`RH_TIMEOUT` kèm `orphanForMs` 10 phút, bất kể job còn sống hay không.
- Task `running` chưa có `deadline_at`: quá `prep_deadline_at` và job không còn sống (`getJob` rỗng hoặc không ở `active`) → `timed_out`/`PREP_TIMEOUT` (không orphan). Job còn sống thì bộ quét không áp `PREP_TIMEOUT` (worker đang chờ cổng); bộ quét chỉ cưỡng chế `gate_deadline` đã qua → `timed_out`/`RH_GATE_TIMEOUT`, bất kể job.
- Task `running`, chưa quá hạn, không còn job → enqueue job khôi phục cùng `jobId = taskId`; worker xử lý nhánh khôi phục theo Story 2.5 (không submit lại).
- Sau mỗi CAS kết thúc do bộ quét: `job.remove()` nếu còn (nuốt lỗi, ghi log) và `TaskWorkerService.abortTask(taskId)` hủy `AbortSignal` riêng của Task (mỗi job có `AbortController` trong `Map`, gộp với `shutdown`; xóa khỏi `Map` khi job xong). Kết quả RunningHub đến muộn khi Task đã kết thúc bị bỏ qua, sổ cái không đổi.
- `StoragePort.getObject`/`putObject` nhận thêm `signal?: AbortSignal` (truyền xuống `s3.send(..., { abortSignal })`); `result-ingestor.ts` và `loadInputs` truyền `signal` (đóng khoản hoãn của Story 2.6).

**Never:** Task FREE hết hạn 15 phút (Story 2.8); `RH_BUDGET`/ngắt mạch; HTTP RunningHub thật; sửa nhánh khôi phục trong `processTask` ngoài việc nhận signal theo Task; submit lại RunningHub.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Queued mất job | `queued`, quá 30 giây, không job | job mới `jobId=taskId`, `enqueue_attempts`+1, `queued_at` giữ nguyên | Redis lỗi: giữ `queued`, thử lại chu kỳ sau |
| Quá 5 lần | `enqueue_attempts ≥ 5`, vẫn không job | `failed`/`INTERNAL_ERROR`, một RELEASED | N/A |
| Running quá `deadline_at` | job sống hoặc chết | `timed_out`/`RH_TIMEOUT`, `rh_orphan_until` ≈ +10 phút, RELEASED, job bị xóa, signal hủy | CAS không áp dụng: bỏ qua |
| Running quá prep, job chết | không `deadline_at`, quá `prep_deadline_at`, không job active | `timed_out`/`PREP_TIMEOUT`, không orphan | như trên |
| Running chờ cổng, job sống | không `deadline_at`, quá `prep_deadline_at`, job active | không đổi; quá `gate_deadline` → `timed_out`/`RH_GATE_TIMEOUT` | như trên |
| Running mất job | chưa quá hạn, không job | job khôi phục được enqueue; Task vẫn `running` | N/A |
| Kết quả muộn | Task đã `timed_out`, RH báo SUCCESS | bỏ qua, không CAPTURED, không đối tượng `out/` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tasks/task-sweeper.service.ts` -- MỚI; `sweep()` + `@Interval`; dùng `PrismaService` (SELECT) và `TasksService.transition`; mẫu job định kỳ: `modules/ops/reconcile.service.ts`.
- `apps/api/src/modules/tasks/task-worker.service.ts` -- thêm `Map<taskId, AbortController>`, `abortTask`; `onModuleInit` (~L83-91) gộp signal; `loadInputs` (~L230) truyền signal.
- `apps/api/src/modules/tasks/tasks.service.ts` -- thêm truy vấn lô cho bộ quét và `ENQUEUE`/hằng dùng chung; `queue` (`@InjectQueue(TASKS_QUEUE)`) và `transition` (~L67) giữ nguyên; `createFaceSwap` (~L274) là mẫu `queue.add`.
- `apps/api/src/modules/tasks/tasks.module.ts` -- đăng ký provider, `ScheduleModule.forRoot()` (ops/storage cũng gọi, an toàn).
- `apps/api/src/ports/index.ts`, `modules/storage/s3-storage.adapter.ts`, `modules/tasks/result-ingestor.ts` (~L143, L258) -- `signal` cho `getObject`/`putObject`.
- `apps/api/test/task-sweeper.test.mjs` -- MỚI (mẫu: `test/task-worker.test.mjs`, `helpers/task-fixture.mjs`); cập nhật `s3-storage-adapter.test.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `ports/index.ts`, `s3-storage.adapter.ts`, `result-ingestor.ts`, `task-worker.service.ts` -- `signal` cho storage; `AbortController` theo Task + `abortTask`
- [x] `tasks.service.ts`, `task-sweeper.service.ts`, `tasks.module.ts` -- bộ quét 4 nhánh + dọn job + hủy signal
- [x] `test/task-sweeper.test.mjs`, `s3-storage-adapter.test.mjs` -- phủ I/O Matrix trên PostgreSQL/Redis thật; đột biến (bỏ orphan, bỏ `abortTask`, bỏ kiểm `enqueue_attempts`) phải làm test fail

**Acceptance Criteria:**
- Given Task bị bộ quét kết thúc khi `ingest` đang chờ `putObject`, when `abortTask` chạy, then thao tác dừng và slot BullMQ được giải phóng.
- Given mọi CAS kết thúc do bộ quét, when hoàn tất, then đúng một RELEASED, không CAPTURED.

## Implementation Notes

## Review Triage Log

| Finding | Verdict | Evidence / Disposition |
|---------|---------|-------------------------|
| `sweepRunningLive` loại Task `running` có `deadline_at` NULL và hạn prep/gate còn ở tương lai (NOT(NULL) = NULL) | high | patch: `transition` luôn đặt `prep_deadline_at`/`gate_deadline` tương lai khi vào `running`, nên Task mất job trong bước chuẩn bị không khớp truy vấn nào; test "Running mất job" chỉ đặt `deadline_at` nên không bắt được. |
| `scheduledSweep`/`@Interval`/cổng vai trò `worker` không có test | medium | patch: mọi test gọi `sweep()` trực tiếp; đảo cổng hoặc bỏ `@Interval` vẫn xanh. Mẫu: `tier.test.mjs:388-413`. |
| `signal` truyền xuống `getObject`/`putObject`/`loadInputs` chưa có test khẳng định kho giả nhận đúng `signal`; test abort dùng ingestor giả | medium | patch: bỏ `signal` ở `result-ingestor.ts:143` hoặc `loadInputs` thì mọi test vẫn xanh. |
| `ORDER BY … LIMIT 100` có thể bỏ đói Task phía sau khi hơn 100 Task khỏe mạnh bị `continue` mỗi chu kỳ | low | reject: MVP giới hạn 3 Task đang hoạt động mỗi người dùng và một worker; sửa cần con trỏ phân trang, không phải sửa trực tiếp. |
| Task `running` với job `waiting`/`delayed` và `prep_deadline_at` đã qua bị `PREP_TIMEOUT` | false | spec (khối frozen) quy định đúng: chỉ job `active` được bỏ qua; AC của epic yêu cầu `PREP_TIMEOUT` khi quá `prep_deadline_at`. |
| `bumpEnqueueAttempts` chạy trước `queue.add` nên Redis lỗi 5 chu kỳ làm `failed`/`INTERNAL_ERROR` | false | spec quy định "tăng `enqueue_attempts` trước khi enqueue"; sửa là sửa spec. |
| `priority` NULL/0 làm `queue.add` bị từ chối | low | reject: `tier_snapshot.priority` luôn do `wallet.hold` ghi (contract bắt buộc); không có đường nào sinh snapshot thiếu khóa. |
| Không có khóa đa tiến trình; `abortTask` chỉ hủy trong tiến trình hiện tại; `job.remove()` job `active` bị khóa | false | AD-6 chốt đúng một tiến trình worker; job active bị khóa chỉ ghi log và CAS vẫn chặn kết quả muộn. |
| CAS `PREP_TIMEOUT` đua với worker đặt `deadline_at` giữa lúc đọc và CAS | false | nhánh này chỉ chạy khi không có job `active` (không worker nào đang xử lý) nên không có bên ghi đua; `deadline_at` chỉ do worker ghi. |
| `running` cờ chống chồng kẹt vĩnh viễn nếu một `await` không bao giờ xong; job `active` treo | low | reject: `gate_deadline` 15 phút vẫn cưỡng chế `RH_GATE_TIMEOUT`; Prisma/ioredis có timeout riêng; thêm đua timeout là phức tạp không cần. |
| AbortError khi `getObject` tham chiếu bị coi là lỗi chung | false | worker có `if (signal.aborted) return` ở mọi `catch`; ingestor chuyển lỗi lên worker. |
| Enqueue job dư khi Task bị hủy/kết thúc giữa SELECT và `queue.add` | false | spec AC nêu job dư vô hại nhờ CAS; worker bỏ job của Task kết thúc. |
| Thiếu log/metric/audit cho quyết định của bộ quét; dòng trống thừa và monkey-patch trong test | low | reject: cosmetic/thẩm mỹ, không có caller nào vỡ; log quan sát thuộc Epic 6 (ops). |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua compose)
- `pnpm run check:boundaries` -- expected: pass
