---
title: 'Story 1.6: [BE] Sổ cái credit bất biến'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'ad690d0e396b7f624d8804ffe75a814befa58f48'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `@motion-ai/api` chưa có sổ cái credit: không có bảng `ledger_entries`, không có cột `users.balance/held`, và `WalletModule` còn rỗng. Chưa có gì ngăn HOLD kép, CAPTURED/RELEASED kép, số dư âm hay đua song song.

**Approach:** Migration (Prisma + SQL thô) thêm `ledger_entries` và `users.balance/held` cùng các CHECK và chỉ mục duy nhất một phần. `WalletService` cung cấp `hold`, `capture`, `release`, `grant`, `topup` bắt buộc nhận `tx`, khóa một dòng user bằng `SELECT … FOR UPDATE`, rollback toàn bộ khi gặp P2002. Test tích hợp chạy trên PostgreSQL thật.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` (và `pnpm-lock.yaml` nếu cần) để đúng ranh giới nhánh `be/*`.
- `ledger_entries`: `id` UUID, `user_id` (FK `users`), `type` (CHECK trong `GRANT|TOPUP|ADJUST|HOLD|CAPTURED|RELEASED`), `amount` bigint, `task_id` UUID null và `topup_id` UUID null (chưa có FK), `pack` text null (CHECK: chỉ khác null khi `type='TOPUP'`, giá trị `starter|pro|creator`), `created_at`. Dấu CHECK theo AD-2: GRANT/TOPUP > 0, HOLD < 0, RELEASED > 0, CAPTURED = 0, ADJUST ≠ 0.
- `users.balance` và `users.held` kiểu bigint NOT NULL DEFAULT 0, `CHECK (balance >= 0)`, `CHECK (held >= 0)`. Chỉ `wallet` ghi hai cột này; `auth` không đụng tới.
- Chỉ mục duy nhất một phần trong migration SQL thô: `(task_id) WHERE type='HOLD'` và `(task_id) WHERE type IN ('CAPTURED','RELEASED')`.
- Mọi hàm ghi của wallet nhận `tx` làm tham số đầu và ném lỗi nếu thiếu. Mỗi hàm khóa đúng một dòng `users` bằng `SELECT … FOR UPDATE` qua `tx.$queryRaw`.
- `capture`/`release` đọc số tiền từ dòng HOLD của `taskId`. `capture`: `held -= amount`, ghi CAPTURED 0. `release`: `held -= amount`, `balance += amount`, ghi RELEASED +amount. Thiếu HOLD hoặc đã có CAPTURED/RELEASED thì từ chối.
- `hold` với số dư thiếu ném `INSUFFICIENT_CREDIT` (HTTP 402 hoặc theo `ApiErrorCode` hiện có) và không ghi gì.
- Lỗi P2002 trong luồng ví: ném lỗi ngay để transaction rollback, không truy vấn tiếp trên `tx`.
- `balance` của user luôn bằng `SUM(amount)`; `held` bằng tổng HOLD chưa có CAPTURED/RELEASED.

**Never:**
- Không UPDATE/DELETE `ledger_entries`; không thêm `tier`, `tier_pack` hay logic Tier (thuộc 1.7); không gọi `wallet.grant` từ luồng đăng ký (thuộc 1.8); không tạo FK `task_id`/`topup_id`; không tạo endpoint HTTP.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HOLD đủ số dư | balance 500, hold 100 | balance 400, held 100, một dòng HOLD −100 | N/A |
| HOLD thiếu số dư | balance 50, hold 100 | Không ghi gì | `INSUFFICIENT_CREDIT` |
| HOLD trùng task | HOLD lần hai cùng `task_id` | Lần hai bị từ chối, rollback | P2002 → rollback |
| Hai HOLD song song | balance 100, 2×HOLD 100 | Đúng một thành công, balance không âm | Bên còn lại `INSUFFICIENT_CREDIT` |
| CAPTURED sau HOLD | HOLD 100 | held −100, balance giữ nguyên, CAPTURED 0 | N/A |
| RELEASED sau HOLD | HOLD 100 | held −100, balance +100, RELEASED +100 | N/A |
| CAPTURED rồi RELEASED cùng task | Đã CAPTURED | RELEASED bị từ chối | rollback |
| capture/release không có HOLD | task lạ | Không ghi gì | lỗi nghiệp vụ |
| grant/topup | amount 500 / pack `pro` | balance +amount, TOPUP lưu `pack` | N/A |
| Gọi không có `tx` | `tx` undefined | Ném lỗi, không ghi | lỗi lập trình |
| Sau P2002 | Pool dùng lại | Truy vấn kế tiếp trên kết nối thường hoạt động | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` -- thêm `User.balance/held` (BigInt) và model `LedgerEntry` (`@@map("ledger_entries")`); giữ nguyên model hiện có.
- `apps/api/prisma/migrations/20261103000000_wallet_ledger/migration.sql` -- bảng, CHECK, chỉ mục một phần thô (theo `migrations/README.md`, quy trình `--create-only`).
- `apps/api/src/modules/wallet/wallet.service.ts` -- `hold/capture/release/grant/topup`; dùng `PrismaTransactionClient` từ `src/infra/prisma.service.ts`.
- `apps/api/src/modules/wallet/wallet.module.ts` + `index.ts` -- export `WalletService`; `index.ts` hiện chỉ có `WalletModule` rỗng.
- `packages/contracts/src/errors.ts`, `wallet.ts` -- đã có `INSUFFICIENT_CREDIT`, `LedgerEntryType`; chỉ import, không sửa.
- `apps/api/test/wallet.test.mjs` -- test PostgreSQL thật; bám mẫu hạ tầng/bootstrap của `test/auth.test.mjs` (docker compose, `PrismaClient` từ `dist`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, migration `20261103000000_wallet_ledger` -- thêm bảng/cột/ràng buộc nêu trên -- nền tảng AD-2.
- [x] `apps/api/src/modules/wallet/wallet.service.ts`, `wallet.module.ts`, `index.ts` -- hiện thực 5 hàm, khóa dòng, bắt P2002 -- nghiệp vụ ví.
- [x] `apps/api/test/wallet.test.mjs` -- phủ toàn bộ ma trận trên PostgreSQL thật -- bảo chứng ràng buộc.

**Acceptance Criteria:**
- Given migration đã chạy, when truy vấn catalog PostgreSQL, then hai chỉ mục một phần, `CHECK (balance >= 0)` và `CHECK (held >= 0)` tồn tại; test fail nếu thiếu một ràng buộc.
- Given hai HOLD cùng `task_id` hoặc CAPTURED và RELEASED cùng `task_id`, when ghi lần hai, then bị từ chối.
- Given các hàm wallet, when gọi không có `tx`, then ném lỗi và không ghi.
- Given hai HOLD song song vượt số dư, when chạy, then đúng một thành công và `balance >= 0`.
- Given một P2002, when xảy ra, then transaction rollback và pool vẫn dùng được.
- Given chuỗi bút toán bất kỳ, when kiểm tra, then `balance = SUM(amount)` và `held` = HOLD chưa chốt.

## Spec Change Log

## Verification

**Commands:**
- `pnpm run check:boundaries -- --branch be/1-6-wallet-ledger` -- expected: exit 0
- `pnpm run lint` -- expected: exit 0
- `pnpm run typecheck` -- expected: exit 0
- `pnpm run build` -- expected: exit 0
- `pnpm --filter @motion-ai/api test` -- expected: exit 0
- `pnpm test` -- expected: exit 0

## Review Triage Log

- patch (đã sửa) -- `assertTx` chấp nhận client gốc -- từ chối client có `$connect`.
- patch (đã sửa) -- `taskId`/`topupId` null hoặc sai UUID lọt qua chỉ mục một phần -- thêm `assertId` và CHECK `task_id`/`topup_id` bắt buộc trong migration.
- patch (đã sửa) -- topup trùng `topupId` chưa bị chặn -- thêm chỉ mục duy nhất một phần `topup_id WHERE type='TOPUP'`.
- patch (đã sửa) -- test thiếu CHECK sai dấu/loại, lớp lỗi 409/402, song song capture/release và HOLD cùng task -- đã thêm 5 test.
- defer -- không có `adjust()` và API đọc số dư; ADJUST thuộc story admin (epics.md ~dòng 2381).
- defer -- `User.balance/held` là BigInt, sẽ lỗi khi serialize JSON; `/me` hiện trả hằng 0, xử lý ở story 1.7.
- defer -- trigger DB chặn UPDATE/DELETE `ledger_entries`; ngoài phạm vi AC của 1.6.
- false -- khóa user bị `locked_at` vẫn HOLD được: kiểm tra khóa thuộc `AccountLockedGuard` ở tầng route (AD-18), không thuộc `wallet`.

## Implementation Notes

- Migration viết tay (không qua `--create-only`). Sau review đã thêm CHECK `task_id`/`topup_id` bắt buộc và chỉ mục duy nhất `topup_id WHERE type='TOPUP'`; DB dev đã được người dùng reset để áp bản mới.
- `wallet.topup(tx, userId, topupId, amount, pack)`: `topupId` đứng trước `amount` đúng chữ ký trong AC.
- `assertTx` từ chối client gốc (có `$connect`); `taskId`/`topupId` phải là UUID.
- Đã sửa một assertion của test Story 1.5 (`auth.test.mjs`) khẳng định `users` không có `balance/held`, vì nay có cột này theo thiết kế.
- Kết quả: test ví 20/20, api 57 (56 pass, 1 skip compose E2E), `pnpm test` gốc exit 0. `check:boundaries` fail chỉ vì file `_bmad-output/` nằm ngoài `apps/api/`.
