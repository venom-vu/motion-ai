# Epic 1 Context: Nền tảng, đăng nhập và credit dùng thử

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic này thiết lập nền tảng monorepo, pipeline CI, hạ tầng dịch vụ cơ sở (API, Worker, PostgreSQL, Redis) và gói hợp đồng chung để hai luồng Backend và Frontend có thể phát triển song song độc lập. Về mặt sản phẩm, epic hoàn thiện luồng đăng nhập Google có xác nhận điều khoản dịch vụ (ToS), cấp 500 credit dùng thử một lần kèm cơ chế chống lạm dụng theo thiết bị và IP, vận hành sổ cái credit bất biến và tự động xác định hạng tài khoản (Tier) cũng như hiển thị số dư và lịch sử biến động credit cho người dùng.

## Stories

- Story 1.1: [SHARED] Dựng monorepo và khung CI
- Story 1.2: [CONTRACT] Hợp đồng chung cho đăng nhập và ví
- Story 1.3: [BE] Khung api, worker, PostgreSQL và Redis
- Story 1.4: [FE] Khung Nuxt 4 mobile-first chạy trên mock
- Story 1.5: [BE] Đăng nhập Google và phiên JWT
- Story 1.6: [BE] Sổ cái credit bất biến
- Story 1.7: [BE] Tier, API ví và đối soát sổ cái
- Story 1.8: [BE] Tặng 500 credit và chống lạm dụng
- Story 1.9: [FE] Đăng nhập, cam kết ToS và số dư
- Story 1.10: [FE] Lịch sử credit
- Story 1.11: [INTEGRATION] Nối FE với BE và smoke test đăng nhập

## Requirements & Constraints

- **Sổ cái credit bất biến và toàn vẹn số dư:** Mọi biến động số dư (`GRANT`, `TOPUP`, `ADJUST`, `HOLD`, `CAPTURED`, `RELEASED`) chỉ được ghi thêm (append-only) vào sổ cái trong giao dịch CSDL. Số dư khả dụng luôn bằng tổng các bút toán (`SUM(amount)`); không bao giờ cho phép số dư âm hoặc số tiền đang giữ (`held`) âm, kể cả khi có nhiều yêu cầu đồng thời.
- **Xác định hạng tài khoản (Tier) và Tier Snapshot:** Tier (`FREE`, `Starter`, `Pro`, `Creator`) là gói cao nhất đã nạp kể từ lần gần nhất tài khoản ở hạng `FREE`, còn hiệu lực khi tổng credit sở hữu (`balance + held`) đạt từ 100 trở lên. Khi tổng sở hữu dưới 100, tài khoản rơi về `FREE` và xóa lịch sử gói đã nạp. Khi giữ tiền (`HOLD`) tạo tác vụ, hệ thống chụp lại Tier Snapshot (Tier, Priority, Cap) trong cùng giao dịch để việc giữ tiền không làm hạ Tier của chính tác vụ đó.
- **Tặng 500 credit dùng thử và chống lạm dụng:** Cấp 500 credit một lần khi đăng ký Google thành công cho mỗi thiết bị (Device Fingerprint) và tối đa 3 tài khoản nhận thưởng trên mỗi địa chỉ IP trong 24 giờ. Từ tài khoản thứ 4 cùng IP trong 24 giờ hoặc thiết bị đã nhận thưởng, tài khoản vẫn được tạo nhưng nhận 0 credit. Không đặt trần theo ngày hay trần tổng toàn hệ thống.
- **Cam kết Điều khoản dịch vụ (ToS):** Người dùng bắt buộc tích đồng ý ToS (đủ 18 tuổi, sở hữu quyền hợp pháp với hình ảnh, cấm nội dung khiêu dâm/bôi nhọ/deepfake ác ý, miễn trừ trách nhiệm) trước khi đăng ký tài khoản. Hệ thống lưu lại phiên bản và thời điểm đồng ý.
- **Bảo mật và giới hạn tần suất:** Mọi khóa bí mật chỉ đọc từ biến môi trường backend. CORS chỉ mở cho miền Frontend. Áp dụng giới hạn tần suất (rate-limit) theo tài khoản và IP cho các route ghi và đăng nhập. Tài khoản bị khóa (`locked_at` khác rỗng) bị từ chối mọi thao tác ghi và làm mới phiên.

## Technical Decisions

- **Cấu trúc Monorepo & Ranh giới nhánh:** Gồm `apps/web` (Nuxt 4), `apps/api` (NestJS với hai entrypoint `src/main.ts` cho HTTP API và `src/worker.ts` cho tiến trình BullMQ không mở cổng HTTP), `packages/contracts` (nguồn sự thật duy nhất cho DTO, schema validate, `ApiErrorCode`, ` TOS_VERSION`, dữ liệu mock) và `deploy/compose.yml`. CI cưỡng chế ranh giới thư mục theo tiền tố nhánh (`fe/*` chỉ sửa `apps/web`, `be/*` chỉ sửa `apps/api` và `deploy/`, `contract/*` và `shared/*` mới được sửa `packages/contracts`).
- **Phiên bản công nghệ ghim cố định:** Node.js `>= 22.22.3`, Nuxt `4.6.3` (preset Nitro `cloudflare-pages` hoặc `cloudflare_module`), NestJS `12.3.2` (ESM), Prisma `7.10.1` kèm `@prisma/adapter-pg` `7.10.1` (`prisma.config.ts`, generator `prisma-client`), `@nestjs/bullmq` `12.0.0`, `bullmq` `6.5.3`, `ioredis` `5.11.1` (`maxRetriesPerRequest: null` cho worker), `@nestjs/throttler` `6.7.1`, `@nestjs/schedule` `12.0.2`, `@nestjs/jwt` `12.0.3`, `@nestjs/passport` `12.0.0`, `passport-google-oauth20` `2.0.0`, PostgreSQL 16 (`postgres:16-alpine`), Redis 7 (`appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`).
- **Quyền sở hữu bảng và Giao dịch liên module:** Mỗi bảng chỉ có một module chủ được phép ghi (`auth` ghi `users` phần danh tính/ToS/khóa, `refresh_tokens`, `signup_grants`; `wallet` ghi `ledger_entries` và `users.balance/held/tier/tier_pack`). Khi một luồng nghiệp vụ cần ghi qua nhiều module (như đăng ký vừa tạo user vừa tặng credit), module chủ luồng (`auth`) mở interactive transaction Prisma và truyền `tx` vào hàm của module kia (`wallet.grant(tx, ...)`). Các hàm ghi của `wallet` bắt buộc nhận `tx` và từ chối chạy nếu thiếu `tx`.
- **Ràng buộc CSDL và xử lý lỗi Unique (P2002):** Các ràng buộc `CHECK (balance >= 0)`, `CHECK (held >= 0)`, chỉ mục duy nhất một phần `(task_id)` cho `HOLD`, chỉ mục duy nhất một phần `(task_id)` cho tập `{CAPTURED, RELEASED}`, và chỉ mục duy nhất một phần trên `signup_grants(fingerprint_hash) WHERE granted > 0` phải khai báo qua migration SQL thô. Mọi lỗi trùng khóa `P2002` trong luồng ví phải rollback toàn bộ transaction ngay lập tức, không truy vấn tiếp trên transaction đã lỗi, và phải có kiểm thử tích hợp trên PostgreSQL thật xác nhận connection pool dùng lại bình thường sau rollback.
- **Khóa dòng và chống đua (Race Condition):** Mọi giao dịch biến động ví khóa đúng một dòng `users` bằng `SELECT ... FOR UPDATE`. Luồng đăng ký sử dụng `pg_advisory_xact_lock(hash IP)` trong transaction để chống đua khi đếm giới hạn 3 tài khoản nhận thưởng mỗi IP trong 24 giờ. Địa chỉ IP và `deviceId` chỉ lưu dưới dạng băm một chiều có khóa bí mật phía server; chỉ tin header `CF-Connecting-IP` khi kết nối đến từ dải IP Cloudflare.
- **Xác thực & Phiên:** Access JWT có thời hạn 15 phút (lưu trong bộ nhớ FE); Refresh Token là chuỗi ngẫu nhiên chỉ lưu bản băm trong bảng `refresh_tokens`, đặt trong cookie `httpOnly`, `Secure`, `SameSite=Lax`, xoay vòng (rotate) mỗi lần làm mới và thu hồi khi đăng xuất hoặc khóa tài khoản. Danh sách email trong biến môi trường `ADMIN_EMAILS` được cấp role `admin` khi tạo tài khoản.
- **Cấu hình giá, Tier và Đối soát:** Bảng giá, Cap và Priority (`FREE`: 5s / priority 10; `Starter`: 10s / priority 3 / 49.000đ / 5.000 cr; `Pro`: 15s / priority 2 / 99.000đ / 12.000 cr; `Creator`: 20s / priority 1 / 199.000đ / 30.000 cr) cấu hình tại một nguồn phía server và xuất qua `GET /config/pricing`. Hàm tính lại Tier là hàm thuần chạy trong cùng transaction với `GRANT`, `TOPUP`, `ADJUST`, `CAPTURED` (không chạy khi `HOLD` hay `RELEASED`). Job đối soát chạy hằng ngày qua `@nestjs/schedule` kiểm tra lệch `balance`/`held` so với sổ cái và cảnh báo qua `NotifierPort` (dùng adapter ghi log ở epic này).

## UX & Interaction Patterns

- **Nhận diện thị giác Slate Cyber & Chuẩn Icon:** Nền chính `#0F172A`, bề mặt thẻ `#1E293B`, viền `#334155`, màu nhấn chính `#8B5CF6` (Electric Violet), màu nhấn thông số/credit `#06B6D4` (Neon Cyan), chữ chính `#F8FAFC`, chữ phụ `#94A3B8`. Sử dụng 100% vector icon qua `nuxt-icon` với bộ `lucide` (`stroke-width: 2`); nghiêm cấm dùng ký tự emoji UTF-8 trong giao diện. Mọi vùng chạm tương tác tối thiểu `48px`. Giao diện hoàn toàn bằng tiếng Việt.
- **Bố cục thích ứng (Mobile-First + Full Desktop Adaptive):**
  - **Mobile (`< 768px`, chuẩn `360px`):** Không có thanh cuộn ngang; điều hướng bằng Top Header gọn kết hợp Bottom Navigation Bar cố định đáy (4 tab: `Kho AI`, `Lịch sử`, `Bảng giá`, `Tôi`). Trang chủ hiển thị 1 cột các Card tính năng có ảnh minh họa; chạm vào card mở `FeatureWorkspaceDialog` dạng Centered Dialog giữa màn hình.
  - **Desktop cho User (`>= 1024px`):** Không dùng Sidebar trái; sử dụng Top Header cố định (`68px`) chứa Logo, điều hướng, huy hiệu số dư (`credit-badge`), nút nạp và Avatar. Trang chủ hiển thị thanh lọc/tìm kiếm và lưới 3–4 cột Card tính năng toàn màn hình; click vào card mở `FeatureWorkspaceDialog` (`max-width: 980px`) dạng Centered Dialog.
  - **Desktop cho Admin (`/admin`):** Sử dụng Left Sidebar tối giản (`220px`) phong cách Vercel (nền `#0A0A0A`, viền mảnh `1px`, font số `monospace`).
- **Luồng đăng nhập, hiển thị số dư và lịch sử:** Tại `/login`, nút "Đăng nhập bằng Google" bị vô hiệu hóa cho đến khi người dùng tích checkbox cam kết ToS. Sau khi đăng nhập, Header luôn hiển thị huy hiệu số dư credit và Tier từ `GET /me` (hoặc thông báo nhắc nạp khi số dư bằng 0). Khi gọi API gặp `401`, client tự động gọi `POST /auth/refresh` một lần và thử lại request trước khi chuyển hướng về `/login`. Trang lịch sử credit hiển thị bút toán mới nhất trước với nhãn tiếng Việt (`Tặng`, `Nạp`, `Giữ`, `Hoàn`, `Chốt`, `Điều chỉnh`), số credit có dấu, múi giờ Việt Nam và hỗ trợ tải thêm trang khi cuộn. Mọi mã `ApiErrorCode` được ánh xạ tập trung sang thông báo tiếng Việt thân thiện.

## Cross-Story Dependencies

- **Cổng tuần tự đầu Epic:** Story 1.1 (dựng monorepo & CI) và Story 1.2 (hợp đồng `packages/contracts` và mock data) phải hoàn tất và merge tuần tự trước khi hai luồng BE và FE bắt đầu rẽ nhánh.
- **Luồng BE tuần tự:** Story 1.3 (khung NestJS, Prisma, Docker Compose, Redis) là nền tảng cho Story 1.5 (đăng nhập Google & bảng `users`, `refresh_tokens`) và Story 1.6 (bảng `ledger_entries` & hàm `wallet`). Story 1.7 (tính Tier, API `/me`, `/wallet/ledger`, `/config/pricing`, đối soát) và Story 1.8 (bảng `signup_grants`, tặng 500 credit trong transaction đăng ký) phụ thuộc trực tiếp vào cả Story 1.5 và Story 1.6.
- **Luồng FE trên Mock:** Story 1.4 (khung Nuxt 4, layout Slate Cyber, client API có chế độ mock) mở đường cho Story 1.9 (UI đăng nhập, ToS, hiển thị số dư/Tier) và Story 1.10 (UI lịch sử credit) chạy hoàn toàn trên dữ liệu mock từ `packages/contracts` mà không cần chờ BE.
- **Điểm hội tụ cuối Epic:** Story 1.11 (tích hợp FE-BE và smoke test) chỉ bắt đầu sau khi toàn bộ các story của cả hai luồng (1.3 đến 1.10) đã hoàn tất.
- **Liên kết sang các Epic sau:** Các cột `task_id` và `topup_id` trong `ledger_entries` được tạo ở Story 1.6 nhưng chưa gắn khóa ngoại; khóa ngoại sẽ được bổ sung ở Epic 2 (khi tạo bảng `tasks`) và Epic 3 (khi tạo bảng `topups`). `NotifierPort` định nghĩa ở Story 1.7 dùng adapter ghi log và sẽ được nối adapter Discord webhook ở Epic 3.
