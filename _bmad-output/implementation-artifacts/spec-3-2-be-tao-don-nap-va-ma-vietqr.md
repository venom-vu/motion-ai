---
title: 'Story 3.2: [BE] Tạo đơn nạp và mã VietQR'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '525303ddcf4f386567b210538b865953b00211fa'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** API chưa có bảng `topups`, chưa tạo được đơn nạp, chưa sinh mã VietQR, nên người dùng chưa thể chọn gói và chuyển khoản; các story 3.3–3.5 chưa có dữ liệu để chạy tiếp.

**Approach:** Thêm migration `topups` (kèm khóa ngoại `ledger_entries.topup_id`), cài `TopupsModule` với `POST /topups`, `GET /topups`, `GET /topups/{id}` theo hợp đồng của 3.1, bộ sinh `qrPayload` VietQR/EMVCo cục bộ có CRC16, cấu hình tài khoản nhận qua biến môi trường và giới hạn tần suất cho route ghi.

## Boundaries & Constraints

**Always:**
- Chỉ module `topups` ghi bảng `topups` (AD-1); story này không ghi `ledger_entries`, chỉ thêm khóa ngoại. Dùng schema từ `@motion-ai/contracts` (`TopupCreateRequestSchema`, `TopupSchema`, `TopupIdParamsSchema`, `MAX_OPEN_TOPUPS`), không định nghĩa lại.
- Bảng `topups` (id uuid, `user_id`, `code` UNIQUE, `pack`, `amount_vnd`, `status`, `qr_expires_at`, `approve_by`, `bank_ref` UNIQUE cho phép null, `reject_reason`, `note`, `tos_version`, `notified_at`, `overdue_notified_at`, `created_at`, `updated_at`) viết bằng migration SQL thô, có `CHECK` cho `status` và `pack`, FK `user_id`, và `ledger_entries_topup_id_fkey` (ON DELETE RESTRICT). Thêm model Prisma tương ứng.
- Số tiền và credit lấy từ `PRICING_CONFIG.topupPacks` (`wallet/tier.ts`), không nhận từ client. `qr_expires_at` = bây giờ + 15 phút. `tos_version` ghi `TOS_VERSION` hiện hành.
- Thứ tự kiểm tra `POST /topups`: guard JWT + `AccountLockedGuard` (`ACCOUNT_LOCKED`) → parse body (sai `consent` → `CONSENT_REQUIRED`, lỗi khác → `VALIDATION_FAILED`, theo mẫu `createFaceSwap`) → đếm đơn mở và INSERT trong một transaction khóa dòng user (đơn `awaiting_transfer`/`pending`/`needs_review` ≥ `MAX_OPEN_TOPUPS` → `TOPUP_LIMIT`).
- `code` ngẫu nhiên bằng `crypto.randomInt`/`randomBytes` (8 ký tự, bảng chữ in hoa bỏ ký tự dễ nhầm), va chạm UNIQUE thì sinh lại (tối đa vài lần), không trả lỗi cho người dùng. `transferContent` = `NAP <code>`.
- `qrPayload` do hàm thuần sinh theo EMVCo (tag 00, 01=12, 38 GUID `A000000727` + BIN + số tài khoản + `QRIBFTTA`, 53=704, 54=số tiền, 58=VN, 62.08=nội dung, 63=CRC16/CCITT-FALSE); không gọi dịch vụ ngoài. Tài khoản nhận đọc từ `TOPUP_BANK_BIN`, `TOPUP_BANK_ACCOUNT_NO`, `TOPUP_BANK_ACCOUNT_NAME`, thiếu thì khởi động/gọi báo lỗi rõ; thêm vào `apps/api/.env.example`.
- `GET /topups` (cursor, mới nhất trước: `created_at` giảm dần, cùng thì `id` giảm dần, mẫu `tasks`) và `GET /topups/{id}` chỉ trả đơn của chính người đó; đơn của người khác → `FORBIDDEN`, không có → `NOT_FOUND`. Mọi phản hồi qua `TopupSchema`.
- Route ghi (`POST /topups`) có `@nestjs/throttler` theo mẫu `ShareThrottlerGuard` (biến `TOPUP_THROTTLE_LIMIT`/`TOPUP_THROTTLE_TTL_MS`), vượt giới hạn trả `RATE_LIMITED`.

**Never:**
- Không sửa `packages/contracts`, `apps/web`; không xử lý `confirm-transfer`, hết hạn, Discord, `/admin/**` (story 3.3–3.5); không nhận `amountVnd`/credit/Tier từ client; không gọi API VietQR bên ngoài.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo đơn hợp lệ | `{pack:'pro', consent:true}`, 0 đơn mở | 201, đơn `awaiting_transfer`, `amountVnd` 99000, `qrExpiresAt` +15 phút, `transferContent` `NAP <code>`, `qrPayload` CRC hợp lệ | N/A |
| Thiếu/sai cam kết | `consent:false` hoặc thiếu | Không tạo đơn | `CONSENT_REQUIRED` |
| Gói/field lạ | `pack:'vip'`, có `amountVnd` | Không tạo đơn | `VALIDATION_FAILED` |
| Đủ 3 đơn mở | 3 đơn `awaiting_transfer`/`pending`/`needs_review` | Không tạo đơn thứ 4; đơn `approved`/`expired` không tính | `TOPUP_LIMIT` |
| Tạo đồng thời | 4 yêu cầu song song, 0 đơn mở | Đúng 3 đơn được tạo | 1 yêu cầu `TOPUP_LIMIT` |
| Tài khoản khóa | `locked_at` khác null | Không tạo đơn | `ACCOUNT_LOCKED` |
| Va chạm mã | `code` sinh ra đã tồn tại | Sinh lại, yêu cầu vẫn thành công | N/A |
| Đọc đơn người khác | `GET /topups/{id}` của user khác | Không trả dữ liệu | `FORBIDDEN` |
| Vượt tần suất | Gọi `POST /topups` quá giới hạn | Từ chối | `RATE_LIMITED` |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/topups/index.ts` -- đang là `@Module({})` rỗng, đã có trong `app.module.ts`; thêm `topups.controller.ts`, `topups.service.ts`, `vietqr.ts`, `topups.module.ts`.
- `apps/api/src/modules/tasks/tasks.controller.ts`, `tasks.service.ts` -- mẫu guard (`JwtAuthGuard`, `AccountLockedGuard`), `safeParse` + `BadRequestException({code,message})`, phân trang cursor, `@CurrentUser()`; không sửa.
- `apps/api/src/modules/auth/throttler.guard.ts`, `auth.module.ts` -- `ShareThrottlerGuard` làm mẫu; thêm `TopupThrottlerGuard` và export từ `AuthModule` (hoặc đặt trong `topups`).
- `apps/api/src/modules/wallet/tier.ts` -- `PRICING_CONFIG.topupPacks`; wallet barrel chưa export, import theo đường dẫn hoặc thêm export.
- `apps/api/prisma/schema.prisma`, `prisma/migrations/20261106010000_share_tokens` (mới nhất), `migrations/README.md`, `20261105000000_tasks/migration.sql` (mẫu FK) -- thêm model `Topup`, migration `20261107000000_topups`.
- `apps/api/.env.example` -- phần comment bị lỗi `#`, kiểm tra trước khi thêm biến.
- `apps/api/test/wallet.test.mjs`, `tasks.test.mjs`, `test/helpers/task-fixture.mjs` -- mẫu test tích hợp PostgreSQL thật và HTTP; thêm `test/topups.test.mjs`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, `prisma/migrations/20261107000000_topups/migration.sql` -- bảng `topups`, CHECK, FK `ledger_entries` -- nền dữ liệu
- [x] `apps/api/src/modules/topups/vietqr.ts` -- hàm thuần sinh `qrPayload` + CRC16 -- không phụ thuộc dịch vụ ngoài
- [x] `apps/api/src/modules/topups/topups.service.ts`, `topups.controller.ts`, `topups.module.ts` -- tạo/đọc đơn, giới hạn 3 đơn, throttle -- endpoint của 3.1
- [x] `apps/api/.env.example` -- biến tài khoản nhận và throttle -- cấu hình
- [x] `apps/api/test/topups.test.mjs` -- test I/O Matrix, CRC của `qrPayload`, migration trên PostgreSQL thật -- bằng chứng

**Acceptance Criteria:**
- Given `qrPayload`, when giải mã từng tag và tính lại CRC16, then đúng số tiền, đúng nội dung `NAP <code>` và CRC khớp.
- Given migration, when chạy trên PostgreSQL thật, then `topups.code` và `bank_ref` duy nhất (nhiều `bank_ref` null được phép) và chèn `ledger_entries.topup_id` không tồn tại bị FK từ chối.
- Given phản hồi của cả ba endpoint, when parse bằng `TopupSchema`/`TopupListResponseSchema`, then hợp lệ.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Index `topups_user_id_created_at_idx` có trong SQL nhưng không có trong `schema.prisma` | medium | patch | Lần `prisma migrate dev` sau sẽ sinh migration xóa index; đã khai báo `@@index(... map: ...)` |
| Lỗi thiếu cấu hình nêu tên biến môi trường trong thông báo gửi client | medium | patch | `readBankAccountConfig` trả tên `TOPUP_BANK_*` ra phản hồi; đã chuyển chi tiết sang log, trả thông báo chung |
| Lỗi zod thô (có thể tiếng Anh) trả về cho client khi `VALIDATION_FAILED` | medium | patch | Controller dùng `issues[0].message`; đã dùng `getApiErrorMessageVi` |
| Thiếu test: cursor của người khác hoặc UUID không tồn tại | medium | patch | Đổi `findFirst({id, userId})` thành `findFirst({id})` mà test cũ vẫn qua; đã thêm test |
| Thiếu test: `pending`/`needs_review` tính vào giới hạn, `rejected` không tính | medium | patch | Bỏ hai trạng thái khỏi `OPEN_TOPUP_STATUSES` mà test cũ vẫn qua; đã thêm test |
| Đơn `awaiting_transfer` quá `qr_expires_at` vẫn tính vào giới hạn 3 đơn | medium | defer | Hết hạn thuộc Story 3.3 (bộ quét `awaiting_transfer→expired`); chưa có đường chuyển trạng thái ở 3.2 |
| `toDto` đọc cấu hình tài khoản hiện tại cho mọi đơn, kể cả đơn cũ sau khi đổi tài khoản | medium | defer | Intent và AC không yêu cầu snapshot; cần quyết định sản phẩm trước khi thêm cột |
| `SELECT ... FOR UPDATE users` trong module `topups` vi phạm AD-1 | false | - | Chỉ khóa dòng, không ghi; `tasks.service.ts:379` làm đúng như vậy và AD-3 quy định khóa dòng user |
| Rate limit theo IP, thiếu idempotency key, NAT dùng chung | low | reject | Spec quy định theo mẫu `ShareThrottlerGuard`; idempotency không có trong AC |
| `TOPUP_LIMIT` trả HTTP 429 | low | reject | Spec không nêu mã HTTP; theo mẫu `TASK_LIMIT` |
| P2002 quá 5 lần thành 500; so khớp chuỗi `topups_code_key` giòn | low | reject | Không gian 32^8 nên gần như không thể; đã có test va chạm chứng minh nhận diện đúng |
| `VALIDATE CONSTRAINT` cho FK `NOT VALID` | low | reject | Theo đúng cách migration `tasks` đã làm; dữ liệu cũ do vận hành xử lý |
| `tlv()` ném `Error` khi giá trị > 99 byte; bin/số tài khoản không kiểm tra là chữ số | low | reject | Chỉ xảy ra khi cấu hình env sai; thêm kiểm tra là mở rộng ngoài AC |
| Gói không có trong `PRICING_CONFIG` làm cả danh sách 500 | low | reject | Gói bị ràng buộc `CHECK` ở DB nên không thể lệch với cấu hình hiện tại |
| FORBIDDEN so với NOT_FOUND cho phép dò UUID | false | - | Spec yêu cầu rõ "người khác nhận lỗi không có quyền"; UUID ngẫu nhiên không dò được |
| Fixture `insertTopupRow` cố định 1000, bỏ qua im lặng khi tham số sai | low | reject | Chỉ là fixture test; thao tác sai vẫn bị FK báo lỗi |
| Test xóa `throttle:*` có thể ảnh hưởng suite chạy song song | low | reject | `pnpm test` dùng `--test-concurrency=1`; đã kiểm tra chạy tuần tự |
| Thiếu consent timestamp/IP, audit khi tạo đơn, kiểm tra `users.tosVersion` | low | reject | Intent chỉ yêu cầu lưu `tos_version`; audit thuộc 3.5 |
| Lỗi `consent` che lỗi `pack` khi cả hai sai | low | reject | Cả hai đều là lỗi hợp lệ; thứ tự ưu tiên không thuộc AC |
| Cursor tốn hai truy vấn mỗi trang; `:id` sai định dạng là 404 còn cursor là 400 | low | reject | Cùng mẫu phân trang của `tasks`; không gây sai lệch dữ liệu |
| Đơn đã hết hạn/từ chối vẫn trả `qrPayload` | low | reject | Hợp đồng 3.1 yêu cầu `qrPayload` bắt buộc ở mọi trạng thái |
| Thiếu test đo ngưỡng chính xác của rate limit; `GET` không bị throttle | low | reject | AC chỉ yêu cầu `RATE_LIMITED` khi vượt giới hạn |
| Thiếu mẫu VietQR thực từ app ngân hàng; thiếu test âm cho `buildVietQrPayload` | low | reject | Đã có vector CRC chuẩn và giải mã từng tag; mẫu thực cần tài khoản thật |
| `.env.example`: tài liệu lấy BIN, kiểm tra khi khởi động | low | reject | Spec cho phép báo lỗi khi gọi; tài khoản nhận là `[ASSUMPTION]` ở epic |
| `@@index([status])` thừa so với `(user_id,status)` | low | reject | Index `status` phục vụ bộ quét 3.3/3.4 |
| `TopupsModule` chưa đăng ký trong `AppModule` | false | - | `app.module.ts` đã import `TopupsModule` từ trước; test HTTP chạy qua `bootstrapApi` |

### Review Findings

- [x] [Review][Patch] Thiếu test ghim bộ đếm throttle riêng và fallback env của `TopupThrottlerGuard` [apps/api/src/modules/auth/throttler.guard.ts:157-178] — test hiện chỉ gửi `POST /topups` nên bỏ tiền tố `topup-` hoặc đổi fallback 10 thì vẫn qua. Cần unit test `getTopupThrottleOptions` (env rỗng, `abc`, `0`, âm → `{10, 60000}`) và assert route auth vẫn trả được sau khi chạm giới hạn topup. Đã xử lý: thêm unit test `getTopupThrottleOptions` (6 ca, pass); phần assert route auth chưa thêm vì test 'bộ đếm tạo đơn và xác nhận chuyển khoản tách riêng' đã ghim việc tách bộ đếm theo handler.
- [x] [Review][Defer] Đơn `awaiting_transfer` quá `qr_expires_at` vẫn tính vào giới hạn 3 đơn [apps/api/src/modules/topups/topups.service.ts:311] — deferred: bộ quét `awaiting_transfer→expired` thuộc Story 3.3 (kiểm tra lại sau khi 3.3 merge).
- [x] [Review][Defer] `toDto` lấy thông tin tài khoản nhận và `qrPayload` từ env hiện tại cho mọi đơn, kể cả đơn cũ [apps/api/src/modules/topups/topups.service.ts:98] — deferred: cần quyết định sản phẩm về snapshot tài khoản trên bảng `topups` trước khi thêm cột. Việc đọc `GET` trả 500 khi thiếu env cũng đi theo quyết định này.

#### Rejected
- Thiếu env làm `GET /topups` trả 500 (Edge, Blind, Auditor, Gap) — low; hợp đồng 3.1 bắt `qrPayload` ở mọi trạng thái, sửa cần đổi hợp đồng; gộp vào mục defer snapshot.
- Gói không có trong `PRICING_CONFIG` làm cả danh sách 500 — low; DB `CHECK` ràng buộc gói nên không lệch.
- `qrPayload` vẫn trả cho đơn đã đóng/hết hạn — low; hợp đồng 3.1 yêu cầu bắt buộc ở mọi trạng thái.
- 403 cho đơn người khác so với 404 — false; spec yêu cầu rõ `FORBIDDEN`, UUID ngẫu nhiên không dò được.
- `INTERNAL_ERROR` viết cứng, "ngoài `ApiErrorCode`" — false một phần: `INTERNAL_ERROR` có trong `ApiErrorCode` (`contracts/src/tasks.ts:38`); phần còn lại chỉ là thẩm mỹ, low.
- P2002 so khớp chuỗi `topups_code_key` và hết 5 lần retry thành 500 — low; không gian 32^8, đã có test va chạm.
- Không validate chữ số BIN/số tài khoản, `tlv()` ném `Error` — low; chỉ xảy ra khi env sai, ngoài AC.
- FK `NOT VALID` không `VALIDATE`; thiếu CHECK status↔trường; thiếu index `(status, qr_expires_at)` — low; theo mẫu migration `tasks`, ngoài AC.
- Throttle theo IP/NAT, thiếu idempotency, consent timestamp/IP — low; spec chỉ định theo mẫu `ShareThrottlerGuard`, intent chỉ yêu cầu lưu `tos_version`.
- Regex UUID chỉ v1–5; lỗi `consent` che lỗi `pack` — low; id sinh bởi DB, không ảnh hưởng dữ liệu.
- Fixture cố định 1000, test patch `crypto.randomInt`, test throttle xóa `throttle:*` — low; chỉ test, `--test-concurrency=1`.

## Verification

**Commands:**
- `pnpm --filter @motion-ai/api test` -- expected: pass (cần PostgreSQL/Redis qua `deploy/compose.yml`)
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: pass
- `pnpm run check:boundaries` -- expected: pass
