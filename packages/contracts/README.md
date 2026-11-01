# `@motion-ai/contracts`

Gói hợp đồng dùng chung (Shared Contracts) giữa Backend (`@motion-ai/api`) và Frontend (`@motion-ai/web`) trong monorepo Motion AI.

## Thư viện Schema & Phiên bản

- **Thư viện schema:** `zod` phiên bản `3.24.4` (ghim cố định trong `packages/contracts/package.json`).
- **Ghi chú kiến trúc:** `[ASSUMPTION: ARCHITECTURE-SPINE chưa ghim thư viện schema]` — Chọn `zod` `3.24.4` làm thư viện định nghĩa và kiểm tra schema tại runtime cho cả Frontend (Nuxt 4) và Backend (NestJS 12 ESM) vì hỗ trợ suy diễn kiểu TypeScript (`z.infer`) trực tiếp từ một nguồn sự thật duy nhất và không phụ thuộc decorator hay reflection runtime.

## Nội dung Hợp đồng (Epic 1: Đăng nhập & Ví Credit)

### 1. Mã lỗi chuẩn (`src/errors.ts`)

- Enum `ApiErrorCode`:
  - `PAUSED`
  - `INSUFFICIENT_CREDIT`
  - `TASK_LIMIT`
  - `ACCOUNT_LOCKED`
  - `CONSENT_REQUIRED`
  - `VALIDATION_FAILED`
  - `RATE_LIMITED`
- Cấu trúc lỗi chuẩn `ApiError` & `ApiErrorSchema`: `{ code: ApiErrorCode, message: string, details?: Record<string, unknown> }`.
- Bảng ánh xạ thông báo tiếng Việt thân thiện `API_ERROR_MESSAGES_VI` và hàm `getApiErrorMessageVi(code)`.

### 2. Xác thực & Điều khoản dịch vụ (`src/auth.ts`)

- Hằng số phiên bản cam kết điều khoản dịch vụ `TOS_VERSION`.
- Schema & kiểu dữ liệu cho các endpoint xác thực:
  - `GET /auth/google`: `AuthGoogleQuerySchema` (`tosVersion`, `deviceId`), `AuthGoogleResponseSchema`.
  - `GET /auth/google/callback`: `AuthGoogleCallbackQuerySchema` (union: `{code,state}` hoặc `{error,state}` khi user Hủy; `state` luôn bắt buộc), `AuthGoogleCallbackResponseSchema`.
  - `POST /auth/refresh`: `AuthRefreshRequestSchema`, `AuthRefreshResponseSchema`.
  - `POST /auth/logout`: `AuthLogoutRequestSchema`, `AuthLogoutResponseSchema`.

### 3. Ví Credit, Sổ cái & Bảng giá (`src/wallet.ts`)

- Hạng tài khoản `AccountTier` (`FREE`, `Starter`, `Pro`, `Creator`), mã gói nạp `TopupPackId` (`starter`, `pro`, `creator`) và `TierSnapshotSchema`.
- Loại bút toán sổ cái `LedgerEntryType` (`GRANT`, `TOPUP`, `ADJUST`, `HOLD`, `CAPTURED`, `RELEASED`) kèm nhãn tiếng Việt `LEDGER_ENTRY_LABELS_VI` (`Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`) và kiểm tra quy tắc dấu bất biến theo AD-2.
- Schema & kiểu dữ liệu cho các endpoint ví và cấu hình:
  - `GET /me`: `MeRequestSchema`, `MeResponseSchema` (`id`, `email`, `role`, `tier`, `balance`, `held`, `tosVersion`).
  - `GET /wallet/ledger`: `WalletLedgerQuerySchema`, `WalletLedgerResponseSchema` (phân trang theo cursor; mới nhất trước: `createdAt` giảm dần, cùng `createdAt` thì `id` giảm dần; `hasMore` ⇔ `nextCursor` khác null).
  - `GET /config/pricing`: `PricingConfigRequestSchema`, `PricingConfigResponseSchema` (định mức credit theo pipeline, ngưỡng giữ Tier 100 credit, cấu hình 4 Tier và 3 gói nạp).

### 4. Dữ liệu Mock (`src/mocks.ts`)

- Cung cấp `DEFAULT_PRICING_CONFIG`, `MOCK_PRICING_CONFIG_RESPONSE`, `MOCK_ME_RESPONSE`, `MOCK_ME_ZERO_BALANCE_RESPONSE`, `MOCK_ME_PRO_RESPONSE`, `MOCK_WALLET_LEDGER_ITEMS`, `MOCK_WALLET_LEDGER_RESPONSE` và các phản hồi mock cho luồng đăng nhập để Frontend phát triển độc lập ở chế độ mock.
