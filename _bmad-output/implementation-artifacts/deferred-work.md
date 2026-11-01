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
