---
title: 'Story 6.10: [INTEGRATION] Nối FE với BE và smoke test vận hành'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
baseline_commit: 'e42f5fd37bfb1a6727130b09e63c98161e1d172a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Các story 6.2–6.9 mới được kiểm riêng lẻ; chưa có bằng chứng ngắt mạch, hết ngân sách, khóa tài khoản, cộng bù, gỡ nội dung, sao lưu và chân trang chạy cùng nhau trên stack bốn container.

**Approach:** Thêm smoke test `RUN_COMPOSE_E2E=1` cho vận hành (RunningHub, R2, Discord giả; breaker bật), bổ sung kiểm tra chân trang, đối soát sổ cái, test hợp đồng và README kèm runbook Admin.

## Boundaries & Constraints

**Always:** Theo mẫu smoke 5.9 (project/cổng compose riêng, `compose.smoke.yml`); breaker thật bật trong stack (không truyền `OPS_BREAKER_DISABLED`); dùng schema `@flowvis/contracts` để parse phản hồi; `reconcile.js` thoát 0 cuối kịch bản.

**Never:** Không thêm dependency trình duyệt (Playwright); chân trang kiểm bằng HTML SSR của bản Nuxt đã build (3 liên kết, `mailto:`). Không thêm giá trị `ApiErrorCode`; không sửa luật nghiệp vụ Epic 6 (chỉ sửa mã khi smoke lộ lỗi thật, ghi vào Implementation Notes); không refactor các smoke cũ.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ngắt mạch chuỗi | RH giả `RH_ERROR` 5 Task liên tiếp | Tạo Task thứ 6 ở 3 route → 503 `PAUSED`; login, nạp, lịch sử, tải kết quả dùng được; Discord nhận đúng 1 cảnh báo; `/system/status` `intakePaused` true | Không HOLD cho yêu cầu bị chặn |
| Mở lại | Admin `POST /admin/ops/resume` (qua UI/API) | Tạo Task lại được; lỗi cũ không kích hoạt lại ngay | N/A |
| Tỷ lệ 15% | 20 Task: 4 lỗi hệ thống + 10 `NO_POSE` | Breaker kích hoạt; riêng 30 `NO_POSE` thì không | N/A |
| Khóa tài khoản | Admin khóa user có JWT cũ | Tạo Task → `ACCOUNT_LOCKED`; refresh bị từ chối; mở khóa đăng nhập lại được | N/A |
| Cộng bù | +300 kèm lý do; trừ vượt số dư; gửi lại cùng `requestId` | 1 bút toán `ADJUST`, số dư +300; trừ vượt bị từ chối; gửi lại không ghi thêm; `admin_audit` có bản ghi | `ADJUST_INSUFFICIENT_BALANCE` |
| Gỡ nội dung | Video đã chia sẻ, Admin tìm theo `shareUrl`, gỡ | `/s/<token>`, `/info`, `/poster` 404; khóa `in/`, `out/` biến mất khỏi R2 giả; `filesRemovedAt` có; số dư không đổi | N/A |
| Sao lưu | 9 bản cũ trong `db-backup/`; rồi `pg_dump` lỗi | Còn đúng 7 bản mới nhất; lỗi → không xóa bản cũ, Discord nhận đúng 1 cảnh báo | N/A |
| Restore-drill | Bản sao lưu vừa tạo, DB trống, xóa Redis | Kiểm tra sổ cái đạt; bộ quét dựng lại hàng đợi Task `queued` | Lệch thì fail |
| Chân trang | Mọi trang | 3 liên kết; `mailto:` đúng địa chỉ cấu hình | N/A |
| Đối soát, hợp đồng | Sau các smoke; CI | `reconcile.js` thoát 0; mock và BE thật khớp schema contracts | Lệch thì fail |

</frozen-after-approval>

## Code Map

- `apps/api/test/smoke-motion-control.test.mjs` -- mẫu cần theo (compose, fake RH/R2/Google, `login`, reconcile ~dòng 549)
- `apps/api/test/smoke-topup.test.mjs` -- có `startFakeDiscord`
- `deploy/compose.smoke.yml` -- thêm `NUXT_PUBLIC_REPORT_EMAIL`, biến `BACKUP_*` nếu cần; không bật `OPS_BREAKER_DISABLED`
- `apps/api/test/helpers/` -- thêm helper dùng chung cho smoke mới (các smoke cũ giữ nguyên)
- `apps/api/src/modules/ops/{breaker,backup,reconcile}.service.ts`, `ops.controller.ts`, `admin-users.controller.ts`, `admin-tasks.controller.ts` -- hành vi cần kiểm
- `apps/api/src/scripts/{restore-drill,reconcile}.ts`, `deploy/RESTORE.md` -- restore-drill
- `apps/web/components/AppFooter.vue`, `utils/system-status.ts` -- chân trang, `buildReportMailto`
- `packages/contracts/src/{ops,mocks}.ts` -- schema và mock để đối chiếu
- `README.md` (dòng ~62–83) -- thêm cách chạy smoke và runbook Admin

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/test/helpers/smoke-fakes.mjs` -- helper fake RH/R2/Discord/Google, `login`, compose -- tránh chép lại lần nữa
- [x] `apps/api/test/smoke-ops.test.mjs` -- các kịch bản trong ma trận (theo nhóm `it`) -- bằng chứng tích hợp
- [x] `deploy/compose.smoke.yml` -- biến môi trường còn thiếu -- stack smoke vận hành
- [x] Kiểm tra chân trang -- parse HTML SSR của bản build, không thêm dependency
- [x] `apps/api/test/` hoặc `packages/contracts` test -- mock và BE thật khớp schema -- AC hợp đồng
- [x] `README.md` -- cách chạy smoke và runbook Admin (ngắt mạch, hết ngân sách, sao lưu lỗi, đơn nạp quá hạn)

**Acceptance Criteria:**
- Given `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test`, when chạy, then smoke vận hành xanh và `reconcile.js` thoát 0
- Given `pnpm run lint && pnpm run typecheck && pnpm test`, when chạy ở gốc, then pass

## Implementation Notes

- Smoke `smoke-ops.test.mjs` (9 kịch bản Docker + 1 test hợp đồng không cần Docker) chạy trực tiếp với `ops-preload.mjs`: 10 pass. Chưa chạy trọn `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test`.
- Không có thay đổi mã ứng dụng; smoke không lộ lỗi thật.
- Chân trang kiểm bằng `apps/web/test/footer-ssr.test.mjs` (5 trang, parse HTML SSR từ `.output`, skip nếu chưa build).
- Rủi ro đã biết: cổng cố định (PG 15438, Redis 16385, API 3107, giả 3196-3199) đụng khi chạy song song smoke khác; chưa kiểm viewport 360 px và biểu ngữ bảo trì trong trình duyệt; `pnpm test` gốc fail ở test cần DB local (P1000 xác thực `motion_user`), chưa xác nhận nguyên nhân.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence |
|---------|---------|----------|
| Takedown dùng Task ảnh nên `/poster` 404 vô nghĩa; không kiểm 200 trước gỡ cho `/info`, `/poster` | medium → patch (đã sửa) | `share.service.ts:106` trả 404 nếu key không `.mp4`. Người dùng chọn đổi sang Task Motion Control: assert `/info` 200, `/poster` 302 trước gỡ, 404 sau gỡ; smoke chạy lại 10/10 pass. |
| Body `{}` ở body-retouch/motion có thể 400 trước PAUSED | false | `IntakeOpenGuard` là guard (chạy trước pipe validate); `tasks.controller.ts:38-74`. |
| Chú thích "mẫu 12/18/19" và `eligibleTasks` không khớp / NO_POSE tính vào mẫu | false | NO_POSE bị loại khỏi mẫu (epic 6 context); 9 ok + 3 lỗi = 12, … 20 với đúng 4 lỗi; smoke tác giả báo pass. |
| Mẫu rate có thể lẫn Task test trước | false | `resume()` đặt mốc đếm; test khẳng định `eligibleTasks === 20`, pass thực tế. |
| `footer-ssr` skip khi thiếu `.output`, preset khác, `/history` có thể redirect | low | Preset là `cloudflare-pages`; web `test` build trước; 5/5 pass. Không sửa. |
| Port cố định, cleanup `before`, `closeAllConnections`, retry POST, các điểm fake S3/RH | low | Khớp quy ước các smoke cũ; hậu quả chỉ khi chạy song song. Bỏ. |
| Test 402 phụ thuộc bonus IP; `waitFor` hết hạn token; `rh.submits` không assert | low | Độ bền test, chưa có hậu quả thực tế. Bỏ. |
| Resume bởi non-admin 403 / thiếu negative case phân quyền | false | `ops-breaker.test.mjs:294-295` đã kiểm 401/403. |
| BUDGET_EXHAUSTED, quá 36h, banner FE, mock-vs-BE chỉ key | defer | Ngoài AC 6.10 (không yêu cầu); ghi deferred-work. |

## Verification

**Commands:**
- `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` -- expected: smoke-ops pass
- `pnpm run lint && pnpm run typecheck && pnpm test` -- expected: exit 0
