---
title: 'Story 1.5: [BE] Đăng nhập Google và phiên JWT'
type: 'feature'
created: '2026-11-02'
status: 'done'
route: 'dispatch'
baseline_commit: '63b332b11bc634e2b2fcda0ac1c34976fefb6188'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Gói `@motion-ai/api` mới chỉ có hạ tầng khung (Prisma, PostgreSQL, Redis, BullMQ) từ Story 1.3; chưa có bảng `users`, chưa có bảng `refresh_tokens`, và chưa có module xử lý đăng nhập Google OAuth, quản lý phiên JWT (access token 15 phút, refresh token lưu hash trong DB xoay vòng qua cookie httpOnly), phân quyền `admin`/`user`, xử lý tài khoản bị khóa `ACCOUNT_LOCKED` và kiểm soát CORS.

**Approach:** Cài đặt các thư viện xác thực `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `cookie-parser`; tạo migration Prisma cho 2 bảng `users` (không có cột số dư) và `refresh_tokens`; hiện thực `AuthModule` cung cấp các endpoint `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout` với hợp đồng chuẩn từ `@motion-ai/contracts`; hỗ trợ cấp quyền `admin` tự động dựa trên `ADMIN_EMAILS`, bảo vệ route bằng JWT guard & Roles guard, chặn tài khoản có `locked_at` và siết chặt CORS theo `FRONTEND_URL`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa file trong `apps/api/**`, `deploy/**` và `pnpm-lock.yaml` ở thư mục gốc để tuân thủ ranh giới nhánh `be/*`.
- Ghim cố định phiên bản (không dùng `^`, `~`) cho mọi dependency mới trong `apps/api/package.json` (`@nestjs/jwt@12.0.3`, `@nestjs/passport@12.0.0`, `passport@0.7.0`, `passport-jwt@4.0.1`, `cookie-parser@1.4.7`, `@types/cookie-parser@1.4.8`, `@types/passport-jwt@4.0.1`).
- Migration chỉ tạo bảng `users` (id UUID, google_id, email, role, tos_version, tos_accepted_at, locked_at, created_at, updated_at) và `refresh_tokens` (id UUID, user_id, token_hash, revoked_at, expires_at, created_at); tuyệt đối không thêm cột số dư/ví (`balance`, `held`, `tier`) ở story này.
- Refresh token chỉ lưu bản băm SHA-256 (`token_hash`) trong bảng `refresh_tokens`, gửi về client qua cookie `httpOnly`, `Secure`, `SameSite=Lax`, path `/`.
- Access JWT sống 15 phút (900 giây), payload chứa `sub` (user UUID), `email`, `role`.
- Bắt buộc kiểm tra `tosVersion === '2026-11-01'`: nếu thiếu hoặc không khớp, từ chối với HTTP 400 và mã lỗi `CONSENT_REQUIRED` (`ApiErrorCode.CONSENT_REQUIRED`), không tạo bản ghi user.
- Phân quyền: kiểm tra `email` với danh sách `ADMIN_EMAILS` (phân tách bởi dấu phẩy, không phân biệt hoa thường). Nếu khớp, gán role `admin`, ngược lại gán `user`. Route admin trả 403 Forbidden đối với người dùng role `user`.
- Kiểm tra tài khoản khóa: nếu `users.locked_at` khác rỗng (`locked_at !== null`), khi gọi route ghi hoặc `POST /auth/refresh` thì trả về HTTP 403 kèm mã lỗi `ACCOUNT_LOCKED`.
- Cấu hình CORS chặt chẽ: chỉ cho phép origin từ `FRONTEND_URL` (hỗ trợ `credentials: true`), từ chối các domain lạ.
- Kiểm thử: toàn bộ tương tác Google OAuth được giả lập ở ranh giới HTTP trong bộ test tự động (không gọi ra ngoài internet).

**Never:**
- Không sửa bất kỳ file nào ngoài `apps/api/**`, `deploy/**` và `pnpm-lock.yaml`.
- Không lưu refresh token dạng văn bản thô (plain text) trong cơ sở dữ liệu.
- Không thêm các bảng hay cột liên quan đến sổ cái credit (`ledger_entries`) hay số dư ví trong story này.
- Không mở CORS wildcard (`*`) hoặc cho phép origin lạ truy cập API xác thực.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đăng nhập Google thành công (User mới) | `tosVersion='2026-11-01'`, `deviceId='fp_01'`, code Google hợp lệ | Tạo user role `user`, trả HTTP 200 `{ accessToken, tokenType: 'Bearer', expiresIn: 900, isNewUser: true }`, set cookie `httpOnly` refresh token | N/A |
| Đăng nhập Google với email Admin | Email trong `ADMIN_EMAILS`, `tosVersion='2026-11-01'` | Tạo user role `admin`, trả access JWT có `role='admin'` | N/A |
| Đăng nhập với ToS không hợp lệ | `tosVersion='old-version'` hoặc thiếu `tosVersion` | Trả HTTP 400 `{ code: 'CONSENT_REQUIRED', message: '...' }`, không tạo user | `CONSENT_REQUIRED` |
| Google OAuth callback trả lỗi | Google callback có `error='access_denied'` | Trả HTTP 400 kèm thông tin lỗi, không cấp token | Trả 400 BadRequest |
| User cũ đăng nhập lại | User đã tồn tại trong DB, `locked_at = null` | Trả HTTP 200 `{ accessToken, expiresIn: 900, isNewUser: false }`, cấp refresh token mới | N/A |
| User bị khóa đăng nhập hoặc refresh | User có `locked_at !== null` | Trả HTTP 403 `{ code: 'ACCOUNT_LOCKED', message: '...' }`, không cấp phiên | `ACCOUNT_LOCKED` |
| Làm mới phiên thành công (`POST /auth/refresh`) | Cookie refresh token hợp lệ, chưa thu hồi, chưa hết hạn | Thu hồi token cũ (`revoked_at = now()`), tạo token mới trong cookie, trả access JWT mới | N/A |
| Dùng lại refresh token đã thu hồi | Cookie chứa refresh token đã có `revoked_at !== null` | Trả HTTP 401 Unauthorized, không cấp token mới | 401 Unauthorized |
| Làm mới phiên với token hết hạn hoặc sai | Cookie không có token hoặc token không tồn tại trong DB | Trả HTTP 401 Unauthorized | 401 Unauthorized |
| Đăng xuất (`POST /auth/logout`) | Cookie refresh token hợp lệ | Cập nhật `revoked_at = now()`, xóa cookie, trả HTTP 200 `{ success: true }` | N/A |
| Truy cập route Admin với role `user` | Bearer token của user role `user` gọi route `@Roles('admin')` | Trả HTTP 403 Forbidden | 403 Forbidden |
| Gọi API từ domain khác FE | Header `Origin: https://malicious-site.com` | Trả lỗi CORS hoặc không có CORS header cho origin đó | CORS blocked |

</frozen-after-approval>

## Code Map

- `apps/api/package.json` & `pnpm-lock.yaml` -- Khai báo các thư viện xác thực `@nestjs/jwt@12.0.3`, `@nestjs/passport@12.0.0`, `passport@0.7.0`, `passport-jwt@4.0.1`, `cookie-parser@1.4.7`, `@types/cookie-parser@1.4.8`, `@types/passport-jwt@4.0.1`.
- `apps/api/prisma/schema.prisma` & `apps/api/prisma/migrations/20261102000000_auth_users_and_refresh_tokens/migration.sql` -- Định nghĩa và sinh migration cho bảng `users` và `refresh_tokens`.
- `apps/api/src/modules/auth/google-oauth.service.ts` -- Dịch vụ bọc HTTP adapter trao đổi OAuth code lấy user profile Google (hỗ trợ fake/mock ranh giới HTTP trong test).
- `apps/api/src/modules/auth/auth.service.ts` -- Nghiệp vụ đăng nhập, đăng ký user, kiểm tra ToS, gán role admin, sinh hash refresh token, xoay vòng token và kiểm tra `locked_at`.
- `apps/api/src/modules/auth/jwt.strategy.ts` & `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` -- Passport JWT Strategy trích xuất Bearer token từ header và gắn `req.user`.
- `apps/api/src/modules/auth/guards/roles.guard.ts` & `apps/api/src/modules/auth/decorators/roles.decorator.ts` -- Guard kiểm tra quyền `admin` trên route được đánh dấu.
- `apps/api/src/modules/auth/guards/account-locked.guard.ts` -- Guard chặn người dùng có `locked_at !== null` với mã lỗi `ACCOUNT_LOCKED`.
- `apps/api/src/modules/auth/auth.controller.ts` -- Controller cung cấp các endpoint `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout` và route kiểm thử admin.
- `apps/api/src/modules/auth/auth.module.ts` & `apps/api/src/modules/auth/index.ts` -- Đóng gói và export `AuthModule` cho `AppModule`.
- `apps/api/src/main.ts` -- Tích hợp `cookie-parser`, cấu hình CORS hạn chế theo `FRONTEND_URL` với `credentials: true`.
- `apps/api/.env.example` & `deploy/.env.example` -- Bổ sung các biến môi trường cấu hình xác thực (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`, `ADMIN_EMAILS`).
- `apps/api/test/auth.test.mjs` -- Bộ test kiểm thử toàn diện luồng Google OAuth, JWT, refresh rotation, revocation, locked account, admin roles và CORS.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json`, `pnpm-lock.yaml` -- Cài đặt và ghim phiên bản `@nestjs/jwt@12.0.3`, `@nestjs/passport@12.0.0`, `passport@0.7.0`, `passport-jwt@4.0.1`, `cookie-parser@1.4.7`, `@types/cookie-parser@1.4.8`, `@types/passport-jwt@4.0.1` -- Hạ tầng thư viện xác thực.
- [x] `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261102000000_auth_users_and_refresh_tokens/migration.sql` -- Định nghĩa model `User` và `RefreshToken`, chạy migration tạo bảng trên PostgreSQL 16 -- Đáp ứng lưu trữ người dùng và phiên đăng nhập.
- [x] `apps/api/src/modules/auth/google-oauth.service.ts`, `apps/api/src/modules/auth/auth.service.ts` -- Xây dựng logic xác thực Google, tạo state chống CSRF, kiểm tra `TOS_VERSION`, gán role `admin` theo `ADMIN_EMAILS`, băm SHA-256 refresh token và kiểm tra `locked_at` -- Đáp ứng AC1, AC2, AC3, AC4, AC5, AC6.
- [x] `apps/api/src/modules/auth/jwt.strategy.ts`, `apps/api/src/modules/auth/guards/` -- Hiện thực JwtStrategy, JwtAuthGuard, RolesGuard và AccountLockedGuard -- Đảm bảo bảo vệ route và phân quyền API.
- [x] `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.module.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts` -- Khai báo các endpoint auth, tích hợp middleware cookie-parser, cấu hình CORS siết chặt miền FE -- Đáp ứng AC7.
- [x] `apps/api/.env.example`, `deploy/.env.example` -- Bổ sung tài liệu biến môi trường auth không chứa bí mật -- Đảm bảo môi trường triển khai nhất quán.
- [x] `apps/api/test/auth.test.mjs` -- Viết bộ unit/integration test phủ toàn bộ I/O Matrix và 8 Acceptance Criteria với Google được giả lập ở ranh giới HTTP -- Bảo chứng chất lượng.

**Acceptance Criteria:**
- Given một người dùng mới và `tosVersion` hợp lệ ('2026-11-01'), when hoàn tất OAuth Google, then tạo bản ghi `users` (khóa Google, email, role `user`, `tos_version`, `tos_accepted_at`), trả access JWT sống 15 phút và refresh token trong cookie `httpOnly`, `Secure`, `SameSite=Lax`, và refresh token chỉ lưu hash trong bảng `refresh_tokens`.
- Given người dùng mới nhưng thiếu hoặc sai `tosVersion`, when hoàn tất OAuth, then nhận lỗi HTTP 400 `CONSENT_REQUIRED` và không tạo tài khoản trong cơ sở dữ liệu.
- Given một refresh token hợp lệ, when gọi `POST /auth/refresh`, then nhận access JWT mới và refresh token mới, refresh token cũ bị thu hồi (`revoked_at`), và dùng lại refresh token đã thu hồi bị từ chối với HTTP 401.
- Given người dùng đang đăng nhập, when gọi `POST /auth/logout`, then refresh token hiện tại bị thu hồi và xóa cookie phiên.
- Given email người dùng nằm trong `ADMIN_EMAILS`, when tài khoản được tạo, then role là `admin`, và route dành cho admin trả HTTP 403 với người dùng role `user`.
- Given `users.locked_at` khác rỗng, when gọi route ghi hoặc `POST /auth/refresh`, then nhận HTTP 403 `ACCOUNT_LOCKED`.
- Given yêu cầu từ miền khác miền FE, when gọi API, then CORS chỉ cho phép miền FE và từ chối origin lạ.
- Given story này, when xem migration, then chỉ tạo bảng `users` (không có số dư) và `refresh_tokens`, và test chạy với Google được giả ở ranh giới HTTP.

## Implementation Notes

- Đã cài đặt và ghim chính xác phiên bản cho các thư viện xác thực: `@nestjs/jwt@12.0.3`, `@nestjs/passport@12.0.0`, `passport@0.7.0`, `passport-jwt@4.0.1`, `cookie-parser@1.4.7`, `@types/cookie-parser@1.4.8`, `@types/passport-jwt@4.0.1`.
- Đã tạo migration `20261102000000_auth_users_and_refresh_tokens` và áp dụng trên PostgreSQL 16: chỉ có 2 bảng `users` và `refresh_tokens`, bảo toàn bất biến kiến trúc là chưa có các cột ví/credit (`balance`, `held`, `tier`).
- `GoogleOAuthService` cung cấp lớp bọc HTTP adapter, hỗ trợ `setFetchImpl()` cho phép mock giả lập toàn bộ luồng OAuth 2.0 tại ranh giới HTTP trong bộ test tự động.
- `AuthService` hiện thực:
  - Sinh/xác thực state HMAC-SHA256 có TTL 10 phút và xóa nonce trong Redis sau khi dùng.
  - Kiểm tra bắt buộc `tosVersion === '2026-11-01'`, trả 400 `CONSENT_REQUIRED` nếu không khớp.
  - Phân quyền admin qua `ADMIN_EMAILS` (case-insensitive).
  - Sinh access JWT 15 phút (900s) và refresh token ngẫu nhiên gửi qua cookie `httpOnly`, `Secure`, `SameSite=Lax`. Trong CSDL chỉ lưu bản băm SHA-256 (`token_hash`).
  - Xoay vòng (rotate) refresh token khi làm mới phiên và kiểm tra `locked_at` với mã lỗi `ACCOUNT_LOCKED`.
  - Thu hồi token khi logout và xóa cookie.
- Cấu hình CORS siết chặt theo `FRONTEND_URL` với `credentials: true`.
- Viết 17 ca test tự động trong `apps/api/test/auth.test.mjs` bảo chứng toàn bộ AC và ma trận I/O.

## Spec Change Log

## Review Triage Log

- **Edge Case Hunter:**
  - *Finding 1 (Xung đột googleId/email):* Đã siết chặt kiểm tra googleId khi tra cứu user qua email; chặn ghi đè tài khoản không chính chủ. -> `patch`
  - *Finding 2 (Race condition xoay vòng refresh token):* Sử dụng CAS atomic `updateMany` với `revokedAt: null` để ngăn chặn replay song song. -> `patch`
  - *Finding 3 (Thiếu options khi clearCookie):* Bổ sung đầy đủ thuộc tính `httpOnly`, `secure`, `sameSite`, `path` khi logout/xóa cookie. -> `patch`
  - *Finding 4 (Kiểm tra UUID sub):* Bổ sung bắt ngoại lệ nếu sub JWT không hợp lệ trong guard. -> `patch`
  - *Finding 5 (Kiểm tra kết quả xóa Redis state):* Kiểm tra `deletedCount > 0` từ `redis.del` để bảo đảm state nonce dùng một lần tuyệt đối. -> `patch`

- **Verification Gap:**
  - *Gap 1 (Test hết hạn refresh token):* Bổ sung test tự động xác nhận token hết hạn trả về HTTP 401. -> `patch`
  - *Gap 2 (Test ToS version không khớp trong callback):* Bổ sung test tự động xác nhận trả HTTP 400 `CONSENT_REQUIRED`. -> `patch`

- **Blind Hunter:**
  - *Finding 1 (Tài liệu COOKIE_SECURE):* Khai báo cấu hình `COOKIE_SECURE` trong `.env.example`. -> `patch`
  - *Finding 2 (Đồng bộ admin & ToS cho user cũ):* Tự động đồng bộ role `admin` theo `ADMIN_EMAILS` và cập nhật bản `tos_version` mới khi đăng nhập. -> `patch`
  - *Finding 3 (Timeout fetch Google):* Bổ sung `AbortSignal.timeout(10000)` khi gọi API Google token & userinfo. -> `patch`
  - *Finding 4 (Ràng buộc CHECK SQL):* Thêm constraint `users_role_valid_chk` (`role IN ('user', 'admin')`) trong migration SQL. -> `patch`
  - *Finding 5 (Kiểm tra user tồn tại trong AccountLockedGuard):* Ném lỗi `UnauthorizedException` nếu không tìm thấy bản ghi user trong DB. -> `patch`

## Verification

**Commands:**
- `pnpm run check:boundaries -- --branch be/1-5-auth-google-jwt` -- expected: exit code 0, chỉ sửa `apps/api/**`, `deploy/**`, và `pnpm-lock.yaml`
- `pnpm run lint` -- expected: exit code 0 trên toàn monorepo
- `pnpm run typecheck` -- expected: exit code 0 trên cả 3 gói
- `pnpm run build` -- expected: exit code 0 trên toàn bộ monorepo
- `pnpm --filter @motion-ai/api test` -- expected: exit code 0 cho toàn bộ test hạ tầng và auth
- `pnpm test` -- expected: exit code 0 cho toàn bộ test suite của monorepo

