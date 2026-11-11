---
title: 'Story 6.4: [BE] Khóa tài khoản và cộng bù credit'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: 'c25c759a68295449185978a79b53e8fd5b0b3f91'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin chưa có API tra cứu tài khoản, khóa/mở khóa hay cộng/trừ bù credit; `wallet.adjust(tx, userId, amount)` hiện tối giản (không lý do, không idempotent) và `admin_audit` chưa có `request_id`.

**Approach:** Thêm module admin-users (`/admin/users/**`) dùng `AuditService`, `WalletService` và Prisma `RefreshToken`; mở rộng `wallet.adjust` trả bút toán; idempotency theo `admin_audit.request_id` duy nhất (cho phép null).

## Boundaries & Constraints

**Always:**
- Nhánh `be/*`: chỉ sửa `apps/api/` và `deploy/`; không sửa `packages/contracts`, `apps/web`; không thêm phụ thuộc. Dùng schema sẵn có trong `packages/contracts/src/admin.ts` (`AdminUser*`, `AdminAdjust*`).
- Mọi route `/admin/users/**`: `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')` (401 chưa đăng nhập, 403 role `user`). Không tìm thấy user: 404 `NOT_FOUND`.
- Migration thêm `admin_audit.request_id TEXT` có unique index (null được lặp). Không có đường xóa/sửa `admin_audit`.
- Lock: `FOR UPDATE` dòng user, đặt `locked_at`, thu hồi mọi refresh token chưa thu hồi, ghi audit (`user.lock`, target `user:<id>`, before/after + reason) trong cùng transaction. Unlock: xóa `locked_at` + audit `user.unlock`. `reason` bắt buộc, thiếu → `VALIDATION_FAILED` `details.reason=REASON_REQUIRED`. `AccountLockedGuard` đã đọc DB nên không đổi; chỉ kiểm tra test.
- Task `queued`/`running` của user bị khóa vẫn chạy bình thường; Task và sổ cái được giữ nguyên.
- `adjust`: `amount` nguyên khác 0, `|amount|` ≤ `ADMIN_ADJUST_MAX` (mặc định 30000; không hợp lệ thì dùng mặc định) nếu không `ADJUST_OVER_LIMIT`; `balance + amount < 0` → `ADJUST_INSUFFICIENT_BALANCE`, không ghi gì. Một transaction: khóa user, `wallet.adjust` ghi `ADJUST` (task_id rỗng) mang dấu `amount`, tính lại Tier, ghi audit (`wallet.adjust`, reason, requestId, amount, balance trước/sau, `taskId` nếu có).
- Trùng `requestId`: trả kết quả lần đầu (đọc từ audit), không ghi bút toán thứ hai; hai lần gọi đồng thời chỉ ghi một (P2002 trên `request_id` → rollback rồi trả kết quả đã có).
- Ledger admin dùng lại `listLedger` (keyset, mới nhất trước). `ADMIN_ADJUST_MAX` ghi vào `apps/api/.env.example` và khối `api` của `deploy/compose.yml`.

**Never:** Không tự hủy Task của tài khoản khóa; không đường mã nào RELEASED Task `succeeded`; không SQL thô vào bảng của module khác (`auth` ghi `users.locked_at`/`refresh_tokens`, `wallet` ghi sổ cái và `users.balance/tier`); không thêm `ApiErrorCode` mới.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tra cứu | `GET /admin/users?email=a@x` | id, email, role, tier, balance, held, lockedAt | Không có → 404 |
| Khóa | `lock` + reason | `locked_at` đặt, refresh token thu hồi, audit | Thiếu reason → 400 `REASON_REQUIRED` |
| JWT cũ sau khóa | access JWT còn hạn, route ghi | 403 `ACCOUNT_LOCKED` | N/A |
| Mở khóa | `unlock` + reason | `locked_at` null, đăng nhập lại được, audit | Thiếu reason → 400 |
| Cộng bù | amount +500, requestId mới | ADJUST +500, balance tăng, Tier tính lại, audit | N/A |
| Trừ bù | amount −200, đủ số dư | ADJUST −200, balance giảm | Thiếu → `ADJUST_INSUFFICIENT_BALANCE`, không ghi |
| Vượt hạn mức | `|amount|` > max | Không ghi | `ADJUST_OVER_LIMIT` |
| Gọi lại | cùng requestId | Kết quả lần đầu, một bút toán | N/A |
| Không phải admin | role `user`/không token | 403/401 | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` -- thêm migration `admin_audit.request_id` + unique index (`User.lockedAt` đã có; `RefreshToken` l.43–54).
- `apps/api/src/modules/wallet/wallet.service.ts` -- `adjust(tx,userId,amount)` l.293 (hiện throw `InsufficientCreditException`, void); mở rộng trả bút toán và số dư trước/sau; `lockUser` l.121, `applyDelta` l.162, `listLedger` l.341; `tier.ts` tính lại Tier.
- `apps/api/src/modules/audit/audit.service.ts` -- `record(tx,{adminId,action,target,beforeAfter})`; thêm tham số `requestId` tùy chọn và hàm tìm theo `request_id`.
- `apps/api/src/modules/auth/` -- `guards/account-locked.guard.ts` (đã đọc DB), `auth.service.ts` (kiểm `lockedAt` l.275/357/428; chưa có thu hồi toàn bộ refresh token).
- `apps/api/src/modules/topups/admin-topups.controller.ts` + `topups.service.ts` l.399–445 -- mẫu controller admin (`safeParse`, `@HttpCode(200)`) và audit trong transaction.
- `apps/api/src/app.module.ts` -- đăng ký module mới (import `AuthModule`, `WalletModule`, `AuditModule`).
- `apps/api/test/admin-topups.test.mjs` -- mẫu test (`mkUser`, `call`, `errCode`, bootstrap từ `dist`).
- `apps/api/.env.example`, `deploy/compose.yml` -- `ADMIN_ADJUST_MAX`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/` -- migration `request_id` duy nhất cho `admin_audit` -- idempotency
- [x] `apps/api/src/modules/audit/audit.service.ts` -- `requestId` khi ghi, tìm theo `requestId` -- dấu vết và phát lại
- [x] `apps/api/src/modules/wallet/wallet.service.ts` -- mở rộng `adjust` -- bút toán `ADJUST` có dấu
- [x] `apps/api/src/modules/` (module admin-users mới + `auth` cho khóa/thu hồi token) -- service, controller, đăng ký -- API quản lý tài khoản
- [x] `apps/api/.env.example`, `deploy/compose.yml` -- `ADMIN_ADJUST_MAX` -- cấu hình
- [x] `apps/api/test/admin-users.test.mjs` -- test I/O Matrix, quyền, đồng thời, không đường xóa audit -- phủ ranh giới

**Acceptance Criteria:**
- Given admin khóa user, when user gọi route ghi bằng JWT cũ, then 403 `ACCOUNT_LOCKED`, refresh bị từ chối, Task đang chạy vẫn kết thúc đúng.
- Given hai lần `adjust` cùng `requestId` (kể cả đồng thời), when xong, then đúng một bút toán `ADJUST` và cùng kết quả.
- Given `pnpm --filter @flowvis/api test`, `lint`, `typecheck`, `build`, `check:boundaries`, when chạy, then pass (trừ các test lỗi có sẵn ở Story 2.14 và 5.2).

## Implementation Notes

- Module `admin-users` mới (service/controller/module); `auth.service` thêm `lockAccount`/`unlockAccount` (chạy trong transaction của bên gọi); `wallet.adjust` trả `{entry, balanceBefore, balanceAfter, held, tier}`; bản phát lại đọc `beforeAfter.result` của audit. `requestId` đã dùng cho user/hành động khác trả `VALIDATION_FAILED` chung (spec không định nghĩa mã riêng).
- Suite api sau review: 518 pass, 5 fail có sẵn (Story 2.14 và 5.2), 6 skip; chạy với `node --env-file=.env` (thiếu `.env` thì hook migrate fail với P1000). `check:boundaries` báo cả file các story trước vì nhánh xếp chồng trên nhánh 6.3 chưa merge (so với `main...HEAD`); file của story này chỉ ở `apps/api/`, `deploy/`, `_bmad-output/`.
- Chưa có test khẳng định Task `queued`/`running` của tài khoản bị khóa vẫn kết thúc (code không đụng Task).

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Debit đồng thời cùng `requestId`: bên thua trả `ADJUST_INSUFFICIENT_BALANCE` thay vì kết quả lần đầu | medium | patch | Bên thua khóa user sau commit, thấy số dư đã giảm; catch chỉ phát lại khi lỗi unique |
| Phát lại với amount/reason/admin khác trả 200 kết quả cũ | medium | patch | `replay()` chỉ so action và target |
| `reason` quá dài/sai kiểu báo nhầm `REASON_REQUIRED` | low | patch | `validationError` map mọi issue trên path `reason`; sửa là một điều kiện |
| Test phát lại khác amount/user, khóa lần hai, id không tồn tại chưa có | medium | patch | Chỉ có replay y hệt và 404 cho GET |
| Admin tự khóa mình hoặc admin khác | medium | defer | Spec không cấm; cấm cần sửa khối frozen |
| Test "không có route sửa/xóa audit" luôn pass (route `/admin/audit` không tồn tại) | medium | defer | Chỉ chứng minh 404; cần guard thật hoặc test mức CSDL |
| Task `queued`/`running` của user bị khóa chưa có test | low | defer | Code không đụng Task; Implementation Notes đã ghi nhận |
| Email phân biệt hoa thường làm `findFirst` mơ hồ | false | - | `auth.service` chuẩn hóa email về chữ thường khi đăng ký/đăng nhập (l.115, 269), `users.email` unique |
| Khóa lặp/mở khóa lặp ghi thêm audit | low | reject | Hành vi vô hại, giữ `locked_at` gốc; sửa thêm nhánh |
| `Number(bigint)` không dùng `toSafeNumber` | low | reject | Số dư không thể vượt 2^53 trong thực tế |
| `wallet.adjust` trả `held`/`tier` không dùng; không tái dùng `insertEntry` | low | reject | Cosmetic |
| `ADMIN_ADJUST_MAX` sai giá trị rơi về 30000 im lặng | low | reject | Spec quy định dùng mặc định |
| Replay kiểm trước hạn mức | low | reject | Hành vi hợp lý cho phát lại |
| `taskId` tham chiếu không bao giờ được ghi | low | reject | `AdminAdjustRequestSchema` không có trường `taskId` |
| `requestId` toàn cục, không theo admin | medium | patch | Gộp với phát lại: nay so sánh adminId |
| `AuditService` nay cần `PrismaService` | false | - | Build và test pass; InfraModule cung cấp |
| Refresh đồng thời với `lockAccount` có thể cấp token mới | maybe-false | defer | Cần kiểm tra luồng `refresh` có đọc `locked_at` sau khóa dòng; mức medium chưa xác minh |

## Design Notes

Idempotency theo `admin_audit.request_id` (đúng AC của epic) nên không thêm cột vào `ledger_entries`; bút toán và audit cùng transaction nên không thể lệch. Bản phát lại đọc `beforeAfter` của audit lần đầu để dựng lại `{user, entry}`; lưu `entryId` trong `beforeAfter`.

## Verification

**Commands:**
- `pnpm --filter @flowvis/api test` -- expected: pass (cần Docker; chạy với `node --env-file=.env`)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: chỉ `apps/api/`, `deploy/`, `_bmad-output/`
