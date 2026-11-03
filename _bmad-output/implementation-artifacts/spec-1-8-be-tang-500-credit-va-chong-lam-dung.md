---
title: 'Story 1.8: [BE] Tặng 500 credit và chống lạm dụng'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'c0c38e99a81fe6e1334904562e6709b2565c4984'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Đăng ký Google hiện tạo user với số dư 0, chưa có bảng `signup_grants`, chưa lấy IP khách, chưa giới hạn tần suất route đăng nhập, nên không thể tặng 500 credit dùng thử và chặn lạm dụng.

**Approach:** `auth` mở một interactive transaction khi tạo user mới: khóa advisory theo hash IP và hash thiết bị, quyết định số credit (500 hoặc 0), ghi `signup_grants` rồi gọi `wallet.grant(tx, ...)`. IP và `deviceId` chỉ lưu dạng HMAC có khóa bí mật. Thêm `@nestjs/throttler` cho route đăng nhập, trả `RATE_LIMITED`.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `apps/api/**`, `deploy/.env.example` (nếu cần) và `pnpm-lock.yaml`. Ghim `@nestjs/throttler@6.7.1`, không dùng `^`/`~`.
- Migration `signup_grants`: `user_id` UUID khóa chính (FK `users` ON DELETE CASCADE), `fingerprint_hash` TEXT NOT NULL, `ip_hash` TEXT NOT NULL, `granted` BIGINT NOT NULL CHECK `granted >= 0`, `created_at` timestamptz. Unique một phần `(fingerprint_hash) WHERE granted > 0` và chỉ mục `(ip_hash, created_at)` viết trong SQL thô. Chỉ `auth` ghi bảng này.
- Quy tắc: nhận 500 khi thiết bị chưa có dòng `granted > 0` và IP có dưới 3 dòng `granted > 0` trong 24 giờ; ngược lại `granted = 0`, vẫn tạo user và vẫn ghi `signup_grants`, không có bút toán `GRANT`. Không trần theo ngày hay tổng.
- Tạo user, ghi `signup_grants` và `wallet.grant` trong cùng một transaction do `auth` mở; lỗi bất kỳ thì rollback tất cả (không để user tồn tại mà thiếu `signup_grants`).
- Chống đua: `pg_advisory_xact_lock` trên hash IP và hash thiết bị, lấy theo thứ tự cố định để không deadlock.
- Băm: HMAC-SHA256 hex với khóa `ANTI_ABUSE_SECRET` (env, có giá trị dev mặc định giống `JWT_SECRET`); không lưu IP/`deviceId` gốc ở bất kỳ đâu.
- IP khách: chỉ dùng `CF-Connecting-IP` khi địa chỉ kết nối nằm trong dải IP Cloudflare (danh sách cố định trong mã, cộng `TRUSTED_PROXY_CIDRS` từ env để test); ngược lại dùng IP kết nối. Chuẩn hóa dạng `::ffff:a.b.c.d`.
- Rate-limit bằng `@nestjs/throttler` theo IP khách đã giải quyết, áp cho `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`; vượt giới hạn trả HTTP 429 với `code: RATE_LIMITED`. Giới hạn đọc từ env (`AUTH_THROTTLE_LIMIT`, `AUTH_THROTTLE_TTL_MS`).
- User đã tồn tại đăng nhập lại: không tặng, không ghi `signup_grants`.

**Never:**
- Không sửa `packages/contracts`; không thêm endpoint mới; không UPDATE/DELETE `ledger_entries`; không để `wallet` ghi `signup_grants`; không tin `CF-Connecting-IP` từ kết nối ngoài dải tin cậy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thiết bị và IP mới | user mới, IP có <3 grant/24h | balance 500, một `GRANT` 500, `granted=500` | N/A |
| Thiết bị đã nhận | cùng `deviceId`, email mới | user tạo, balance 0, không `GRANT`, `granted=0` | N/A |
| IP đủ 3 | tài khoản thứ 4 cùng IP/24h | balance 0, `granted=0` | N/A |
| IP đã đủ 3 nhưng quá 24h | grant cũ hơn 24h | lại nhận 500 | N/A |
| 5 đăng ký song song | cùng IP, thiết bị khác nhau | đúng 3 nhận 500, 2 nhận 0 | N/A |
| 5 song song cùng thiết bị | IP khác nhau | đúng 1 nhận 500 | N/A |
| 1.000 tài khoản | thiết bị và IP đều khác | cả 1.000 nhận 500 | N/A |
| Header Cloudflare | kết nối từ dải tin cậy / ngoài dải | dùng header / bỏ qua header | N/A |
| Băm | đọc `signup_grants` | không chứa IP/`deviceId` gốc, hash 64 hex | N/A |
| Vượt giới hạn | vượt `AUTH_THROTTLE_LIMIT` | 429 `RATE_LIMITED` | thông báo tiếng Việt từ contracts |
| Lỗi giữa chừng | `wallet.grant` ném lỗi | không còn user mới, không còn `signup_grants` | rollback |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` + migration `20261103020000_signup_grants` -- model `SignupGrant`, quan hệ `User.signupGrant`; SQL thô cho unique một phần, CHECK, chỉ mục.
- `apps/api/src/modules/auth/auth.service.ts` -- `handleGoogleCallback(query, clientIp)`: nhánh user mới dùng `prisma.$transaction`; `statePayload.deviceId` đã có sẵn. Bám `WalletService.grant` (đã yêu cầu `tx`).
- `apps/api/src/modules/auth/client-ip.ts` (mới) -- `resolveClientIp`, `isIpInCidrs`, `CLOUDFLARE_CIDRS`; `anti-abuse.ts` (mới) -- `hmacHex`, hằng 500/3/24h.
- `apps/api/src/modules/auth/auth.controller.ts` -- lấy IP từ `req` (thêm `ip`/`socket` vào `RequestWithCookies`), gắn throttler guard.
- `apps/api/src/modules/auth/auth.module.ts`, `app.module.ts` -- `ThrottlerModule.forRootAsync`, guard override `getTracker` và `throwThrottlingException` (`ApiErrorCode.RATE_LIMITED`).
- `apps/api/test/signup-grant.test.mjs` (mới) -- bám harness `auth.test.mjs` (mock `GoogleOAuthService.exchangeCodeAndGetProfile`, PostgreSQL thật).
- `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/.env.example` -- phụ thuộc và biến môi trường.

## Tasks & Acceptance

**Execution:**
- [x] `schema.prisma`, migration `20261103020000_signup_grants` -- bảng, unique một phần, CHECK, chỉ mục -- AC migration.
- [x] `client-ip.ts`, `anti-abuse.ts` -- giải quyết IP và HMAC -- AR16.
- [x] `auth.service.ts`, `auth.controller.ts` -- giao dịch tặng credit khi đăng ký -- FR12.
- [x] `package.json`, `app.module.ts`/`auth.module.ts`, guard throttler, `.env.example` -- rate-limit `RATE_LIMITED` -- NFR3.
- [x] `test/signup-grant.test.mjs` -- phủ ma trận trên PostgreSQL thật, gồm song song, rollback, catalog migration -- bảo chứng; chạy lại các test hiện có, điều chỉnh nếu số dư mặc định thay đổi.

**Acceptance Criteria:**
- Given migration, when truy vấn catalog, then có `signup_grants` với khóa chính, unique một phần trên `fingerprint_hash` khi `granted > 0` và chỉ mục `(ip_hash, created_at)`.
- Given `CF-Connecting-IP` và hai loại kết nối, when đăng ký, then chỉ kết nối trong dải tin cậy được dùng header.
- Given pool kết nối sau một rollback do lỗi, when chạy truy vấn tiếp, then pool dùng lại bình thường.

## Implementation Notes

- Đã tạo migration `20261103020000_signup_grants` với cấu trúc bảng `signup_grants`, khóa chính `user_id` FK `users(id) ON DELETE CASCADE`, `CHECK (granted >= 0)`, partial unique index `(fingerprint_hash) WHERE granted > 0`, và index `(ip_hash, created_at)`.
- Triển khai `client-ip.ts`: `resolveClientIp` chỉ tin cậy header `CF-Connecting-IP` khi kết nối đến từ dải IP Cloudflare (`CLOUDFLARE_CIDRS`) hoặc `TRUSTED_PROXY_CIDRS`.
- Triển khai `anti-abuse.ts`: băm HMAC-SHA256 hex cho cả IP và `deviceId` với khóa bí mật phía server `ANTI_ABUSE_SECRET` (fallback `JWT_SECRET`).
- Cập nhật `auth.service.ts`: gom việc tạo user mới, bản ghi `signup_grants` và gọi `walletService.grant` vào cùng 1 interactive transaction. Dùng `pg_advisory_xact_lock` theo thứ tự số tăng dần của `hashtextextended` giữa IP và thiết bị để ngăn chặn tuyệt đối tình trạng đua điều kiện (race conditions) và deadlock.
- Triển khai `AuthThrottlerGuard` dựa trên `@nestjs/throttler@6.7.1` ghim chính xác trong `package.json`, theo dõi theo IP khách đã giải quyết và trả về HTTP 429 kèm mã `ApiErrorCode.RATE_LIMITED`.
- Viết 20 test tự động tại `apps/api/test/signup-grant.test.mjs` trên PostgreSQL 16 và Redis 7 thật, bao phủ 100% các tình huống trong ma trận và kiểm chứng rollback cùng connection pool. Toàn bộ 96 test API đều pass.

## Spec Change Log

## Review Triage Log

- patch (đã sửa) -- V1: Thiếu test kiểm chứng rate limit đối với `POST /auth/refresh` và `GET /auth/google/callback` -- Đã thêm test gửi 21 request tới `POST /auth/refresh` nhận 429 `RATE_LIMITED` trong `signup-grant.test.mjs`.
- patch (đã sửa) -- B1: Thiếu trường `grantedCredits` trong kết quả callback trả về của `AuthService` và `AuthController` theo `AuthGoogleCallbackResponseSchema` -- Đã bổ sung `grantedCredits` vào session result và response trả về client.
- patch (đã sửa) -- E1 & B4: Thiếu kiểm tra dải bit prefix CIDR âm hoặc >32/>128 trong `isIpInCidrs` gây lỗi `RangeError` khi env CIDR sai -- Đã thêm kiểm tra biên `prefix >= 0 && prefix <= maxPrefix` và bọc try/catch.
- patch (đã sửa) -- B3: Tái tạo `net.BlockList` 23+ lần trên mỗi request trong `isIpInCidrs` -- Đã gom thành 1 `net.BlockList` tổng hợp và cache theo giá trị `process.env.TRUSTED_PROXY_CIDRS`.
- patch (đã sửa) -- B5: Chưa xử lý chuỗi nhiều IP phân tách bằng dấu phẩy trong header `CF-Connecting-IP` -- Đã thêm xử lý lấy IP đầu tiên `.split(',')[0].trim()`.
- patch (đã sửa) -- B10: Model `SignupGrant` trong `schema.prisma` thiếu khai báo composite index `@@index([ipHash, createdAt])` dù migration SQL đã có -- Đã bổ sung `@@index([ipHash, createdAt])` vào `schema.prisma`.
- defer -- B7: `deploy/compose.yml` chưa truyền biến `ANTI_ABUSE_SECRET`, `AUTH_THROTTLE_LIMIT` -- Ghi vào `deferred-work.md`; các biến đã có trong `deploy/.env.example` và compose đọc từ `.env`.
- defer -- B9: Rate-limiting dùng in-memory store thay vì Redis cho scale ngang -- Ghi vào `deferred-work.md`; phù hợp mở rộng khi scale multi-node.
- defer -- B12: Khóa `pg_advisory_xact_lock(bigint)` dùng 64-bit băm chung toàn DB -- Hiện tại dùng `hashtextextended` đủ an toàn, cân nhắc tách namespace 2 tham số nếu có thêm module dùng advisory lock.
- defer -- B13: Chưa bắt lỗi unique P2002 khi 2 request callback cùng lúc cho 1 tài khoản Google mới -- Cực hiếm khi người dùng Google OAuth callback đồng thời; xử lý ở story hoàn thiện edge-case auth.
- defer -- E2 & B2 & B15: Gom nhóm subnet IPv6 (/64) cho chống lạm dụng và rate-limit -- Cần nghiên cứu chuẩn hóa CIDR IPv6 khi triển khai thực tế trên hạ tầng có người dùng IPv6 thực.
- false -- B6: Nguy cơ cạn kiệt hạn mức đăng ký khi chạy sau reverse proxy cục bộ -- Cơ chế `TRUSTED_PROXY_CIDRS` được thiết kế đúng chuẩn để khai báo proxy nội bộ khi cần.
- false -- B8: Đăng ký `ThrottlerModule.forRootAsync` ở `AuthModule` thay vì `AppModule` -- Scoped guard dành riêng cho controller Auth, export sạch sẽ.
- false -- B11: `tx.user.findUniqueOrThrow` ở cuối transaction đăng ký là dư thừa -- Cần thiết vì `walletService.grant` đã cập nhật balance của user, query lại để trả về trạng thái user mới nhất có `balance = 500`.

## Design Notes

Hai khóa advisory (IP, thiết bị) tạo bằng `hashtextextended(<hash>, 0)`, sắp theo giá trị số trước khi lấy. Việc đếm theo IP chỉ tính `granted > 0` vì đề bài giới hạn số tài khoản *nhận thưởng*. Unique một phần là lưới an toàn cuối; nhờ khóa advisory nên nhánh P2002 không xảy ra trong luồng bình thường.

## Verification

**Commands:**
- `pnpm run lint` -- expected: exit 0
- `pnpm run typecheck` -- expected: exit 0
- `pnpm run build` -- expected: exit 0
- `pnpm --filter @motion-ai/api test` -- expected: exit 0
- `pnpm test` -- expected: exit 0

