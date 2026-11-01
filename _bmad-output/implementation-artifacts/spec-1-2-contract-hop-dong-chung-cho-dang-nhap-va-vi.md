---
title: 'Story 1.2: [CONTRACT] Hợp đồng chung cho đăng nhập và ví'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
baseline_commit: '3ddd0641af54920de13f319e7256a87e2155fed2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại gói `@motion-ai/contracts` chỉ có mã khung tối thiểu từ Story 1.1, chưa định nghĩa enum `ApiErrorCode`, cấu trúc lỗi chuẩn, hằng số `TOS_VERSION`, cũng như kiểu dữ liệu, schema validate và dữ liệu mock cho các endpoint đăng nhập và ví của Epic 1 (`GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `GET /wallet/ledger`, `GET /config/pricing`), khiến hai luồng Backend và Frontend chưa thể phát triển độc lập trên cùng một hợp đồng.

**Approach:** Bổ sung thư viện schema `zod` (ghim cố định `3.24.4`) vào `packages/contracts`, định nghĩa đầy đủ enum/type/schema request-response cho lỗi API, phiên bản ToS, xác thực Google OAuth + JWT, thông tin người dùng (`/me`), sổ cái credit phân trang (`/wallet/ledger`), cấu hình bảng giá/Tier/Priority/Cap (`/config/pricing`), xuất kèm bộ dữ liệu mock hợp lệ và kiểm thử tự động toàn bộ schema cùng mock data.

## Boundaries & Constraints

**Always:**
- Chỉ sửa đổi các file trong phạm vi `packages/contracts/**` và `pnpm-lock.yaml` ở thư mục gốc để tuân thủ tuyệt đối ranh giới nhánh `contract/*` của `scripts/check-branch-boundaries.mjs`; ghi rõ việc chọn thư viện schema `zod` `3.24.4` kèm ghi chú `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]` vào `packages/contracts/README.md`.
- Xuất enum `ApiErrorCode` gồm đúng 7 mã bắt buộc của Epic 1: `PAUSED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`, kèm kiểu lỗi API `{ code: ApiErrorCode, message: string, details?: Record<string, unknown> }`, schema tương ứng và bảng ánh xạ thông báo tiếng Việt thân thiện.
- Xuất hằng số `TOS_VERSION` dùng chung cho cả Frontend và Backend.
- Định nghĩa đầy đủ kiểu TypeScript và Zod schema cho cả `request` (query/body/params) và `response` của 7 endpoint trong Epic 1: `GET /auth/google` (nhận `tosVersion` và `deviceId`), `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` (`id`, `email`, `role`, `tier`, `balance`, `held`, `tosVersion`), `GET /wallet/ledger` (phân trang, mới nhất trước, loại bút toán `GRANT`, `TOPUP`, `ADJUST`, `HOLD`, `CAPTURED`, `RELEASED` kèm nhãn tiếng Việt `Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`), và `GET /config/pricing` (định mức pipeline, ngưỡng giữ Tier 100 credit, cấu hình 4 Tier `FREE`/`Starter`/`Pro`/`Creator` về giá VNĐ, credit nhận, Cap video 5s/10s/15s/20s, Priority 10/3/2/1 và danh sách gói nạp).
- Xuất dữ liệu mock chuẩn cho `/me`, `/wallet/ledger`, `/config/pricing` (và phản hồi mẫu của auth) khớp 100% với Zod schema tương ứng để luồng Frontend ở Story 1.4, 1.9, 1.10 sử dụng trực tiếp không cần Backend.

**Never:**
- Không sửa bất kỳ file nào trong `apps/api/`, `apps/web/`, `deploy/` hoặc cấu hình gốc ngoài `pnpm-lock.yaml`.
- Không dùng ký hiệu dải phiên bản (`^`, `~`) khi khai báo `zod` trong `packages/contracts/package.json`.
- Không định nghĩa trước các hợp đồng thuộc các epic sau (như tải ảnh lên R2, tạo Task, VietQR topup, hay admin ops) trong story này.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Validate query `GET /auth/google` hợp lệ | `{ tosVersion: TOS_VERSION, deviceId: 'fp_device_12345678' }` | Schema `AuthGoogleQuerySchema` parse thành công | N/A |
| Validate query `GET /auth/google` thiếu hoặc rỗng `tosVersion` / `deviceId` | `{ tosVersion: '', deviceId: '' }` hoặc thiếu trường | Schema `AuthGoogleQuerySchema` trả về `success: false` | Trả lỗi Zod issue trên trường thiếu/rỗng |
| Validate dữ liệu mock `/me`, `/wallet/ledger`, `/config/pricing` | `MOCK_ME_RESPONSE`, `MOCK_WALLET_LEDGER_RESPONSE`, `MOCK_PRICING_CONFIG_RESPONSE` | Parse thành công qua `MeResponseSchema`, `WalletLedgerResponseSchema`, `PricingConfigResponseSchema`; danh sách sổ cái xếp mới nhất trước (`createdAt` giảm dần) | N/A |
| Validate số dư hoặc số tiền giữ âm trong `/me` | `{ ...MOCK_ME_RESPONSE, balance: -1 }` hoặc `{ held: -10 }` | `MeResponseSchema.safeParse` trả về `success: false` | Từ chối số âm theo bất biến AD-2 (`balance >= 0`, `held >= 0`) |
| Validate bút toán sổ cái sai dấu theo loại (AD-2) | `HOLD` có `amount > 0`, `RELEASED`/`GRANT`/`TOPUP` có `amount <= 0`, hoặc `CAPTURED` có `amount !== 0` | `LedgerEntrySchema.safeParse` trả về `success: false` | Cưỡng chế quy tắc dấu của AD-2 ngay tại tầng schema hợp đồng |
| Validate cấu trúc lỗi API chuẩn | `{ code: ApiErrorCode.INSUFFICIENT_CREDIT, message: '...', details: { required: 150, balance: 100 } }` | `ApiErrorSchema.safeParse` trả về `success: true`; mã lỗi lạ ngoài `ApiErrorCode` bị từ chối | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/package.json` -- Khai báo dependency `zod` (`3.24.4`, ghim cố định) cho `@motion-ai/contracts`.
- `packages/contracts/src/errors.ts` -- Định nghĩa enum `ApiErrorCode`, kiểu `ApiError`, `ApiErrorSchema`, bảng thông báo tiếng Việt `API_ERROR_MESSAGES_VI` và hàm `getApiErrorMessageVi(code)`.
- `packages/contracts/src/auth.ts` -- Định nghĩa hằng số `TOS_VERSION`, kiểu `UserRole`, và các schema/type request-response cho `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`.
- `packages/contracts/src/wallet.ts` -- Định nghĩa enum/kiểu `AccountTier` (`FREE`, `Starter`, `Pro`, `Creator`), `TopupPackId` (`starter`, `pro`, `creator`), `LedgerEntryType` (`GRANT`, `TOPUP`, `ADJUST`, `HOLD`, `CAPTURED`, `RELEASED`), nhãn tiếng Việt `LEDGER_ENTRY_LABELS_VI`, `TierSnapshotSchema`, và schema/type request-response cho `GET /me`, `GET /wallet/ledger`, `GET /config/pricing`.
- `packages/contracts/src/mocks.ts` -- Xuất hằng số cấu hình bảng giá chuẩn `DEFAULT_PRICING_CONFIG` và dữ liệu mock cho `/me` (tài khoản mới 500 credit, tài khoản 0 credit, tài khoản trả phí), `/wallet/ledger` (nhiều bút toán xếp mới nhất trước kèm phân trang), `/config/pricing` và phiên đăng nhập.
- `packages/contracts/src/index.ts` -- Giữ lại export `CONTRACTS_PACKAGE_VERSION`, `HealthContract` (để không làm gãy smoke test hiện có) và re-export toàn bộ hợp đồng từ `errors.ts`, `auth.ts`, `wallet.ts`, `mocks.ts`.
- `packages/contracts/README.md` -- Tài liệu hóa gói hợp đồng, các endpoint của Epic 1 và ghi nhận lựa chọn thư viện schema `zod` `3.24.4` kèm `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]`.
- `packages/contracts/test/index.test.mjs` -- Bộ unit test kiểm chứng toàn bộ Acceptance Criteria và các kịch bản trong I/O & Edge-Case Matrix.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/package.json`, `pnpm-lock.yaml` -- Cài đặt `zod@3.24.4` (ghim chính xác phiên bản, không dùng `^`) vào `@motion-ai/contracts` -- Cung cấp thư viện validate schema dùng chung cho FE và BE.
- [x] `packages/contracts/src/errors.ts` -- Định nghĩa enum `ApiErrorCode` (`PAUSED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED`), kiểu `ApiError`, `ApiErrorSchema` và bảng thông báo tiếng Việt `API_ERROR_MESSAGES_VI` -- Thống nhất cấu trúc lỗi `{ code, message, details? }` giữa API và giao diện.
- [x] `packages/contracts/src/auth.ts` -- Định nghĩa `TOS_VERSION`, `UserRoleSchema` (`user`, `admin`), và cặp request/response schema cùng kiểu TypeScript cho `GET /auth/google` (`tosVersion`, `deviceId`), `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout` -- Đáp ứng hợp đồng đăng nhập Google OAuth và cam kết ToS (FR19, AD-12).
- [x] `packages/contracts/src/wallet.ts` -- Định nghĩa `AccountTierSchema`, `TopupPackIdSchema`, `LedgerEntryTypeSchema` kèm quy tắc dấu AD-2 và nhãn tiếng Việt (`Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`), cùng cặp request/response schema cho `GET /me`, `GET /wallet/ledger` (phân trang, mới nhất trước) và `GET /config/pricing` (định mức pipeline, 4 Tier với Cap 5s/10s/15s/20s và Priority 10/3/2/1, các gói nạp) -- Đáp ứng hợp đồng ví, sổ cái và cấu hình giá/Tier (FR9, FR11, AD-2, AD-10, AD-11).
- [x] `packages/contracts/src/mocks.ts`, `packages/contracts/src/index.ts` -- Tạo dữ liệu mock chuẩn cho `/me`, `/wallet/ledger`, `/config/pricing`, auth và re-export toàn bộ qua `src/index.ts` -- Cho phép FE phát triển ở chế độ mock mà không cần chờ BE.
- [x] `packages/contracts/README.md` -- Ghi tài liệu hợp đồng và lựa chọn thư viện schema `zod` `3.24.4` kèm ghi chú `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]` -- Đáp ứng yêu cầu tài liệu hóa của AC4 và giữ thay đổi trong ranh giới `packages/contracts/`.
- [x] `packages/contracts/test/index.test.mjs` -- Viết unit test kiểm tra đầy đủ `ApiErrorCode`, `TOS_VERSION`, schema request/response của 7 endpoint, dữ liệu mock khớp schema, thứ tự thời gian của mock ledger và các trường hợp biên trong I/O Matrix -- Bảo chứng chất lượng hợp đồng khi chạy `pnpm test`.

**Acceptance Criteria:**
- Given `packages/contracts`, when chạy `pnpm run build`, then gói biên dịch thành công và xuất enum `ApiErrorCode` gồm đủ `PAUSED`, `INSUFFICIENT_CREDIT`, `TASK_LIMIT`, `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `RATE_LIMITED` cùng kiểu và schema lỗi API `{ code, message, details? }`.
- Given các endpoint của Epic 1, when import từ `@motion-ai/contracts`, then có đầy đủ kiểu và schema request/response cho `GET /auth/google` (nhận `tosVersion` và `deviceId`), `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` (`id`, `email`, `role`, `tier`, `balance`, `held`, `tosVersion`), `GET /wallet/ledger` (phân trang, mới nhất trước), và `GET /config/pricing` (bảng giá, Cap, Priority, các gói nạp).
- Given hằng số phiên bản cam kết ToS, when FE và BE cùng import `TOS_VERSION` từ `@motion-ai/contracts`, then cả hai nhận cùng một giá trị chuỗi không rỗng.
- Given các schema của hợp đồng, when chạy `pnpm test`, then dữ liệu mock của `/me`, `/wallet/ledger`, `/config/pricing` đều khớp schema, các trường hợp dữ liệu sai quy tắc (số dư âm, sai dấu bút toán, thiếu `tosVersion`/`deviceId`) đều bị từ chối, và `packages/contracts/README.md` ghi nhận thư viện schema kèm `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]`.

## Implementation Notes

- Đã cài đặt `zod@3.24.4` (ghim cố định, không dùng `^`) vào `@motion-ai/contracts`.
- Đã triển khai `errors.ts`, `auth.ts`, `wallet.ts`, `mocks.ts`, cập nhật `index.ts`, tài liệu hóa trong `packages/contracts/README.md` kèm `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]` và bổ sung bộ kiểm thử đầy đủ trong `packages/contracts/test/index.test.mjs`.

## Spec Change Log

## Review Triage Log

- `[blind-hunter #1]` (`_bmad-output/implementation-artifacts/*`) — `false`: Các file trong `_bmad-output/implementation-artifacts/` là artifact quản lý tiến độ của quy trình BMad trên nhánh `main` (nơi `pnpm run check:boundaries` trả về exit code 0); toàn bộ mã nguồn của Story 1.2 chỉ chạm vào `packages/contracts/**` và `pnpm-lock.yaml`.
- `[blind-hunter #2]` (`packages/contracts/src/wallet.ts:125-187`, `packages/contracts/src/mocks.ts:141-218`) — `medium` (`patch`): Theo `ARCHITECTURE-SPINE.md` (sơ đồ ER `ledger_entries`) và Story 1.6 AC1/AC5, bút toán sổ cái có trường `pack` (`TopupPackId | null`, chỉ khác `null` khi `type === 'TOPUP'`); cần bổ sung `pack` và ràng buộc tương ứng vào `LedgerEntrySchema` cùng `MOCK_WALLET_LEDGER_ITEMS`.
- `[blind-hunter #3 / edge-case-hunter #3]` (`packages/contracts/src/wallet.ts:125-187`) — `medium` (`patch`): Theo AD-2 và AD-16, bút toán `HOLD`, `CAPTURED`, `RELEASED` bắt buộc có `taskId` (và `topupId = null`), `TOPUP` bắt buộc có `topupId` (và `taskId = null`), còn `GRANT` và `ADJUST` có cả `taskId` lẫn `topupId` bằng `null`; cần kiểm tra trong `LedgerEntrySchema.superRefine`.
- `[blind-hunter #4 / edge-case-hunter #4]` (`packages/contracts/src/mocks.ts:127-218`) — `medium` (`patch`): Trong `mocks.ts`, `MOCK_ME_PRO_RESPONSE` (`usr_mock_pro_03`) khai báo `balance: 11750, held: 250` nhưng tổng `amount` của `MOCK_WALLET_LEDGER_ITEMS` là `12300` và không có lệnh `HOLD` nào đang mở; cần thêm một bút toán `HOLD` `-250` đang mở và đồng bộ `balance: 12050, held: 250` để thỏa mãn bất biến AD-2 (`balance = SUM(amount)`).
- `[blind-hunter #5]` (`packages/contracts/src/wallet.ts:107-136`, `packages/contracts/src/mocks.ts:101-218`) — `medium` (`patch`): Mục `Consistency Conventions` của `ARCHITECTURE-SPINE.md` quy định `id là UUID`; cần dùng `.uuid()` cho `id`, `userId`, `taskId`, `topupId` trong `MeResponseSchema` và `LedgerEntrySchema` đồng thời cập nhật các ID trong `mocks.ts` sang UUID hợp lệ.
- `[blind-hunter #6 / edge-case-hunter #1]` (`packages/contracts/src/wallet.ts:84-98, 237-265`) — `medium` (`patch`): `TierSnapshotSchema`, `TierConfigSchema` và `TopupPackConfigSchema` đang dùng `z.union` rời rạc cho `tier`, `priority`, `maxVideoSeconds`, cho phép ghép cặp sai quy tắc AD-10/AD-11 (ví dụ `FREE` với `priority: 1, maxVideoSeconds: 20`); cần khóa chặt bộ thông số theo từng `tier`.
- `[blind-hunter #7 / edge-case-hunter #2]` (`packages/contracts/src/wallet.ts:271-278`) — `low` (`patch`): `PricingConfigResponseSchema` chỉ kiểm tra `.length(4)` cho `tiers` và `.length(3)` cho `topupPacks`, chưa chặn trường hợp trùng lặp hạng hoặc gói nạp; cần bổ sung kiểm tra đủ 4 hạng và 3 gói nạp duy nhất.
- `[blind-hunter #8]` (`packages/contracts/src/wallet.ts:192-196`) — `low` (rejected): `z.coerce.number().int().min(1)` là cách chuẩn cho query string HTTP; việc viết thêm bộ tiền xử lý nhánh cho kiểu boolean trong JS làm tăng độ phức tạp không cần thiết cho tình huống hiếm gặp.
- `[blind-hunter #9]` (`packages/contracts/src/wallet.ts:107-115`) — `false`: AC2 của Story 1.2 và AC8 của Story 1.7 quy định rõ `GET /me` trả `(id, email, role, tier, balance, held, tosVersion)`; cột `tier_pack` trong DB chỉ là trạng thái nội bộ của module `wallet` để tính lại `tier`.
- `[blind-hunter #10]` (`packages/contracts/src/errors.ts:53-58`, `packages/contracts/test/index.test.mjs:62-97`) — `low` (`patch`): Mở rộng kiểu tham số của `getApiErrorMessageVi` thành `ApiErrorCode | (string & {}) | null | undefined` để FE truyền mã lỗi bất kỳ từ runtime và bổ sung unit test kiểm tra nhánh fallback mã lỗi lạ.
- `[verification-gap #1]` (`packages/contracts/src/wallet.ts:137-144`, `packages/contracts/test/index.test.mjs:226-279`) — `medium` (`patch`): Bổ sung assertion trong `packages/contracts/test/index.test.mjs` kiểm tra `LedgerEntrySchema.safeParse` từ chối bút toán có `amount` hợp lệ nhưng `labelVi` lệch với `type`.
- `[verification-gap #2]` (`packages/contracts/src/wallet.ts:175-184`, `packages/contracts/test/index.test.mjs:271-279`) — `medium` (`patch`): Bổ sung assertion trong `packages/contracts/test/index.test.mjs` kiểm tra `LedgerEntrySchema.safeParse` chấp nhận bút toán `ADJUST` mang số âm (`amount: -50`) theo quy tắc `ADJUST ±n` của AD-2.

## Verification

**Commands:**
- `pnpm run check:boundaries -- --branch contract/1-2-auth-wallet` -- expected: exit code 0, mọi file thay đổi đều nằm trong `packages/contracts/` hoặc `pnpm-lock.yaml`
- `pnpm run lint` -- expected: exit code 0 trên toàn monorepo
- `pnpm run typecheck` -- expected: exit code 0 trên cả 3 gói (`@motion-ai/contracts`, `@motion-ai/api`, `@motion-ai/web`)
- `pnpm run build` -- expected: exit code 0 trên cả 3 gói
- `pnpm test` -- expected: exit code 0, toàn bộ unit test của `@motion-ai/contracts`, `@motion-ai/api`, `@motion-ai/web` và `check-branch-boundaries` đều pass


### Review Findings

- [x] [Review][Decision] (đã chọn A: bắt buộc `state` + nhánh callback lỗi) OAuth callback: `state` tùy chọn và không có dạng callback lỗi (`error=access_denied`) — `state` là thứ duy nhất ràng buộc callback với lượt đăng nhập (chống CSRF); user bấm Hủy ở màn Google hiện không có shape hợp lệ [packages/contracts/src/auth.ts:33] (blind-hunter+edge-case-hunter+verification-gap, medium)
- [x] [Review][Decision] (đã chọn A: cursor là chuẩn, bỏ `page`/`total`, `hasMore` ⇔ `nextCursor`, tiebreak `id`) Phân trang sổ cái mơ hồ: query nhận cả `page` lẫn `cursor`, response trả cả `page/total` lẫn `nextCursor`; không kiểm tra `hasMore` khớp `nextCursor`/`total`, `items.length <= pageSize`, và so sánh thứ tự chỉ theo `createdAt` (HOLD/RELEASED cùng giao dịch bị lệch) [packages/contracts/src/wallet.ts:329-360] (blind-hunter+edge-case-hunter+verification-gap, medium)
- [x] [Review][Patch] Bổ sung test âm tính còn thiếu: `TopupPackConfigSchema`/`TierConfigSchema` (sai `priceVnd`, `credits`, `id`, `packId`, `priority`, `maxVideoSeconds`), mặc định/giới hạn `WalletLedgerQuerySchema` (`{}`, `page:0`, `pageSize:0`, `pageSize:101`), quy tắc liên kết `taskId/topupId/pack` của `LedgerEntrySchema` [packages/contracts/test/index.test.mjs] (verification-gap, medium)
- [x] [Review][Defer] Hình dạng luồng `GET /auth/google` + callback (trả JSON thay vì 302 redirect), cookie refresh token (tên, SameSite, Path, CSRF cho `/auth/refresh`, `/auth/logout`) chỉ nằm trong comment — deferred: chưa xác minh; cần đối chiếu ARCHITECTURE-SPINE trước khi Story đăng nhập phía BE/FE bắt đầu (mức tối đa nếu đúng: medium)

#### Rejected

- `false` — Mock `/me` mặc định lệch ledger: `MOCK_ME_PRO_RESPONSE` đã khớp ledger (tổng 12050, held 250) và được ghi rõ trong comment; `MOCK_ME_RESPONSE` là tài khoản FREE riêng.
- `false` — Phạm vi file ngoài `packages/contracts/`: commit nằm trên `main`; `check-branch-boundaries.mjs` chỉ giới hạn nhánh `contract/*`, nhánh khác không bị hạn chế.
- `false` — Spec `done` vs sprint-status `review`: sẽ được đồng bộ ở bước cập nhật trạng thái của review này.
- `low` — `datetime()` không nhận offset `+07:00`, `.safe()` cho số nguyên: backend phát `Z`, giá trị credit nhỏ; sửa thêm guard, không đáng.
- `low` — `z.literal` giá/credit cứng: chủ đích, thay đổi giá phải đổi contract; tiers/packs đối chiếu qua `TIER_SPECS`.
- `low` — `tosVersion` không so với `TOS_VERSION`, `deviceId` không giới hạn độ dài: kiểm tra phiên bản là việc của backend; thêm giới hạn là thêm ràng buộc chưa có yêu cầu.
- Bỏ qua (sửa phải đổi spec) — Thêm mã lỗi auth (401/403, token hết hạn): spec đóng đúng 7 mã `ApiErrorCode`.
- `low` — `ApiError` viết tay thay vì `z.infer`, alias thừa, mocks export từ `index.ts`, refresh body `null`, README thiếu chi tiết: không gây hại cụ thể ở hiện tại.
