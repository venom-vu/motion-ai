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
