---
title: 'Story 6.2: [BE] Ngắt mạch và chặn tạo Task khi tạm dừng'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '4ea1a7cf42359f13228570694e028f21f2a688ff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hệ thống chưa tự dừng nhận Task khi lỗi hệ thống tăng cao, nên GPU bị đốt vào Task chắc chắn lỗi; chưa có bảng `settings`, route trạng thái hệ thống, route mở lại cho Admin, và ba route tạo Task chưa kiểm cờ tạm dừng.

**Approach:** Thêm bảng `settings` (module `ops` ghi), dịch vụ ngắt mạch đánh giá sau mỗi Task kết thúc và ở bộ quét 30 giây, guard `intake-open` gắn vào ba route tạo Task kèm test CI duyệt route, cùng `GET /system/status`, `GET /admin/ops/status`, `POST /admin/ops/resume` theo hợp đồng Story 6.1.

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/` (và `deploy/` nếu cần); import schema từ `@flowvis/contracts`, không sửa `packages/contracts`.
- Migration SQL thô viết tay: bảng `settings` (`key` duy nhất, `value` JSONB, `updated_at`) với các khóa `intake_paused`, `rh_budget_exhausted`, `breaker_reset_at`, `last_breaker_trigger`; chỉ module `ops` ghi; module khác không dùng SQL thô vào bảng này.
- `ops` không đọc bảng `tasks`; gọi hàm mới của `TasksService` trả số liệu cửa sổ (đã kết thúc, lỗi hệ thống, chuỗi lỗi liên tiếp mới nhất) chỉ tính Task có `finished_at` sau `breaker_reset_at`.
- Lỗi hệ thống: `failed`/`timed_out` với `reasonCode` thuộc `RH_ERROR`, `RH_TIMEOUT`, `RH_SUBMIT_UNKNOWN`, `PREP_TIMEOUT`, `FFMPEG_ERROR`, `INPUT_FETCH_ERROR`, `OUTPUT_UPLOAD_ERROR`, `OUTPUT_INVALID`, `INTERNAL_ERROR`. Loại khỏi mẫu số và không cắt chuỗi: `NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `USER_CANCEL`, `FREE_WAIT_EXPIRED`, `RH_BUDGET`, `RH_GATE_TIMEOUT`. `succeeded` cắt chuỗi.
- Quy tắc kích hoạt: cửa sổ trượt 30 phút, ≥ 20 Task đủ điều kiện và tỷ lệ lỗi **> 15%**; hoặc 5 lỗi hệ thống liên tiếp (kể cả khi chưa đủ 20). Khi kích hoạt: đặt `intake_paused`, ghi `last_breaker_trigger` (thời điểm, quy tắc, số liệu) và gửi đúng một cảnh báo Discord (không email/token); đã tạm dừng thì không gửi thêm.
- Đánh giá chạy sau mỗi Task kết thúc (tín hiệu phát sau commit trong `tasks.transition`, lỗi tín hiệu không làm hỏng transition) và ở bộ quét 30 giây của worker; hai đường idempotent.
- Guard `intake-open` đọc `intake_paused`; khi bật trả 503 `ServiceUnavailableException({code: PAUSED, message})`, không HOLD, không tạo Task. Gắn bằng metadata đánh dấu "tạo Task" lên `POST /tasks/face-swap`, `/tasks/body-retouch`, `/tasks/motion`; các route khác (đăng nhập, nạp tiền, lịch sử, đọc/tải/hủy Task, chia sẻ) không bị chặn.
- `POST /admin/ops/resume` (`JwtAuthGuard`, `RolesGuard`, `@Roles('admin')`, `@HttpCode(200)`): trong một transaction tắt cả `intake_paused` lẫn `rh_budget_exhausted`, đặt `breaker_reset_at = now()`, ghi `admin_audit` (`AuditService.record`, action `ops.resume`); trả `OpsStatusResponse`. Role `user` nhận 403.
- `GET /system/status` công khai chỉ `{intakePaused}`; `GET /admin/ops/status` theo `OpsStatusResponseSchema` (`rhBalance`, `lastBackup` là `null` cho đến Story 6.3/6.7).

**Never:**
- Không sửa `packages/contracts`, `apps/web`; không đọc `tasks` từ `ops`; không thêm phụ thuộc; không tự động bật lại `intake_paused`; không xử lý hết ngân sách RunningHub hay `getBalance` (Story 6.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đúng 15% | 20 Task đủ điều kiện, 3 lỗi hệ thống | Không kích hoạt | N/A |
| Vượt 15% | 20 Task, 4 lỗi (20%) khi Task thứ 20 kết thúc | `intake_paused` bật, một cảnh báo Discord | Gửi lỗi: ghi log, không hỏng transition |
| 5 liên tiếp | < 20 Task, 5 lỗi hệ thống liên tiếp | Kích hoạt; một `succeeded` cắt chuỗi | N/A |
| Lỗi người dùng | 30 Task `NO_POSE`/`CONTENT_BLOCKED` | Không kích hoạt, không đếm | N/A |
| Đã tạm dừng | Thêm Task lỗi kết thúc | Không cảnh báo thêm | N/A |
| Tạo Task khi tạm dừng | POST ba route tạo | 503 `PAUSED`, ví không đổi, không có Task | N/A |
| Route khác | đăng nhập, nạp, lịch sử, đọc Task, hủy, chia sẻ | Vẫn hoạt động | N/A |
| Mở lại | Admin gọi `resume`, lỗi cũ trước `breaker_reset_at` | Hai cờ tắt, không kích hoạt lại ngay, có `admin_audit` | role `user`: 403; chưa đăng nhập: 401 |
| Route mới thiếu guard | Route đánh dấu "tạo Task" không có guard | Test CI fail | N/A |
| `finished_at` | Sáu đường kết thúc | Đặt trong cùng UPDATE nếu chưa có | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` -- thêm model `Setting` và migration SQL thô (tên kiểu `20261111000000_ops_settings`); mẫu: `20261107020000_admin_audit`.
- `apps/api/src/modules/ops/` -- `ops.module.ts`, `index.ts` đã có (chỉ notifier + `ReconcileService`); thêm settings/breaker service, `ops.controller.ts`, `intake-open.guard.ts`.
- `apps/api/src/modules/tasks/tasks.service.ts` -- `transition` (~l.82–138) đã đặt `finished_at`, sau khối `task:terminal:` Redis thêm phát tín hiệu; thêm hàm đếm cửa sổ. `createPipelineTask` (~l.453) là điểm chung của ba route.
- `apps/api/src/modules/tasks/tasks.controller.ts` -- ba handler tạo Task (`@Controller('tasks')`, `JwtAuthGuard`, `AccountLockedGuard`); gắn guard + metadata.
- `apps/api/src/modules/tasks/task-sweeper.service.ts` -- `sweep()` có `safe(name, fn)`; thêm `safe('breaker', …)`; chỉ chạy khi `MOTION_PROCESS_ROLE === 'worker'`.
- `apps/api/src/modules/audit/audit.service.ts` -- `record(tx, {adminId, action, target, beforeAfter})`; mẫu admin: `topups/admin-topups.controller.ts`.
- `apps/api/src/ports/index.ts` -- `NOTIFIER_PORT`/`NotifierPort.notify`; mẫu retry 5 lần: `topups/topup-notifier.service.ts` (chỉ tham khảo, không bắt buộc dùng bảng riêng).
- `apps/api/test/` -- mẫu: `task-sweeper.test.mjs`, `admin-topups.test.mjs`, `task-transitions.test.mjs`; helper `test/helpers/task-fixture.mjs`; test chạy trên dist, PostgreSQL/Redis thật.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma` + migration -- bảng `settings` và khóa mặc định -- trạng thái vận hành bền
- [x] `apps/api/src/modules/ops/*` -- settings service, breaker, guard `intake-open`, controller `GET /system/status`, `GET /admin/ops/status`, `POST /admin/ops/resume` -- ngắt mạch và điều khiển
- [x] `apps/api/src/modules/tasks/tasks.service.ts` -- hàm đếm cửa sổ, tín hiệu sau commit -- `ops` không đọc `tasks`
- [x] `apps/api/src/modules/tasks/tasks.controller.ts`, `task-sweeper.service.ts` -- gắn guard/metadata, thêm bước quét `breaker` -- chặn tạo Task và không mất tín hiệu
- [x] `apps/api/test/*.test.mjs` -- test I/O Matrix, `finished_at` sáu đường, duyệt route "tạo Task", 401/403 -- phủ ranh giới

**Acceptance Criteria:**
- Given migration, when chạy trên PostgreSQL thật, then có bảng `settings` và chỉ `ops` ghi.
- Given ngắt mạch kích hoạt, when chuyển trạng thái, then đúng một cảnh báo Discord và `last_breaker_trigger` đầy đủ.
- Given `intake_paused` bật, when tạo Task ở ba route, then 503 `PAUSED` không HOLD.
- Given `pnpm test` của api, when chạy, then pass cùng `lint`, `typecheck`, `build`.

## Implementation Notes

- `OpsAdminModule` tách khỏi `OpsModule` (chứa controller và `BreakerService`) vì `TasksModule` đã import `OpsModule`, tránh vòng phụ thuộc. `BreakerService` đăng ký nghe qua `TasksService.onTerminal`.
- `test/helpers/ops-preload.mjs` (nạp bằng `--import` trong script `test`) đặt `OPS_BREAKER_DISABLED=1` để các suite khác, vốn cố ý tạo lỗi hệ thống, không làm ngắt mạch; `ops-breaker.test.mjs` tự bỏ biến này. Công tắc chỉ có hiệu lực khi `NODE_ENV=test`.
- Test sáu đường kết thúc đặt ở `task-transitions.test.mjs` (chạy thật, không so chuỗi mã nguồn).
- Toàn bộ suite api: 5 test fail có sẵn, không do story này: 3 test `test-overrides` (nạp `.env` qua `--env-file`; không có `.env` thì 4/4 pass) và 2 test ffprobe của Story 5.2 (`http,https,tls,tcp` so với `https,tls,tcp`, do bản ffprobe cài trên máy).

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Thiếu test chạy thật chuỗi `transition` → tín hiệu → tạm dừng và đường bộ quét | medium | patch | Xóa `emitTerminal()`/`onTerminal`/`safe('breaker')` mà test vẫn pass vì chỉ gọi `evaluate()` trực tiếp |
| Test "lỗi bên nghe không hỏng transition" không gọi `transition` | medium | patch | Chỉ INSERT với `.catch(() => {})` rồi `pop()`; bỏ `.catch` trong `emitTerminal` vẫn pass |
| Cửa sổ 30 phút chưa được kiểm | medium | patch | Mọi dòng seed có `finished_at` ở tương lai 1 giờ |
| Test 503 chưa chứng minh "không có Task" | low | patch | Chỉ đếm `ledger_entries`; thêm kiểm `tasks` |
| Cảnh báo Discord mất nếu gửi lỗi đúng lúc kích hoạt, không thử lại | medium | defer | Người dùng chọn hoãn: cơ chế thử lại tối đa 5 lần dùng chung cho cảnh báo Epic 6 ở 6.3/6.7 |
| Worker không có listener, nên bộ quét 30 giây là no-op | false | - | `worker.ts` dựng `AppModule`, đã import `OpsAdminModule` nên `BreakerService.onModuleInit` đăng ký listener |
| Resume khi không có cờ nào vẫn dời `breaker_reset_at` và ghi audit | low | defer | Hành vi đúng theo spec ("một thao tác"); xét lại khi 6.3 làm resume theo ví RH |
| `breaker_reset_at` cắt về mili giây so với `finished_at` micro giây | low | reject | Lệch tối đa 1 ms; sửa thêm nhánh, ít gặp |
| Race giữa guard và HOLD; guard chỉ ở controller | low | reject | Spec yêu cầu guard ở route; cửa sổ race vài chục ms, chấp nhận |
| Guard đọc DB mỗi request; lỗi DB thành 500; không cache | low | reject | Spec không yêu cầu cache; fail-closed khi DB lỗi là hợp lý |
| Truy vấn cửa sổ kéo dòng về Node, không có index `finished_at`; chạy trên mỗi Task kết thúc | low | reject | Cửa sổ 30 phút nhỏ; tối ưu sớm. Xét lại ở 6.6 |
| `OPS_BREAKER_DISABLED` trong mã production; preload ghi vào DB bất kỳ | low | reject | Chỉ có hiệu lực khi `NODE_ENV=test`; preload chạy trong test của repo |
| Test duyệt route chỉ quét `TasksController` và dựa vào dấu `@CreatesTask` | low | reject | Đúng AC ("route đánh dấu tạo Task"); route mới ngoài controller này cần dấu |
| Chưa có test ranh giới "ops không đọc tasks / chỉ ops ghi settings" | low | reject | Ràng buộc kiến trúc có sẵn qua review, thêm test grep là phụ |
| Chặn Cancel/chia sẻ khi tạm dừng chưa có test | low | defer | Không sai hôm nay; thêm assert khi sửa file này lần sau |
| Spec `in-review` còn sprint-status `in-progress` | false | - | Đúng quy trình; đồng bộ ở bước present |

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần Docker cho PostgreSQL/Redis)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: không có file ngoài `apps/api/`, `deploy/` và `_bmad-output/` do story này thêm
