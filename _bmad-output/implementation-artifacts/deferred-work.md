## Deferred from: code review of spec-1-1-shared-dung-monorepo-va-khung-ci (2026-11-01)

- Smoke test spawn `dist/main.js` / `dist/worker.js` (guard entrypoint, PORT): bổ sung ở Story 1.3.
- API entrypoint thiếu `enableShutdownHooks()`: bổ sung ở Story 1.3.
- `apps/web` lint chưa phủ `.vue`: làm khi có component FE.
- CI cần branch protection/required check trên GitHub để thực sự chặn merge.
- CLAUDE.md "Quy trình làm việc" còn ghi story 1-1 là bước tiếp theo.

## Deferred from: code review of spec-1-2-contract-hop-dong-chung-cho-dang-nhap-va-vi (2026-11-01)

- Hình dạng `GET /auth/google` + callback (JSON vs 302 redirect) và hợp đồng cookie refresh token (tên, SameSite, Path, CSRF) chưa được định nghĩa ngoài comment. Chưa xác minh (tối đa medium); cần đối chiếu ARCHITECTURE-SPINE trước Story đăng nhập BE/FE.
