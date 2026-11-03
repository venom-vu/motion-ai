---
title: 'Story 1.7: [BE] Tier, API ví và đối soát sổ cái'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_commit: '744c65f4dec9f516e767f33a06753436e03371e4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ví đã có sổ cái (Story 1.6) nhưng chưa có Tier: không cột `users.tier_pack`, `wallet.hold` không trả Tier Snapshot, `GET /me` trả `balance/held` hằng 0 và `GET /wallet/ledger` trả trang rỗng. Không có job nào phát hiện `balance/held` lệch sổ cái.

**Approach:** `wallet` giữ cấu hình Tier phía server và một hàm thuần tính `tier_pack`, chạy cùng transaction với `GRANT/TOPUP/ADJUST/CAPTURED`. `hold` trả Tier Snapshot. `/me`, `/wallet/ledger`, `/config/pricing` đọc dữ liệu thật qua `WalletService`. Job `@nestjs/schedule` hằng ngày đối soát và báo qua `NotifierPort` (adapter ghi log).

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**` và `pnpm-lock.yaml` (nhánh `be/*`). Ghim `@nestjs/schedule@12.0.2`, không dùng `^`/`~`.
- Migration thêm duy nhất `users.tier_pack TEXT NULL` với CHECK trong `('starter','pro','creator')`. Chỉ `wallet` ghi cột này. Tier suy ra từ `tier_pack` (null = FREE), không thêm cột `tier`.
- Tổng sở hữu = `balance + held`. Sau mỗi bút toán `GRANT`, `TOPUP`, `ADJUST`, `CAPTURED`: tổng < 100 thì `tier_pack = NULL`. `HOLD` và `RELEASED` không tính lại.
- `TOPUP`: nếu `tier_pack` trước đó NULL thì bằng gói vừa nạp, ngược lại bằng gói cao hơn (`starter < pro < creator`); sau đó áp ngưỡng 100.
- Cấu hình giá/Cap/Priority nằm một nơi trong `wallet` (FREE 5s/10; Starter 10s/3/49.000đ/5.000cr; Pro 15s/2/99.000đ/12.000cr; Creator 20s/1/199.000đ/30.000cr), dùng chung cho logic Tier và `GET /config/pricing`.
- `wallet.hold` trả `TierSnapshot` {tier, priority, maxVideoSeconds} đọc trong cùng transaction, dưới khóa dòng user.
- `/me` và `/wallet/ledger` chuyển BigInt sang number, ném lỗi nếu vượt `Number.MAX_SAFE_INTEGER`. Ledger chỉ trả bút toán của chính user, sắp `created_at` rồi `id` giảm dần, phân trang bằng cursor theo `WalletLedgerQuerySchema`, nhãn tiếng Việt từ `LEDGER_ENTRY_LABELS_VI`.
- Quyết định của người dùng: thêm `wallet.adjust(tx, userId, amount)` tối thiểu (amount ≠ 0, bắt buộc `tx`, khóa dòng user, ghi `ADJUST`, từ chối nếu `balance` sẽ âm bằng `INSUFFICIENT_CREDIT`, rồi tính lại Tier). Chưa có endpoint, audit hay quyền admin; story admin sẽ bọc hàm này.
- Job đối soát chỉ chạy trong tiến trình worker; lệch thì ghi log mức lỗi và gọi `NotifierPort.notify`. Adapter ghi log được đăng ký ở `ops`.

**Never:**
- Không sửa `packages/contracts`; không thêm adapter Discord; không thêm endpoint admin; không UPDATE/DELETE `ledger_entries`; không tính lại Tier khi `HOLD`/`RELEASED`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| FREE nạp gói | `tier_pack` NULL, TOPUP starter 5.000 | `tier_pack='starter'`, Tier Starter | N/A |
| Pro nạp gói thấp hơn | Pro, 5.000 cr, TOPUP starter | `tier_pack` vẫn `pro` | N/A |
| Rơi về FREE | Creator, CAPTURED làm tổng còn 40 | `tier_pack` NULL | N/A |
| Nạp sau khi rơi | FREE (40 cr), TOPUP starter | Tier Starter (Priority 3, Cap 10s) | N/A |
| Đúng ngưỡng | Tổng còn 99 / còn 100 | 99: FREE; 100: giữ gói | N/A |
| GRANT user mới | GRANT 500 | Vẫn FREE (`tier_pack` NULL) | N/A |
| HOLD không đổi Tier | Pro, HOLD làm `balance` < 100 nhưng tổng ≥ 100 | Tier giữ Pro; Snapshot Pro (2, 15s) | N/A |
| Ledger phân trang | 5 bút toán, pageSize 2, có user khác | 3 trang, mới nhất trước, không lẫn user khác | pageSize/cursor sai → 400 |
| ADJUST giảm tổng | Pro, ADJUST −n làm tổng < 100 | `tier_pack` NULL; ADJUST làm `balance` âm bị từ chối | `INSUFFICIENT_CREDIT` |
| Đối soát lệch | `balance` bị sửa tay | log lỗi + `notify` một lần cho user đó | N/A |
| Đối soát khớp | Mọi user nhất quán | Không log lỗi, không `notify` | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` + migration `20261103010000_wallet_tier_pack` -- thêm `User.tierPack` và CHECK.
- `apps/api/src/modules/wallet/wallet.service.ts` -- `lockUser` đọc thêm `tier_pack`; `applyDelta`/`settle`/`grant`/`topup` gọi tính lại Tier; `hold` trả Snapshot; thêm `adjust`, `getSummary`, `listLedger`. Bám `assertTx`, `assertId`, `insertEntry` hiện có.
- `apps/api/src/modules/wallet/tier.ts` (mới) -- cấu hình Tier và hàm thuần.
- `apps/api/src/modules/auth/me.controller.ts` -- thay giá trị hằng bằng `WalletService`; `/config/pricing` lấy từ cấu hình wallet; `AuthModule` import `WalletModule`.
- `apps/api/src/ports/index.ts` -- `NotifierPort.notify(event)`.
- `apps/api/src/modules/ops/` -- `LogNotifierAdapter`, `ReconcileService` (`@Cron`), `OpsModule` import `ScheduleModule.forRoot()`.
- `apps/api/src/worker.ts` -- đánh dấu tiến trình worker trước khi tạo context.
- `packages/contracts/src/wallet.ts` -- `MeResponseSchema`, `WalletLedgerResponseSchema`, `PricingConfigResponseSchema`, `TierSnapshotSchema`: chỉ import để validate trong test, không sửa.
- `apps/api/test/tier.test.mjs` (mới) -- bám harness `wallet.test.mjs`; dùng `app.inject`/HTTP như `auth.test.mjs` cho các route.

## Tasks & Acceptance

**Execution:**
- [x] `schema.prisma`, migration `20261103010000_wallet_tier_pack` -- cột `tier_pack` và CHECK -- nền tảng Tier.
- [x] `wallet/tier.ts`, `wallet.service.ts` -- cấu hình, hàm thuần, tính lại Tier trong transaction, `adjust`, Snapshot, `getSummary`, `listLedger` -- AD-10.
- [x] `me.controller.ts`, `auth.module.ts`, `wallet.module.ts` -- nối `/me`, `/wallet/ledger`, `/config/pricing` -- FR11.
- [x] `ports/index.ts`, `ops/*`, `worker.ts`, `package.json`, `pnpm-lock.yaml` -- Notifier, job đối soát chỉ ở worker -- AR14.
- [x] `test/tier.test.mjs` -- phủ ma trận trên PostgreSQL thật, kiểm `/config/pricing` khớp `DEFAULT_PRICING_CONFIG` và parse qua schema contracts -- bảo chứng.

**Acceptance Criteria:**
- Given migration, when truy vấn catalog, then `users.tier_pack` tồn tại với CHECK gói hợp lệ.
- Given các phản hồi `/me`, `/wallet/ledger`, `/config/pricing` và Snapshot của `hold`, when parse bằng schema trong `@motion-ai/contracts`, then đều hợp lệ.
- Given user A và B cùng có bút toán, when A gọi `/wallet/ledger`, then không thấy bút toán của B.
- Given worker và api cùng nạp `AppModule`, when đến giờ đối soát, then chỉ tiến trình worker chạy job.

## Implementation Notes

- `tier_pack` là nguồn duy nhất; Tier suy ra từ gói còn hiệu lực. `PRICING_CONFIG` trong `wallet/tier.ts` dùng chung cho Tier và `GET /config/pricing`.
- `wallet.adjust(tx, userId, amount)` tối thiểu theo quyết định của người dùng, chưa có endpoint hay audit.
- Cron đối soát 03:00 Asia/Ho_Chi_Minh, chỉ chạy khi `MOTION_PROCESS_ROLE=worker`.
- Kết quả: tier + wallet 38/38, api 72 (71 pass, 1 skip compose E2E), lint/typecheck/build qua.

## Spec Change Log

## Review Triage Log

- patch (đã sửa) -- `scheduledReconcile` không bắt lỗi -- thêm try/catch, log và notify `RECONCILE_FAILED`; có test.
- patch (đã sửa) -- `adjust` ném SyntaxError thô với amount chuỗi không nguyên -- bắt và trả 409.
- patch (đã sửa) -- cursor không giới hạn độ dài -- chặn trên 128 ký tự.
- patch (đã sửa) -- test đối soát thiếu ca `held` lệch và HOLD đã CAPTURED; test lệch balance không có try/finally -- đã thêm 2 test và try/finally.
- defer -- backfill `tier_pack` cho user đã nạp: chưa có luồng gọi `wallet.topup` (Epic 3) nên chưa có dữ liệu TOPUP; làm cùng migration của Epic 3 nếu cần.
- defer -- chạy nhiều bản sao worker gửi cảnh báo lặp: compose chỉ có một `nestjs-worker`; thêm khóa advisory khi scale.
- defer -- chống lặp/gộp cảnh báo đối soát mỗi đêm; adapter Discord ở Epic 3.
- defer -- chỉ mục và độ chính xác thứ tự trong cùng mili giây cho `/wallet/ledger`; cần cột tuần tự hoặc chỉ mục biểu thức khi bảng lớn.
- defer -- `ScheduleModule` đăng ký cả ở api, cờ `MOTION_PROCESS_ROLE` là biến toàn tiến trình; tách module worker và thêm assertion trong test bootstrap worker.
- defer -- `adjust` thiếu actor/lý do: gắn audit ở story admin.
- defer -- `tier.ts` chép lại `DEFAULT_PRICING_CONFIG`; có test khẳng định bằng nhau, hợp nhất khi cho phép sửa contracts.
- defer -- `getMe` đọc user hai lần; `@Optional()` trên `PrismaService` của `WalletService`.
- false -- TOPUP nhỏ hơn 100 credit thành FREE: gói nhỏ nhất 5.000 credit, và AD-10 quy định dưới 100 là FREE.

## Design Notes

Cursor ledger: base64url của `createdAt ISO|id`; truy vấn `(created_at, id) < (cursor)` sắp giảm dần, lấy `pageSize + 1` để suy ra `hasMore`. Chọn lưu `tier_pack` thay vì cột `tier` theo AC của story (Tier là hàm của gói còn hiệu lực), nên không có hai nguồn sự thật.

## Verification

**Commands:**
- `pnpm run lint` -- expected: exit 0
- `pnpm run typecheck` -- expected: exit 0
- `pnpm run build` -- expected: exit 0
- `pnpm --filter @motion-ai/api test` -- expected: exit 0
- `pnpm test` -- expected: exit 0

### Review Findings

- [x] [Review][Defer] `WalletService` nhận `PrismaService` dạng `@Optional()` — thiếu phụ thuộc chỉ lộ thành 500 lúc request [wallet.service.ts:constructor] — deferred: giữ nguyên để test gọi `new WalletService()`; cân nhắc tách `WalletQueryService` sau.
- [x] [Review][Patch] Worker-only gate và cron không được kiểm chứng: xóa `process.env.MOTION_PROCESS_ROLE = 'worker'` ở `worker.ts` mà test vẫn xanh, job đối soát sẽ không bao giờ chạy; thêm assertion sau `bootstrapWorker()` trong `app.test.mjs` (và dọn env) [apps/api/src/worker.ts:9, apps/api/test/app.test.mjs]
- [x] [Review][Patch] Test `/wallet/ledger` không khẳng định thứ tự mới nhất trước, nội dung `nextCursor`, và ánh xạ `type/labelVi/pack/taskId/topupId` cho TOPUP/HOLD/CAPTURED/ADJUST; đổi `DESC`→`ASC` vẫn xanh [apps/api/test/tier.test.mjs:~1147]
- [x] [Review][Patch] Test đặt/khôi phục `MOTION_PROCESS_ROLE` không dùng `try/finally` ở ca "không phải worker"; assertion lỗi sẽ làm rò biến môi trường sang test sau [apps/api/test/tier.test.mjs:356-364]
- [x] [Review][Defer] Job đối soát tải toàn bộ user, không phân trang, gửi một cảnh báo mỗi user (nguy cơ bão cảnh báo), không chống chạy chồng — deferred: đã ghi ở spec; cần khóa advisory/gộp cảnh báo
- [x] [Review][Defer] Đối soát chưa kiểm `tier_pack` so với tổng credit và chưa phát hiện bút toán CAPTURED/RELEASED mồ côi — deferred: ngoài AC của story, mở rộng phạm vi đối soát sau
- [x] [Review][Defer] `PRICING_CONFIG` chép tay khỏi contracts; truy vấn ledger dùng `date_trunc` không tận dụng được chỉ mục — deferred: đã ghi ở spec; cần story `contract/*`
- [x] [Review][Defer] Migration `tier_pack` chưa backfill, chưa có ghi chú rollback — deferred: đã ghi ở spec; chờ Epic 3 ghi TOPUP thật

#### Rejected

- `false` — "Sửa file ngoài `apps/api/**`": spec, `sprint-status.yaml`, `deferred-work.md` là artifact theo dõi BMad, không phải mã nguồn.
- `false` — "HOLD có `task_id` NULL bị ẩn khỏi `open_hold`": `s.task_id = h.task_id` với NULL không bao giờ đúng nên `NOT EXISTS` đúng và HOLD vẫn được tính là mở.
- `false` — "`adjust` bỏ qua `held`": quy tắc spec chỉ cấm `balance` âm.
- `low` — `adjust` tràn BIGINT / nhận `boolean`; `topup` nhận pack sai kiểu: người gọi nội bộ có kiểu TypeScript, thêm guard không đáng.
- `low` — `getMe`/`getSummary` đọc hai lần không nguyên tử; `getPricing` trả object chia sẻ; `!` trong `snapshotFromPack`; cursor rỗng/độ dài 128 chưa có test; kiểm tra cursor trùng lặp với schema: ít gặp, sửa thêm phức tạp.
- `low` — Job cron chạy chồng khi lần trước chưa xong: cron 1 lần/ngày, khó xảy ra.
