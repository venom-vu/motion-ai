# `@flowvis/contracts`

Gói hợp đồng dùng chung (Shared Contracts) giữa Backend (`@flowvis/api`) và Frontend (`@flowvis/web`) trong monorepo flowvis.

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

### 5. Tải lên, Task và kết quả (Epic 2: `src/uploads.ts`, `src/tasks.ts`)

- Quy tắc ảnh dùng chung FE/BE: `ImageFileDeclarationSchema` (loại + dung lượng khai báo, dùng cho `POST /uploads`), `ImageMetaSchema` (thêm `width`/`height`: JPG/PNG/WebP, tối đa 10 MB, cạnh ngắn >= 512 px, tỷ lệ 1:2 đến 2:1) và các hằng số giới hạn.
- Endpoint tải lên: `POST /uploads` (`UploadCreateRequestSchema`/`UploadCreateResponseSchema`), `POST /uploads/{key}/confirm` (`UploadConfirm*`; `{key}` là khóa `in-raw/<uuid>/<uuid>`, cần URL-encode khi đặt vào đường dẫn).
- Enum `ReasonCode` (16 mã), `TaskStatus` (6 trạng thái), `TaskSchema` với bất biến trạng thái/`reasonCode`/`queuePosition`/`resultKey`.
- Endpoint Task: `POST /tasks/face-swap` (không nhận credit từ client; ToS chỉ chấp nhận một lần khi đăng nhập), `GET /tasks` (cursor), `GET /tasks/{id}`, `POST /tasks/{id}/cancel`, `GET /tasks/{id}/result` (`sourceUrl` nullable), `POST`/`DELETE /tasks/{id}/share`, `GET /s/{token}` (chỉ params; thành công là chuyển hướng, 404 dùng `ApiError`).
- Thông báo tiếng Việt theo `reasonCode`: `REASON_CODE_MESSAGES_VI`, `getReasonCodeMessageVi(code, pipeline?)` (ghi đè `NO_POSE` cho `body_retouch`/`motion_control`).
- Mã lỗi API mới: `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`.
- Mock: `MOCK_TASKS_BY_STATUS` (6 trạng thái), `MOCK_TASK_LIST_RESPONSE`, `MOCK_UPLOAD_*`, `MOCK_TASK_RESULT_*`, `MOCK_TASK_SHARE_*`.

### 6. Nạp tiền và duyệt đơn (Epic 3: `src/topups.ts`)

- Trạng thái đơn `TopupStatus` (`awaiting_transfer`, `pending`, `approved`, `rejected`, `needs_review`, `expired`), nhãn tiếng Việt `TOPUP_STATUS_LABELS_VI` / `getTopupStatusLabelVi` (`pending` = "Đang chờ duyệt", `needs_review` = "Cần xem xét"). Gói nạp dùng lại `TopupPackId` của `wallet.ts`.
- `TopupSchema` (bất biến: `transferContent` = `NAP <code>`, `approveBy` bắt buộc khi `pending`, `bankRef` chỉ khi `approved`, `rejectReason` khi và chỉ khi `rejected`) và `AdminTopupSchema` (thêm `userId`, `isOverdue`; không có email).
- Endpoint người dùng: `POST /topups` (`pack`, `.strict()` nên không nhận `amountVnd`), `POST /topups/{id}/confirm-transfer`, `GET /topups` (cursor), `GET /topups/{id}`.
- Endpoint Admin: `GET /admin/topups` (lọc `status`, cursor), `POST /admin/topups/{id}/approve`, `approve-expired` (`bankRef`), `reject` (`rejectReason`), `needs-review` (`note`), `return-to-pending` (body rỗng).
- Mã lỗi API mới: `TOPUP_LIMIT`, `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `TOPUP_QR_EXPIRED`.
- Mock: `MOCK_TOPUPS_BY_STATUS`, `MOCK_TOPUP_LIST_RESPONSE`, `MOCK_ADMIN_TOPUPS_BY_STATUS`, `MOCK_ADMIN_TOPUP_LIST_RESPONSE`.

### 7. Body Retouch (Epic 4: `src/tasks.ts`)

- `TASK_PIPELINES` = `face_swap`, `body_retouch`. `IntensitySchema`: số nguyên 1–10, mặc định 5 (`INTENSITY_MIN/MAX/DEFAULT`); nhãn ba vùng qua `INTENSITY_LABEL_ZONES` và `getIntensityLabelVi(n)` (1–3 "Uốn nhẹ dáng", 4–7 "Tự nhiên", 8–10 "Đường cong tối đa"; ngoài khoảng trả `null`).
- Endpoint: `POST /tasks/body-retouch` (`BodyRetouchCreateRequestSchema` `{ imageKey, intensity }` `.strict()`, không nhận `consent`/credit; `BodyRetouchCreateResponseSchema` = `TaskSchema`). Các endpoint đọc, hủy, kết quả, chia sẻ dùng chung với Face Swap.
- `NO_POSE` của `body_retouch`: "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân."
- Mock: `MOCK_BODY_RETOUCH_CREATE_REQUEST`, `MOCK_BODY_RETOUCH_TASKS_BY_STATUS` (6 trạng thái), `MOCK_BODY_RETOUCH_RESULT_RESPONSE` (có `sourceUrl`).

### 8. Motion Control (Epic 5: `src/uploads.ts`, `src/tasks.ts`, `src/wallet.ts`)

- Pipeline `motion_control` nằm trong `TASK_PIPELINES`. `motionPrice(seconds)` = 50 × số giây nguyên (từ chối số không nguyên hoặc <= 0); là nơi duy nhất giữ hằng 50 phía mã nguồn.
- `GET /config/pricing`: `pipelines.motionControlCreditsPerSecond` (50), `pipelines.motionControlMinSeconds` (3, tùy chọn trong schema cho tới khi BE 5.3 trả), Cap theo Tier ở `tiers[].maxVideoSeconds` (5, 10, 15, 20).
- `POST /uploads` nhận thêm video (`video/mp4`, `video/quicktime`, tối đa 100 MB; `UploadCreateRequestSchema` là union ảnh/video). Confirm video trả `UploadConfirmVideoResponseSchema` `{ key, video: VideoMeta }` (`durationSeconds`, `width`, `height`).
- `POST /tasks/motion`: `MotionCreateRequestSchema` `{ characterKey, videoKey, trimStart, trimEnd }` `.strict()` (số nguyên giây, không `consent`/credit); `MotionCreateResponseSchema` = Task kèm `price`.
- `VALIDATION_FAILED` `details.reason` thuộc `VALIDATION_REASONS` (6 giá trị); `ValidationDetailsSchema` bắt buộc `cap` với `TRIM_EXCEEDS_CAP`; thông báo qua `getValidationReasonMessageVi(reason, cap)`.
- `GET /tasks/{id}/result` thêm `mediaType` (`image`|`video`; vắng mặt hiểu là ảnh), `posterUrl` và `durationSeconds` (chỉ video); `sourceUrl` Motion luôn `null`. `GET /s/{token}/info` (`ShareInfoResponseSchema`) và `GET /s/{token}/poster` (chuyển hướng, không body).
- `NO_POSE`/`NO_FACE` riêng cho `motion_control` qua `getReasonCodeMessageVi(code, 'motion_control')`.
- Mock: `MOCK_MOTION_CREATE_REQUEST`, `MOCK_MOTION_TASKS_BY_STATUS` (6 trạng thái), `MOCK_UPLOAD_VIDEO_CONFIRM_RESPONSE`, `MOCK_MOTION_RESULT_RESPONSE`, `MOCK_SHARE_INFO_*`.
