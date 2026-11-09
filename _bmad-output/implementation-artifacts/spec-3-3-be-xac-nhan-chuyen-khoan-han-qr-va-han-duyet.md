---
title: 'Story 3.3: [BE] Xác nhận chuyển khoản, hạn QR và hạn duyệt'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '12585252fe744dcbd4cdad6011048720b4457624'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng đã chuyển khoản nhưng chưa có cách báo cho hệ thống; đơn `awaiting_transfer` quá hạn QR cũng không bao giờ chuyển `expired` nên vẫn chiếm một trong ba chỗ của giới hạn đơn mở; `approve_by` chưa được tính theo giờ làm việc của Admin.

**Approach:** Thêm `POST /topups/{id}/confirm-transfer` chuyển `awaiting_transfer→pending` bằng UPDATE có điều kiện và đặt `approve_by` theo hàm thuần tính giờ Việt Nam, kèm bộ quét `@nestjs/schedule` trong worker đổi đơn `awaiting_transfer` quá `qr_expires_at` sang `expired`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`; chỉ module `topups` ghi bảng `topups`. Dùng `TopupConfirmTransferRequestSchema`/`TopupSchema` từ `@motion-ai/contracts`, không đổi hợp đồng.
- Mọi chuyển trạng thái là một câu `UPDATE topups SET ... WHERE id=? AND status='awaiting_transfer' [AND qr_expires_at > now()] RETURNING ...`; không đọc rồi ghi. Dùng `now()` của DB để so với `qr_expires_at`.
- `computeApproveBy(now: Date): Date` là hàm thuần xuất khẩu: `approve_by` = 15 phút sau thời điểm đầu tiên nằm trong khung `[08:00, 23:00)` giờ UTC+7 (08:00 thuộc khung, 23:00 không). Kết quả: 10:00→10:15; 23:30→08:15 hôm sau; 07:00→08:15 cùng ngày; 22:50→23:05 cùng ngày; đúng 23:00→08:15 hôm sau.
- `POST /topups/{id}/confirm-transfer`: cùng guard JWT + `AccountLockedGuard` + `TopupThrottlerGuard` như `POST /topups`; id sai định dạng → `NOT_FOUND`, đơn không có → `NOT_FOUND`, đơn của người khác → `FORBIDDEN`; trả `TopupSchema` của đơn sau khi xử lý.
- Gọi lần hai khi đơn đã `pending` (thao tác đã thành công trước đó) trả 200 với đơn hiện tại, không đổi `approve_by`, không lỗi.
- Đơn `awaiting_transfer` đã quá `qr_expires_at`: đơn được chuyển `expired` (ghi xong rồi mới trả lỗi, không nằm trong transaction bị rollback) và trả `TOPUP_QR_EXPIRED` (HTTP 409). Đơn ở trạng thái khác (`approved`, `rejected`, `needs_review`, `expired`) → `TOPUP_STATE_INVALID` (HTTP 409).
- `TopupSweeperService` theo mẫu `TaskSweeperService`: `@Interval(30_000)` chỉ chạy khi `MOTION_PROCESS_ROLE === 'worker'`, có cờ chống chạy chồng, `sweepExpired()` công khai để test gọi trực tiếp; đổi mọi đơn `awaiting_transfer` có `qr_expires_at <= now()` sang `expired` bằng một UPDATE có điều kiện.
- Đơn `pending` không bao giờ tự `expired` hay `rejected`, kể cả khi quá `qr_expires_at` hoặc `approve_by`.

**Never:**
- Không sửa `packages/contracts`, `apps/web`; không gửi Discord, không `/admin/**`, không `notified_at` (story 3.4–3.5); không thêm Clock provider chung cho cả dự án.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Xác nhận hợp lệ | `awaiting_transfer`, chưa quá hạn QR | 200, `pending`, `approveBy` đặt theo `computeApproveBy` | N/A |
| Xác nhận lặp | Đã `pending` do chính lần gọi trước | 200, đơn không đổi | N/A |
| QR hết hạn | `awaiting_transfer`, `qr_expires_at` đã qua | Đơn thành `expired` | `TOPUP_QR_EXPIRED` |
| Trạng thái khác | `approved`/`rejected`/`needs_review`/`expired` | Không đổi | `TOPUP_STATE_INVALID` |
| Người khác gọi | Không phải chủ đơn | Không đổi | `FORBIDDEN` |
| Đua xác nhận và bộ quét | Cùng lúc, đơn sát hạn | Đúng một bên thắng; không bao giờ vừa `pending` vừa `expired` | Bên thua nhận kết quả theo trạng thái cuối |
| Bộ quét với đơn `pending` quá hạn | `pending`, `qr_expires_at` và `approve_by` đã qua | Giữ nguyên `pending` | N/A |
| Giải phóng chỗ | Đủ 3 đơn mở, 1 đơn quá hạn QR, đã quét | Tạo đơn mới thành công | N/A |
| Biên khung giờ | 10:00, 23:30, 07:00, 22:50, 23:00, 08:00 (UTC+7) | 10:15; 08:15+1d; 08:15; 23:05; 08:15+1d; 08:15 | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/topups/topups.service.ts` -- thêm `confirmTransfer(userId, id)`; mẫu `apiError`, `TopupLimitException`, `getById` (kiểm tra chủ đơn), `toDto`; không đổi `create`.
- `apps/api/src/modules/topups/approve-by.ts` -- MỚI: `computeApproveBy` (hàm thuần, UTC+7 cố định, không DST).
- `apps/api/src/modules/topups/topup-sweeper.service.ts` -- MỚI, mẫu `src/modules/tasks/task-sweeper.service.ts` (`@Interval`, vai trò worker, cờ `running`); đăng ký trong `topups.module.ts` cùng `ScheduleModule.forRoot()` như `tasks.module.ts`.
- `apps/api/src/modules/topups/topups.controller.ts` -- thêm `POST :id/confirm-transfer`; mẫu parse `TopupIdParamsSchema` của `GET :id`.
- `apps/api/src/modules/tasks/tasks.service.ts` (~dòng 78 `transition`, ~225 `cancel`) -- mẫu CAS `RETURNING` và `ConflictException`; không sửa.
- `apps/api/test/task-sweeper.test.mjs`, `test/topups.test.mjs` -- mẫu gọi `sweeper.sweep()` trực tiếp, lão hóa dòng bằng SQL; thêm test vào `topups.test.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/topups/approve-by.ts` -- `computeApproveBy` -- tính hạn duyệt theo giờ Việt Nam
- [x] `apps/api/src/modules/topups/topups.service.ts`, `topups.controller.ts` -- `confirmTransfer` và route -- endpoint của 3.1
- [x] `apps/api/src/modules/topups/topup-sweeper.service.ts`, `topups.module.ts` -- bộ quét hết hạn -- giải phóng chỗ trong giới hạn đơn mở
- [x] `apps/api/test/topups.test.mjs` -- test I/O Matrix, gồm đua xác nhận với bộ quét trên PostgreSQL thật -- bằng chứng

**Acceptance Criteria:**
- Given `computeApproveBy`, when chạy với các mốc giờ trong ma trận, then đúng từng kết quả kể cả sang ngày hôm sau.
- Given xác nhận và bộ quét chạy đồng thời 20 lần trên đơn sát hạn, when xong, then mọi đơn ở đúng một trạng thái cuối `pending` hoặc `expired` và mỗi đơn `pending` có `approve_by`.
- Given deferred item của 3.2 về đơn quá hạn chiếm chỗ, when bộ quét chạy, then người dùng đủ 3 đơn mở tạo được đơn mới.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Thiếu test cổng `MOTION_PROCESS_ROLE` của `scheduledSweep` | medium | patch | Xóa dòng kiểm tra vai trò mà mọi test vẫn qua; `task-sweeper.test.mjs:254` có mẫu; đã thêm test |
| Test đua chấp nhận mọi kết quả, không kiểm tra mã phản hồi, có câu `WHERE false` vô nghĩa | medium | patch | Test vẫn qua khi không có đua và khi có 5xx; đã bỏ câu thừa, khẳng định 200↔`pending`, 409↔`expired`, không 5xx |
| Bên thua bộ quét nhận `TOPUP_STATE_INVALID` thay vì `TOPUP_QR_EXPIRED` | low | reject | AC và ma trận quy định đơn đã `expired` → `TOPUP_STATE_INVALID`; cả hai đều HTTP 409 |
| `approveBy` truyền `Date` vào cột `timestamp` có thể lệch múi giờ | false | - | Cột là `TIMESTAMPTZ(6)` nên lưu thời điểm tuyệt đối |
| `ScheduleModule.forRoot()` đăng ký trùng, đặt trong module chạy ở API | false | - | `tasks`, `storage`, `ops` đã làm như vậy; `scheduledSweep` tự chặn khi không phải worker |
| `approveBy` từ đồng hồ Node, kiểm tra hạn QR bằng `now()` của DB | low | reject | Chênh lệch mili-giây không đổi kết quả; Clock provider chung bị loại khỏi phạm vi |
| 403 cho đơn người khác tiết lộ id tồn tại | low | reject | Spec và 3.2 quy định `FORBIDDEN`; UUID ngẫu nhiên không dò được |
| Thiếu test 401, khóa tài khoản, throttle, double-confirm đồng thời, biên `qr_expires_at = now()` | low | reject | Guard dùng chung với `POST /topups` đã có test; lặp lại tuần tự đã được test |
| Thiếu audit/log theo id cho chuyển trạng thái | low | reject | `admin_audit` thuộc 3.5; chuyển trạng thái của người dùng không thuộc nhật ký Admin |
| Nhiều lần `findUnique` thừa; TOCTOU kiểm tra chủ đơn | low | reject | Ghi là CAS nguyên tử; chủ đơn không đổi được; gộp `RETURNING *` là tối ưu ngoài AC |
| `computeApproveBy` với `Invalid Date`; thiếu test 00:00–07:59 và biên ngày UTC | low | reject | Đầu vào luôn là `new Date()`; các mốc quan trọng (07:00, 08:00, 22:50, 23:00, 23:30) đã có |
| Ai xử lý đơn `pending` quá `approve_by` | false | - | Epic quy định ở 3.4 (cảnh báo quá hạn) và 3.5 (Admin xử lý) |

### Review Findings

- [x] [Review][Patch] Không test nào đi qua đường bộ quét → tạo đơn mới; câu assert cuối của test "giải phóng chỗ" không phát hiện được bộ quét expire nhầm đơn còn hạn [apps/api/test/topups.test.mjs] — test hiện gọi `create()` trước khi `sweepExpired()` nên chỉ qua nhờ lệnh expire trong `create`; xóa bộ quét thì test vẫn pass, trái AC "bộ quét chạy → đủ 3 đơn mở tạo được đơn mới". Cần: đủ 3 đơn mở có 1 đơn quá hạn → `sweepExpired()` trả 1 và đơn đó thành `expired` → `POST /topups` trả 201; đồng thời đơn còn hạn vẫn `awaiting_transfer` sau khi quét.
- [x] [Review][Patch] `approve_by` được lưu bởi `confirmTransfer` không được kiểm tra ở mức endpoint [apps/api/src/modules/topups/topups.service.ts:172-176] — các test chỉ assert `approveBy` khác null và ổn định; đổi thành `computeApproveBy(found.createdAt)` hay bỏ `APPROVE_SLA_MS` thì mọi test vẫn qua. Cần assert `computeApproveBy(before) <= approveBy <= computeApproveBy(after)` với `before`/`after` là mốc ngay trước và sau lời gọi.

#### Rejected
- `create` bị đổi trái Code Map "không đổi `create`" — low; lệnh expire trong `create` là patch có chủ đích ở commit `7afcd85` để đơn quá hạn không chiếm chỗ khi worker chưa chạy tới, hành vi đúng; sửa bằng cách chỉnh spec nên bị loại (phần thiếu test đã gộp vào patch 1).
- Hai lần `create` đồng thời vượt giới hạn 3 đơn — false; `create` chạy trong transaction khóa dòng user của 3.2 (AD-3) trước khi đếm.
- Hạn duyệt 23:05–23:14 nằm ngoài khung khi xác nhận 22:50–22:59 — false; spec định nghĩa hạn là 15 phút sau thời điểm đầu tiên nằm trong khung, và mốc 22:50 đã có trong test.
- Bộ quét không có test lịch `@Interval`/wiring worker — low; các bộ quét `tasks`, `uploads` cũng test bằng gọi trực tiếp, `create`/`confirm` vẫn expire lười nên thiệt hại giới hạn.
- Thiếu hoặc sai `MOTION_PROCESS_ROLE` khiến bộ quét âm thầm không chạy; lỗi quét bị nuốt chỉ ghi log — low; đúng mẫu các bộ quét hiện có, đã có test cổng vai trò.
- `ScheduleModule.forRoot()` trong `TopupsModule` — false; `tasks`, `storage`, `ops` làm như vậy (đã ghi trong log).
- Bộ quét không có LIMIT / chạy trùng ở nhiều worker — low; một UPDATE có điều kiện, an toàn khi chạy trùng.
- `confirmTransfer` đọc thừa, kiểm tra chủ đơn ngoài UPDATE, `RETURNING *` — low; đã loại ở log (chủ đơn không đổi được).
- `approve_by` theo đồng hồ app, hạn QR theo đồng hồ DB — low; đã loại ở log.
- Trả `TOPUP_STATE_INVALID` thay vì `TOPUP_QR_EXPIRED` khi bộ quét đã expire; nhánh `expired === 0` còn `awaiting_transfer` — low; AC quy định `expired` → `TOPUP_STATE_INVALID`, nhánh sau gần như không thể xảy ra vì cùng đồng hồ DB.
- Thiếu audit khi chuyển trạng thái, thiếu ghi số đơn expire trong `create`, `computeApproveBy(Invalid Date)`, thiếu test 401/khóa/throttle riêng cho route mới — low; đã loại ở log hoặc đầu vào luôn là `new Date()`; guard JWT và `AccountLockedGuard` có ở cấp class (`topups.controller.ts:19`).
- Test đua 20 đơn phụ thuộc thời gian (TTL 1 s, ngủ 900 ms) — low; đã được xử lý ở vòng review trước (khẳng định 200↔`pending`, 409↔`expired`).

## Verification

**Commands:**
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua `deploy/compose.yml`; không chạy song song với lượt test khác)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
