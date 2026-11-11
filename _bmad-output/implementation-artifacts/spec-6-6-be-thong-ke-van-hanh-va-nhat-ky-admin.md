---
title: 'Story 6.6: [BE] Thống kê vận hành và nhật ký Admin'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '89ee336cfa6863526e4eb695ca2d2587b9e5b6b4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin chưa xem được tỷ lệ thành công, thời gian xử lý, chi phí GPU, biên gộp, chỉ số SM-1…SM-4, cũng chưa đọc được `admin_audit`.

**Approach:** Thêm `GET /admin/stats` và `GET /admin/audit` (module `admin-stats`). Số liệu đọc qua hàm công khai của `tasks`, `topups`, `wallet`/`auth` (không SQL vào bảng module khác); `AuditService` thêm `list`. Phần log JSON không lộ PII (NFR7) tách khỏi story này (ghi vào `deferred-work.md`).

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/` và `deploy/`; không sửa `packages/contracts`, `apps/web`; không thêm phụ thuộc. Dùng schema sẵn có `AdminStats*`, `AdminAudit*` trong `packages/contracts/src/ops.ts`. Cả hai route: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` (401/403); query sai schema → `VALIDATION_FAILED`.
- Thống kê tính trên Task có `created_at` trong `[from, to]`. `taskCounts`: đủ mọi trạng thái, theo từng pipeline có trong hệ thống. `successRate` = `succeeded` / mẫu số ngắt mạch (`succeeded` + `failed`/`timed_out` có `reason_code` thuộc `SYSTEM_FAILURE_REASONS`), `null` khi mẫu số 0. Thời gian xử lý (trung bình, p95 bằng `percentile_cont`) = `finished_at − running_at` trên Task `succeeded`. `avgGpuCoins` trên Task `succeeded`; `wastedGpuCoins` = tổng `gpu_coins` của Task `failed`/`timed_out`/`cancelled` (null coi như 0).
- Quy đổi: `chi phí VNĐ = gpuCoins / coinsPerUsd × USD_VND`. Env: `USD_VND` (mặc định 25000), `RH_COINS_PER_USD_RETAIL` (1800), `RH_COINS_PER_USD_STANDARD` (3600); sai/không dương → mặc định. `avgCostVnd` = chi phí trung bình mỗi Task `succeeded` theo hai kịch bản (`retail`, `standardPack`), `null` khi không có.
- Biên gộp theo từng pipeline có chi phí × gói (`starter`/`pro`/`creator`) × kịch bản: doanh thu mỗi 100 credit lấy từ `PRICING_CONFIG` (giá gói / credit × 100 = 980, 825, 663). Đơn vị: Face Swap/Body Retouch tính mỗi Task (giá mặc định 100 credit); Motion tính mỗi giây video (giá mặc định 50 credit, chi phí = tổng `gpu_coins` / tổng `params.seconds` của Task `succeeded`). `imagePrice` và `motionPricePerSecond` (đơn vị credit) thay giá mặc định, chỉ trong phép tính. `marginVnd = revenue − cost`, `marginRate = marginVnd / revenue` (`null` khi revenue 0).
- `successMetrics`: `approvedTopups` = đơn `approved` có `updated_at` trong khoảng; `conversionRate` (SM-1) = tài khoản tạo trong khoảng, có ≥1 Task, và có đơn `approved` trong 30 ngày kể từ `created_at` tài khoản, chia số tài khoản tạo trong khoảng có ≥1 Task (`null` khi 0); `gpuCostUsd` (SM-4) = tổng `gpu_coins` của Task trong khoảng / `RH_COINS_PER_USD_RETAIL`.
- `scope`: `BENCHMARK_USER_EMAILS` (phân tách dấu phẩy, không phân biệt hoa thường). `real` loại Task, đơn nạp, tài khoản của các email đó khỏi mọi chỉ số; `benchmark` chỉ tính chúng; danh sách rỗng thì `real` tính tất cả và `benchmark` ra số 0.
- `GET /admin/audit`: `admin_audit` mới nhất trước (`at desc, id desc`), lọc đúng `action`, đúng `target`, phân trang con trỏ như `TopupsService.adminList` (con trỏ sai → `VALIDATION_FAILED`). `createdAt` = `at`; `reason` = `before_after.reason` nếu là chuỗi, ngược lại `null`; chỉ đọc, không route sửa/xóa. Không trả `before_after`.
- Truy vấn thống kê gom bằng SQL, trả < 2 giây trên 10.000 Task thử; thêm `USD_VND`, `RH_COINS_PER_USD_*`, `BENCHMARK_USER_EMAILS` vào `apps/api/.env.example` và khối `api` của `deploy/compose.yml`.

**Never:** Không ghi dữ liệu nào; không SQL thô vào bảng module khác (`tasks` đọc qua `TasksService`, đơn nạp qua `topups`, tài khoản qua `auth`); không thêm `ApiErrorCode`; không trả email trong thống kê; không làm phần log JSON.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thống kê thường | `from`/`to` hợp lệ, có Task đủ loại | Số đếm, tỷ lệ, avg/p95, chi phí, biên gộp đúng công thức | N/A |
| Không có dữ liệu | Khoảng rỗng | Số đếm 0, `successRate`/avg/p95/`avgCostVnd` null, `conversionRate` null | N/A |
| Lỗi người dùng | Task `failed` `NO_FACE` | Không vào mẫu số, vào `taskCounts`; vào `wastedGpuCoins` nếu có coin | N/A |
| Đổi giá thử | `imagePrice=80` | Doanh thu/biên gộp tính theo 80 credit | N/A |
| Scope | `real` / `benchmark` | Loại / chỉ tính email benchmark | N/A |
| Tham số sai | `to` < `from`, scope lạ | Không tính | 400 `VALIDATION_FAILED` |
| Nhật ký | `action`, `target`, `pageSize` | Mới nhất trước, đúng lọc, `reason` suy từ `before_after` | Con trỏ sai → 400 |
| Quyền | role `user`/không token | 403/401 | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ops.ts` l.43–152 -- schema stats/audit; `wallet.ts` l.20–72 `PRICING_CONFIG` (gói, credit, giá).
- `apps/api/src/modules/tasks/tasks.service.ts` -- `SYSTEM_FAILURE_REASONS` l.46, `breakerWindowStats` l.178 (mẫu raw SQL); thêm `statsByPipeline(from,to,userFilter)` và hàm đếm tài khoản có Task.
- `apps/api/src/modules/topups/topups.service.ts` -- `adminList` l.316 (mẫu phân trang); thêm đếm đơn `approved` và tra đơn theo tài khoản/khoảng.
- `apps/api/src/modules/auth/auth.service.ts` -- thêm tra id theo email benchmark và số tài khoản tạo trong khoảng (chủ `users`).
- `apps/api/src/modules/audit/audit.service.ts` -- thêm `list(query)`.
- `apps/api/src/modules/ops/ops.controller.ts`, `admin-users/` -- mẫu controller/guard/`safeParse`.
- `apps/api/src/app.module.ts` -- đăng ký `AdminStatsModule`.
- `apps/api/.env.example`, `deploy/compose.yml` -- biến môi trường mới.
- `apps/api/test/admin-users.test.mjs` -- mẫu bootstrap/`call`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/tasks/`, `topups/`, `auth/` -- hàm đọc thống kê có bộ lọc scope -- đúng chủ bảng
- [x] `apps/api/src/modules/audit/audit.service.ts` -- `list` có lọc và con trỏ -- đọc nhật ký
- [x] `apps/api/src/modules/admin-stats/` (service, controller, module) + `app.module.ts` -- tổng hợp, quy đổi, biên gộp, SM, audit route -- API Admin
- [x] `apps/api/.env.example`, `deploy/compose.yml` -- biến mới -- cấu hình
- [x] `apps/api/test/admin-stats.test.mjs` -- test I/O Matrix, quyền, scope, 10.000 Task < 2 giây -- phủ ranh giới

**Acceptance Criteria:**
- Given 10.000 Task thử, when gọi `GET /admin/stats`, then trả dưới 2 giây và khớp số liệu tính tay.
- Given `pnpm --filter @flowvis/api test`, `lint`, `typecheck`, `build`, `check:boundaries`, when chạy, then pass (trừ test lỗi có sẵn ở Story 2.14, 5.2 và throttle).

## Implementation Notes

- Module `admin-stats` (service, controller, module) + `AuditService.list`; số liệu đọc qua `TasksService.statsByPipeline`/`userIdsWithTasks`, `TopupsService.countApproved`/`accountsWithApprovedWithin`, `AuthService.findUserIdsByEmails`/`listUsersCreatedBetween`. Mỗi pipeline trong `TASK_PIPELINES` luôn có một dòng (số 0/null khi trống); biên gộp chỉ cho pipeline có Task thành công.
- Suite api (đúng script `test`, có `ops-preload.mjs`): 530 pass, 5 fail có sẵn (Story 2.14, 5.2, throttle), 6 skip; ổn định qua nhiều lần chạy. Chạy song song hai suite hoặc thiếu preload sinh fail giả. Đột biến bỏ `timed_out` khỏi điều kiện lãng phí làm test fail, xác nhận test bắt được lỗi.
- `check:boundaries` báo cả file các story trước (`packages/contracts`, `apps/web`) vì nhánh xếp chồng trên nhánh 6.5 chưa merge; file của story này chỉ ở `apps/api/`, `deploy/`, `_bmad-output/`.
- Phần log JSON không lộ PII (NFR7) tách ra theo lựa chọn của người dùng, ghi trong `deferred-work.md`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Kỳ không có Task trả `pipelines: []`, lệch ma trận và mock hợp đồng | medium | patch | `order` chỉ gồm pipeline có dòng; ma trận "Không có dữ liệu" cần số đếm 0 và null |
| JSDoc của `lockAccount` bị chèn hàm mới vào giữa | low | patch | Ba bên cùng báo; sửa là di chuyển hai hàm |
| Test SM-1 chỉ kiểm khoảng (0,1], không bắt lỗi bộ lọc cohort hay cửa sổ 30 ngày | medium | patch | Bỏ `withTasks` hoặc nới cửa sổ vẫn pass |
| Scope benchmark chưa kiểm cho đơn nạp và tài khoản | medium | patch | Người dùng benchmark không có đơn nạp trong test nên bỏ vị từ vẫn pass |
| Chưa có Task `timed_out` trong test mẫu số và lãng phí | medium | patch | Bỏ `timed_out` khỏi `sys_fail` hoặc `wasted` vẫn pass |
| Motion: tổng `gpu_coins` gồm Task thiếu `params.seconds`, mẫu số chỉ cộng giây hợp lệ | low | reject | Task motion thành công luôn có `params.seconds` nguyên dương (`createMotionControl` ghi bắt buộc) |
| `totalGpu` bỏ pipeline lạ ngoài `TASK_PIPELINES` | low | reject | `tasks.pipeline` chỉ nhận giá trị trong enum hợp đồng |
| Thời gian xử lý âm khi `finished_at < running_at` | low | reject | Hai mốc do cùng chuyển trạng thái CAS ghi theo thứ tự; không có đường tạo dữ liệu đó |
| `new Date()` trên `from`/`to` có thể ra Invalid Date → 500 | false | - | `AdminStatsQuerySchema` dùng `z.string().datetime()` nên chuỗi không hợp lệ bị chặn 400 trước |
| Con trỏ audit hợp lệ nhưng thuộc bộ lọc khác | low | reject | Chỉ lệch ranh giới trang, không lộ dữ liệu, cùng mẫu `TopupsService.adminList` |
| Hai truy vấn đếm và tổng hợp không chung snapshot | low | reject | Số liệu thống kê chấp nhận lệch tức thời; không ảnh hưởng tiền |
| Khoảng `[from, to]` đóng đếm trùng ở biên | low | reject | Spec quy định `[from, to]` |
| Tài khoản admin tính vào chỉ số real | medium | defer | Spec chỉ loại `BENCHMARK_USER_EMAILS`; loại thêm role cần sửa khối frozen |
| `updated_at` thay `approved_at` có thể lệch khi đơn bị ghi lại | medium | defer | Đã ghi ở Design Notes; sửa đúng cần cột và migration mới |
| Không giới hạn độ dài khoảng thời gian hay số tài khoản trong mảng uuid | low | reject | Endpoint chỉ cho Admin, chạy 10.000 Task dưới 2 giây |
| Test không dọn Task, không khôi phục `BENCHMARK_USER_EMAILS`, đo thời gian dễ flaky | low | reject | `tasks.user_id` có `onDelete: Cascade`; `before` đã dọn dữ liệu cũ; ngưỡng 2 giây theo AC |
| Trùng `validationError` giữa controller và `AuditService.list`; regex UUID tự viết | low | reject | Cùng mẫu `TopupsService.adminList` và `admin-users`; không sai hành vi |
| Test ngưỡng `pageSize` sai, `USD_VND` ghi đè, `avgCostVnd` null | low | reject | Logic dùng chung đã được test qua các nhánh khác |
| Biên gộp motion bỏ dòng khi `ok_seconds <= 0` | low | reject | Không có giây thì không có đơn vị để tính; spec yêu cầu chỉ pipeline có chi phí |
| `PII` log (NFR7) chưa có người nhận | low | reject | Đã ghi `deferred-work.md` theo lựa chọn của người dùng |

## Design Notes

Chưa có `approvedAt` trên đơn nạp; dùng `updated_at` vì đơn `approved` không còn bị ghi lại. Cấu hình hai kịch bản tách thành hai biến vì epic chỉ nêu giá trị 1.800/3.600.

## Verification

**Commands:**
- `node --env-file=.env --import ./test/helpers/ops-preload.mjs --test --test-concurrency=1 test/*.test.mjs` (trong `apps/api`, cần Docker) -- expected: chỉ các fail có sẵn
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
