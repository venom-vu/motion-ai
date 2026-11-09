---
title: 'Story 3.5: [BE] Duyệt và từ chối đơn, nhật ký Admin'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '26d96d6cb3771c84e29288a89ce7448e68244811'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đơn nạp `pending` chưa có đường duyệt nên credit không bao giờ được cộng; chưa có route `/admin/**` và chưa có nhật ký thao tác Admin.

**Approach:** Thêm bảng `admin_audit` và service `audit` (nơi duy nhất ghi bảng này), cùng `AdminTopupsController` (`/admin/topups`) cho Admin liệt kê, duyệt, duyệt đơn hết hạn, từ chối, chuyển `needs_review` và trả về `pending`. Mọi chuyển trạng thái là CAS; duyệt chạy trong một transaction do `topups` mở: CAS → `wallet.topup` → `audit`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`, dùng schema và mã lỗi đã có trong `packages/contracts` (`AdminTopup*Schema`, `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `VALIDATION_FAILED`); không đổi contracts.
- Controller dùng `JwtAuthGuard` + `RolesGuard` với `@Roles('admin')` (chưa đăng nhập 401, role `user` 403). Body/params sai schema → `VALIDATION_FAILED` (400), id không phải UUID hoặc không tồn tại → `NOT_FOUND`.
- Chỉ module `topups` ghi bảng `topups`; chỉ `AuditService.record(tx, …)` ghi `admin_audit` (cột `id, admin_id, action, target, before_after jsonb, at`; `admin_id` FK `users`). `audit` ghi trong transaction của bên gọi.
- Duyệt (`approve`: nguồn `pending|needs_review`; `approve-expired`: nguồn `expired`): một transaction: `UPDATE topups SET status='approved', bank_ref=… WHERE id=? AND status=<nguồn>`; 0 dòng → `TOPUP_STATE_INVALID`; `wallet.topup(tx, userId, id, credits, pack)`; `audit.record`. Trùng `bank_ref` (P2002 trên `topups_bank_ref_key`) → rollback cả transaction và trả `BANK_REF_DUPLICATE` (409). Credit lấy từ `PRICING_CONFIG` theo `pack`, không từ client. Hai lần duyệt song song chỉ cộng một lần.
- `reject` (nguồn `pending|needs_review`, lưu `reject_reason`), `needs-review` (nguồn `pending`, lưu `note`), `return-to-pending` (nguồn `needs_review`, xóa `note`, tính lại `approve_by` theo `computeApproveBy(now)` và đặt lại `overdue_notified_at`/`overdue_notify_attempts`, vì giữ hạn cũ làm đơn quá hạn ngay khi quay về hàng chờ): CAS rồi ghi audit cùng transaction. `audit.action` phân biệt `topup.approve`, `topup.approve_expired`, `topup.reject`, `topup.needs_review`, `topup.return_to_pending`; `target` = `topup:<id>`; `before_after` chứa trạng thái trước/sau (và `bank_ref`/lý do/ghi chú nếu có).
- `GET /admin/topups?status&pageSize&cursor`: mới nhất trước (`created_at desc, id desc`), cursor theo id như `list` hiện có, trả `AdminTopupListResponse`; `isOverdue = status==='pending' && approve_by < now()`. Không lộ email.
- Đơn `approved`/`rejected` hoặc sai nguồn → `TOPUP_STATE_INVALID` (409); `approve` thường với `expired` cũng vậy.

**Never:**
- Không sửa `apps/web`, `packages/contracts`; không SQL thô ghi `ledger_entries`/`users` ngoài `wallet`; không để lỗi P2002 trong luồng ví bị nuốt (phải rollback); không làm FE dashboard (3.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Duyệt thường | `pending`, `bankRef` mới | `approved`, +credit theo gói, Tier/`tier_pack` tính lại, 1 dòng audit; `GET /me` thấy số dư mới | N/A |
| Gói Creator | duyệt gói `creator` | Priority 1 ngay | N/A |
| Thiếu bank_ref | body rỗng/blank | Không đổi gì | 400 `VALIDATION_FAILED` |
| bank_ref trùng | đã dùng ở đơn khác | Không cộng credit, đơn giữ nguyên, không audit | 409 `BANK_REF_DUPLICATE` |
| Duyệt song song / bấm đúp | 2 request cùng đơn | Đúng 1 bút toán `TOPUP` | Bên thua 409 `TOPUP_STATE_INVALID` |
| Duyệt đơn hết hạn | `expired` qua `approve-expired` | `approved`, audit `topup.approve_expired` | `approve` thường → `TOPUP_STATE_INVALID` |
| Từ chối | `pending`/`needs_review` + lý do | `rejected`, lưu lý do, audit | Thiếu lý do → `VALIDATION_FAILED` |
| needs-review ↔ pending | `pending` + ghi chú; rồi return | `needs_review` với `note`; về `pending` | Sai nguồn → `TOPUP_STATE_INVALID` |
| Trạng thái cuối | `approved`/`rejected` | Không đổi | `TOPUP_STATE_INVALID` |
| Quyền | user thường / không token | N/A | 403 / 401 |
| Danh sách | lọc `pending`, quá `approve_by` | `isOverdue=true`, phân trang đúng | cursor sai → `VALIDATION_FAILED` |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma`, `prisma/migrations/` -- thêm model `AdminAudit` và migration `20261107020000_admin_audit` (sau `topup_notify_attempts`); `admin_id` FK `users`.
- `apps/api/src/modules/audit/` (`index.ts`, `audit.module.ts` rỗng hiện tại) -- thêm `audit.service.ts` (`record(tx, {adminId, action, target, beforeAfter})`), export từ module.
- `apps/api/src/modules/topups/topups.service.ts` -- thêm các hàm admin (`adminList`, `approve`, `approveExpired`, `reject`, `markNeedsReview`, `returnToPending`); tái dùng `toDto`, `UUID_REGEX`, `apiError`; `toDto` hiện chưa có `userId`/`isOverdue` → thêm `toAdminDto`.
- `apps/api/src/modules/topups/admin-topups.controller.ts` (mới), `topups.module.ts` -- đăng ký controller; import `WalletModule`, `AuditModule`; xem `topups.controller.ts` làm mẫu validate.
- `apps/api/src/modules/wallet/wallet.module.ts` -- đảm bảo export `WalletService`. `wallet.service.ts:270` `topup(tx,…)` dùng nguyên, không sửa.
- `apps/api/src/modules/auth/guards/roles.guard.ts`, `decorators/roles.decorator.ts` -- dùng nguyên (`RolesGuard` ném 403).
- `apps/api/test/topups.test.mjs`, `test/auth.test.mjs:88` -- mẫu bootstrap, JWT admin (`ADMIN_EMAILS`), PostgreSQL thật.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` + migration mới -- bảng `admin_audit`, chỉ mục `(target)`, `(at desc)` -- nhật ký truy vết
- [x] `modules/audit/audit.service.ts` + `audit.module.ts` -- `AuditService.record(tx, …)` -- nơi ghi duy nhất
- [x] `modules/topups/topups.service.ts` -- sáu thao tác admin bằng CAS trong transaction -- AD-4/AD-16
- [x] `modules/topups/admin-topups.controller.ts`, `topups.module.ts`, `wallet.module.ts` -- route `/admin/topups*` với guard vai trò -- phân quyền
- [x] `test/admin-topups.test.mjs` -- test trên PostgreSQL thật toàn bộ ma trận trên, gồm duyệt song song 5 request đồng thời chỉ cộng một lần, rollback khi `bank_ref` trùng, Tier Creator, `GET /me` và 401/403 -- phủ AC

**Acceptance Criteria:**
- Given migration chạy, then có bảng `admin_audit` và chỉ `AuditService` ghi vào.
- Given đơn được duyệt, when người dùng gọi `GET /me`, then thấy số dư và Tier mới; `pnpm run reconcile` không báo lệch sổ cái.
- Given mọi thao tác thành công, then có đúng một dòng `admin_audit` cùng transaction; thao tác lỗi không để lại dòng nào.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `casTransition` đọc trước không khóa nên audit `before` có thể sai (Blind, Edge x2) | medium | patch (đã vá) | Dòng được `SELECT … FOR UPDATE` trước khi đọc; `updateMany` CAS giữ nguyên. |
| 2 | `isBankRefDuplicate` khớp lỏng chuỗi `bank_ref` (Blind, Edge x2) | medium | patch (đã vá) | Chỉ còn khớp `topups_bank_ref_key`; test trùng bank_ref vẫn pass. |
| 3 | Thiếu test approve từ `needs_review` và reject từ `expired` (Verification) | medium | patch (đã vá) | Đã thêm 2 test; 14/14 pass. |
| 4 | Đọc lại đơn sau commit ở `adminTransition` | low | rejected | Phản hồi vẫn là trạng thái hợp lệ gần nhất; sửa thêm nhánh, không có hậu quả người dùng. |
| 5 | JWT role không kiểm tra lại DB (Blind, Edge) | maybe-false | defer | Hành vi chung của `RolesGuard` Epic 1, không do story này; khóa/hạ quyền thuộc Epic 6 (6.4). |
| 6 | `bankRef` khác hoa/thường hoặc khoảng trắng lọt unique (Edge) | medium | defer | Chuẩn hóa `bank_ref` là quyết định nghiệp vụ chưa có trong spec/contracts (schema chỉ trim); cần chủ sản phẩm quyết. |
| 7 | `return-to-pending` không gia hạn `approve_by`; `needs_review` không có `isOverdue` (Blind, Edge, Verification) | maybe-false | resolved | Chủ sản phẩm chọn tính lại `approve_by` khi quay về hàng chờ (2026-11-08); code đã làm vậy, spec đã sửa theo. `needs_review` vẫn không có hạn (xem deferred-work). |
| 8 | Không có endpoint đọc `admin_audit`, danh sách thiếu tìm kiếm/email, bảng chưa chặn UPDATE/DELETE, không thông báo người dùng khi duyệt | false | rejected | Ngoài ý định của story (AC chỉ yêu cầu ghi); FE 3.7 và Epic 6.6 xử lý. |
| 9 | Cursor theo id dòng, pack lookup ném `Error` thường, test `return-to-pending` không gửi body, reconcile chưa chạy script | low | rejected | Mẫu cursor trùng `list` hiện có; pack luôn hợp lệ nhờ CHECK DB; không gây lỗi thật. Script reconcile đã chạy: lệch 2 user fixture cũ từ 2026-11-06, không phải do story này (xem deferred-work). |

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck` -- expected: không lỗi
- `pnpm --filter @motion-ai/api test` -- expected: toàn bộ test pass, gồm `admin-topups.test.mjs`
- `pnpm run check:boundaries` -- expected: pass
