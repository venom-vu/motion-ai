## Deferred from: code review of spec-1-1-shared-dung-monorepo-va-khung-ci (2026-11-01)

- Smoke test spawn `dist/main.js` / `dist/worker.js` (guard entrypoint, PORT): bổ sung ở Story 1.3.
- API entrypoint thiếu `enableShutdownHooks()`: bổ sung ở Story 1.3.
- `apps/web` lint chưa phủ `.vue`: làm khi có component FE.
- CI cần branch protection/required check trên GitHub để thực sự chặn merge.
- CLAUDE.md "Quy trình làm việc" còn ghi story 1-1 là bước tiếp theo.

## Deferred from: code review of spec-1-2-contract-hop-dong-chung-cho-dang-nhap-va-vi (2026-11-01)

- Hình dạng `GET /auth/google` + callback (JSON vs 302 redirect) và hợp đồng cookie refresh token (tên, SameSite, Path, CSRF) chưa được định nghĩa ngoài comment. Chưa xác minh (tối đa medium); cần đối chiếu ARCHITECTURE-SPINE trước Story đăng nhập BE/FE.

## Deferred from: code review of spec-1-3-be-khung-api-worker-postgresql-va-redis (2026-11-02)

- Migration chỉ chạy trong lệnh start của `nestjs-api`; worker/nhiều replica không có thứ tự hay khóa. Worker chưa dùng DB; xử lý khi có bảng nghiệp vụ (service `migrate` one-shot + `depends_on: service_completed_successfully`).
- `?schema=` trong `DATABASE_URL` có thể không được `PrismaPg`/`pg.Pool` áp dụng lúc runtime (chưa xác minh, tối đa medium). Settle bằng truy vấn runtime với schema khác `public`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Thêm `wallet.adjust()` và API đọc số dư/lịch sử cho module khác dùng.
  evidence: `ADJUST` được CHECK cho phép nhưng chưa có đường ghi; thuộc story 1.7 và story admin.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Chuyển `User.balance/held` (BigInt) sang number hoặc string khi trả JSON.
  evidence: JSON.stringify ném lỗi với BigInt; `/me` hiện trả hằng 0 nên chưa lộ, sẽ lộ khi nối ví ở 1.7.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Thêm trigger DB chặn UPDATE/DELETE trên `ledger_entries`.
  evidence: Append-only hiện chỉ dựa vào quy ước ứng dụng; ngoài phạm vi AC của 1.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: `wallet.grant` chưa có khóa idempotency; retry sẽ cộng tiền lặp.
  evidence: code-review độc lập; story 1.8 chặn bằng chỉ mục duy nhất trên `signup_grants(fingerprint_hash)`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-be-so-cai-credit-bat-bien.md`
  summary: Lỗi validation của wallet trả 409 không có `ApiErrorCode`; cần thêm mã lỗi vào `packages/contracts`.
  evidence: code-review độc lập; ngoài ranh giới nhánh `be/*` nên cần story `contract/*`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Backfill `users.tier_pack` từ bút toán TOPUP khi Epic 3 bắt đầu ghi TOPUP thật.
  evidence: Hiện chưa có luồng gọi `wallet.topup`, nên chưa có dữ liệu cần backfill; nếu có trước migration thì user trả phí sẽ bị FREE.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Khóa advisory, dedupe và gộp cảnh báo cho job đối soát; tách `ScheduleModule` chỉ vào worker.
  evidence: Nhiều bản sao worker hoặc lệch kéo dài sẽ gửi cảnh báo lặp; cờ `MOTION_PROCESS_ROLE` là biến toàn tiến trình.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-be-tier-api-vi-va-doi-soat-so-cai.md`
  summary: Chỉ mục/cột tuần tự cho `/wallet/ledger`; `adjust` thêm actor và lý do; hợp nhất `PRICING_CONFIG` với contracts.
  evidence: Truy vấn dùng `date_trunc` không dùng được chỉ mục; ADJUST thiếu dấu vết; cấu hình giá bị chép hai nơi.

## Deferred from: code review of spec-1-7-be-tier-api-vi-va-doi-soat-so-cai (2026-11-03)

- Job đối soát tải toàn bộ user không phân trang, một cảnh báo mỗi user, không chống chạy chồng; cần khóa advisory và cảnh báo gộp.
- Đối soát chưa kiểm `tier_pack` so với tổng credit và chưa phát hiện CAPTURED/RELEASED mồ côi; mở rộng sau.
- `PRICING_CONFIG` chép tay khỏi contracts và truy vấn ledger dùng `date_trunc` không tận dụng chỉ mục (đã ghi ở spec).
- Migration `tier_pack` chưa backfill/rollback (đã ghi ở spec); chờ Epic 3.

## Deferred from: code review of spec-1-8-be-tang-500-credit-va-chong-lam-dung (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-be-tang-500-credit-va-chong-lam-dung.md`
  summary: Tích hợp ThrottlerStorageRedisService để rate limit đồng bộ khi scale nhiều pod API.
  evidence: Hiện ThrottlerModule dùng bộ nhớ RAM mặc định; khi triển khai nhiều container API độc lập cần lưu tracker vào Redis dùng chung.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-be-tang-500-credit-va-chong-lam-dung.md`
  summary: Gom nhóm subnet IPv6 (/64) cho rate limit và chống lạm dụng thiết bị IPv6.
  evidence: Thiết bị di động/mạng IPv6 có thể xoay interface ID trong cùng subnet /64; cần chính sách gom subnet khi vận hành thực tế.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-be-tang-500-credit-va-chong-lam-dung.md`
  summary: Phân tách namespace cho pg_advisory_xact_lock(classid, objid).
  evidence: Tránh khả năng đụng độ mã băm 64-bit advisory lock với các tính năng locking khác trong tương lai.
- `WalletService` dùng `@Optional()` cho `PrismaService`, thiếu phụ thuộc chỉ lộ thành 500 lúc request. Lý do hoãn: giữ để test gọi `new WalletService()`; cân nhắc tách `WalletQueryService`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du.md`
  summary: Thêm liên kết tới trang Điều khoản dịch vụ và `aria-describedby` giải thích vì sao nút đăng nhập bị vô hiệu trong `LoginConsentForm`.
  evidence: Văn bản cam kết chỉ nêu phiên bản ToS, người dùng không đọc được nội dung họ đồng ý; chưa có trang điều khoản vì văn bản ToS cuối cùng còn chờ PM (PRD §10).

## Deferred from: code review of spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du (2026-11-03)

- Không có đường quay lại trang cũ sau khi đăng nhập hoặc hết phiên: `navigateTo('/login')` không mang `redirect` và `login.vue` luôn về `/`. Cần thiết kế OAuth state mang đích về, chỉ nhận đường dẫn tương đối cùng origin. Ngoài AC của 1.9, phù hợp với story tích hợp 1.11.

## Deferred from: code review lượt 3 of spec-1-9-fe-dang-nhap-cam-ket-tos-va-so-du (2026-11-03)

- `useAuth.restoreSession` (ánh xạ `outcome === 'ok'` và `sessionChecked` trong `.finally`) chưa có test chạy composable thật; đảo thành `outcome !== 'invalid'` thì mọi test vẫn xanh. Cần khung test Nuxt hoặc tách thêm một hàm thuần vào `auth-session.ts`.

## Deferred from: code review of spec-1-10-fe-lich-su-credit.md (2026-11-03)

- Kiểm thử reactive watcher `accessToken` trên Nuxt client runtime (`apps/web/pages/history.vue:52-59`): cần bổ sung test harness component mount chuyên dụng (@nuxt/test-utils hoặc @vue/test-utils) hiện chưa cấu hình trong repo.

