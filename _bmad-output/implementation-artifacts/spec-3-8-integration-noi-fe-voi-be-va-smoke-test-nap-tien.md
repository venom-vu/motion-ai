---
title: '3-8 [INTEGRATION] Nối FE với BE và smoke test nạp tiền'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: 'ed2b36d5042b1e3f60f63ab1f78078ccb9014781'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FE nạp tiền/duyệt đơn (3.6, 3.7) và BE (3.2–3.5) mới được test riêng; chưa có bằng chứng QR, hạn, Discord, duyệt và sổ cái chạy cùng nhau trên stack thật.

**Approach:** Thêm smoke test Compose cho nạp tiền theo mẫu `smoke-face-swap.test.mjs` (Google và Discord giả bằng HTTP server trong tiến trình test), thêm các ghi đè chỉ có tác dụng khi `NODE_ENV=test` để giả đồng hồ và rút hạn QR, kiểm tra hợp đồng mock/BE thật, cập nhật README. Không đổi nghiệp vụ.

## Boundaries & Constraints

**Always:** Ghi đè test (`TOPUP_QR_TTL_MS`, `TOPUP_FAKE_NOW`) bị bỏ qua khi `NODE_ENV !== 'test'` và có test chứng minh. Giữ đúng bốn container. Số tiền, `approve_by`, Tier do server quyết định. Tài khoản nhận tiền/webhook lấy từ biến môi trường, giá trị smoke là giả. Dùng project/cổng Compose riêng để không đụng smoke 2.14.

**Never:** Không sửa schema `packages/contracts` (chỉ thêm test). Không thêm endpoint hay container. Không dùng đồng hồ máy làm đầu vào quyết định hạn ở production. Không đưa bí mật thật vào repo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đường thành công | User tạo đơn Pro, consent, bấm "Đã chuyển khoản", Admin duyệt với `bank_ref` | Discord giả nhận đúng 1 thông báo; số dư +12.000, Tier Pro, ledger đúng 1 dòng `TOPUP` | N/A |
| `bank_ref` trùng | Đơn thứ hai duyệt cùng `bank_ref` | `BANK_REF_DUPLICATE`, không cộng credit | Đơn vẫn `pending` |
| Ngoài khung giờ | Xác nhận lúc 23:30 VN (`TOPUP_FAKE_NOW`) | `pending`, `approve_by` = 08:15 sáng hôm sau; quá `qr_expires_at` vẫn `pending` | N/A |
| QR hết hạn | Không bấm xác nhận, quá TTL rút ngắn | `expired`; xác nhận sau đó `TOPUP_QR_EXPIRED`; FE có nút tạo mã mới | N/A |
| Duyệt đồng thời | Hai phiên Admin duyệt song song | Một bên 200, bên kia `TOPUP_STATE_INVALID`; credit cộng một lần | N/A |
| Đối soát | Sau mọi kịch bản | `reconcile.js` thoát mã 0 | Lệch thì fail |
| Production | `NODE_ENV=production` + biến ghi đè | Ghi đè bị bỏ qua | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/test/smoke-face-swap.test.mjs` -- mẫu: dựng Compose, Google giả, helper `login/api/waitFor`; sao chép cấu trúc, không sửa
- `deploy/compose.smoke.yml` -- thêm env `ADMIN_EMAILS`, `DISCORD_WEBHOOK_URL`, `TOPUP_BANK_*`, `TOPUP_QR_TTL_MS`, `TOPUP_FAKE_NOW`, `TOPUP_SWEEP_INTERVAL` nếu cần
- `apps/api/src/modules/topups/topups.service.ts` -- `QR_TTL_MS` (dòng 37, dùng ở dòng 191) và `computeApproveBy(new Date())` (dòng 220): đổi sang hàm `topupClock()`/`qrTtlMs()` đọc ghi đè chỉ khi test
- `apps/api/src/modules/topups/topup-sweeper.service.ts` -- bộ quét `expired`, chạy ở worker (`MOTION_PROCESS_ROLE=worker`); xác định chu kỳ quét để test chờ được
- `apps/api/src/modules/ops/discord-notifier.adapter.ts` -- đọc `DISCORD_WEBHOOK_URL`, chấp nhận `http:`; dùng nguyên, không sửa
- `apps/api/test/test-overrides.test.mjs` -- thêm ca chứng minh ghi đè nạp tiền bị bỏ qua ở production
- `packages/contracts` -- `MOCK_*` của topup/admin topup để so khóa với phản hồi thật (chỉ đọc)
- `README.md`, `deploy/README.md` -- thêm mục smoke nạp tiền và biến môi trường

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/topups/topups.service.ts` -- thêm helper ghi đè TTL và đồng hồ, chỉ hiệu lực khi `NODE_ENV=test` -- để smoke giả 23:30 VN và hạn QR ngắn
- [x] `apps/api/test/test-overrides.test.mjs` -- thêm test bỏ qua ghi đè ở production -- giữ an toàn
- [x] `deploy/compose.smoke.yml` -- thêm biến smoke cho nạp tiền -- cấu hình stack
- [x] `apps/api/test/smoke-topup.test.mjs` -- Discord giả, đăng nhập user và admin, bảy kịch bản ma trận trên, đối soát, so khóa phản hồi với `MOCK_*` -- bằng chứng tích hợp
- [x] `README.md`, `deploy/README.md` -- cách chạy `RUN_COMPOSE_E2E=1`, danh sách biến: `TOPUP_BANK_BIN`, `TOPUP_BANK_ACCOUNT_NO`, `TOPUP_BANK_ACCOUNT_NAME`, `DISCORD_WEBHOOK_URL`, `ADMIN_EMAILS` -- AC README
- [x] `deploy/.env.example` -- thêm các biến trên (giá trị giữ chỗ) -- người triển khai điền

**Acceptance Criteria:**
- Given stack bốn container và Discord giả, when chạy `RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test`, then smoke nạp tiền qua mọi kịch bản và đối soát không lệch.
- Given CI không có Docker, when chạy `pnpm test`, then smoke bị bỏ qua và test hợp đồng (mock và phản hồi thật khớp schema) vẫn chạy.
- Given `pnpm run lint && pnpm run typecheck && pnpm run build`, then thành công.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Kiểm tra khóa hợp đồng không thể fail (parse bỏ khóa lạ) | medium | patch (đã sửa) | Schema không `.strict()` nên khóa lạ bị bỏ; đã so trên JSON thô |
| `return-to-pending`/`topupClock` không có test | medium | patch (đã sửa) | Thêm bước needs-review -> return-to-pending kiểm `approveBy`, smoke xanh |
| `ADMIN_EMAILS` thiếu trong `.env.example` | false | rejected | Có sẵn ở dòng 12 của `deploy/.env.example` |
| bob tạo hai đơn mở liên tiếp có thể bị chặn | false | rejected | Giới hạn là 3 đơn mở; smoke chạy xanh |
| `host.docker.internal` thiếu trên Linux | false | rejected | `compose.smoke.yml` đã có `extra_hosts: host-gateway` |
| Ghi đè kiểm thử chỉ test hàm helper, `@Interval` đọc lúc nạp module | low | rejected | Smoke Docker bao phủ; sửa cần thêm cơ chế |
| Fake server bind 0.0.0.0, cổng cố định, `execFileSync` chặn, không in log khi lỗi | low | rejected | Cùng mẫu smoke 2.14; chỉ ảnh hưởng độ bền test |
| Thiếu kịch bản reject, Discord lỗi, quá hạn duyệt, 403 đơn người khác, decode QR | medium | defer | Ngoài ma trận story; story 3.2-3.5 đã có test riêng |
| Không kiểm tra FE thật/CORS | medium | defer | Spec ghi rõ chỉ mức hợp đồng; cần trình duyệt |
| Nút "tạo mã mới" của FE chưa kiểm | medium | defer | Cần test trình duyệt; test FE 3.6 phủ ở mức component |
| Smoke chỉ chạy khi `RUN_COMPOSE_E2E=1` | low | rejected | Quy ước đã dùng cho 1.11, 2.14 |
| Cạnh tranh nhỏ: dừng worker, huge TTL, rò Google server, sleep cố định | low | rejected | Chỉ test nội bộ, không gặp hằng ngày; sửa thêm phức tạp |

## Design Notes

FE "live" được xác nhận ở mức hợp đồng: FE không có chế độ mock riêng (xem README, chỉ có `MOCK_*` trong contracts), nên smoke gọi API bằng đúng schema FE dùng; không dựng trình duyệt. Ghi đè đồng hồ chỉ ảnh hưởng `computeApproveBy`, còn kiểm tra `qr_expires_at` vẫn dùng `now()` của PostgreSQL.

## Verification

**Commands:**
- `pnpm run lint && pnpm run typecheck && pnpm run build` -- expected: thành công
- `pnpm test` -- expected: xanh, smoke Docker bị skip
- `RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test -- smoke-topup` -- expected: xanh (cần Docker)
