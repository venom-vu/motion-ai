# Epic 6 Context: Vận hành an toàn, tuân thủ và cổng mở bán

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Admin được bảo vệ ngân sách GPU và có công cụ xử lý vi phạm; hệ thống sẵn sàng bật VietQR thương mại sau khi qua các bước kiểm thử bắt buộc. Epic cần Epic 1–3 (adapter Discord, dịch vụ `audit`, route và giao diện Admin); riêng cổng mở bán (6.11) cần thêm Epic 4–5.

## Stories

- Story 6.1: [CONTRACT] Hợp đồng cho vận hành và quản trị
- Story 6.2: [BE] Ngắt mạch và chặn tạo Task khi tạm dừng
- Story 6.3: [BE] Xử lý hết ngân sách RunningHub và cảnh báo số dư
- Story 6.4: [BE] Khóa tài khoản và cộng bù credit
- Story 6.5: [BE] Gỡ bỏ nội dung khẩn cấp
- Story 6.6: [BE] Thống kê vận hành và nhật ký Admin
- Story 6.7: [BE] Sao lưu PostgreSQL lên R2
- Story 6.8: [FE] Trang vận hành Admin
- Story 6.9: [FE] Chân trang, trang pháp lý và biểu ngữ bảo trì
- Story 6.10: [INTEGRATION] Nối FE với BE và smoke test vận hành
- Story 6.11: [OPS] Cổng VietQR

## Requirements & Constraints

- Ngắt mạch tự tạm dừng nhận Task mới khi tỷ lệ lỗi hệ thống vượt 15% trên 20 Task đủ điều kiện trong cửa sổ 30 phút, hoặc 5 lỗi hệ thống liên tiếp. Lỗi do người dùng/nội dung (`NO_POSE`, `NO_FACE`, `CONTENT_BLOCKED`, `USER_CANCEL`, `FREE_WAIT_EXPIRED`, `RH_BUDGET`, `RH_GATE_TIMEOUT`) bị loại khỏi mẫu số.
- Hết ngân sách RunningHub: Task `failed` với `RH_BUDGET` và RELEASED 100%; đặt `rh_budget_exhausted` và `intake_paused`. Nạp credit, đăng nhập, lịch sử, tải kết quả vẫn hoạt động.
- Admin có thể khóa/mở khóa tài khoản và cộng/trừ bù credit (`ADJUST`, idempotent theo `requestId`, giới hạn `ADMIN_ADJUST_MAX`). Không có đường mã nào tự hoàn credit Task đã `succeeded`.
- Gỡ bỏ nội dung khẩn cấp theo mã Task hoặc liên kết chia sẻ; báo cáo vi phạm chỉ qua `mailto:`, không có form hay ticket (ngoài MVP).
- Thống kê: tỷ lệ thành công, thời gian xử lý (trung bình, p95), chi phí GPU quy VNĐ, biên gộp theo gói và kịch bản nạp, chỉ số SM-1…SM-4; `scope` `real`/`benchmark`.
- Log JSON có `taskId`, `userId`, không chứa email, token hay khóa bí mật (NFR7).
- Sao lưu PostgreSQL hằng đêm lên R2, giữ 7 bản, có script restore-drill. `ApiErrorCode` không thêm giá trị mới; lý do mới đi qua `VALIDATION_FAILED.details.reason`.
- Cảnh báo Discord theo thay đổi trạng thái, không gửi lặp; thử lại tối đa 5 lần. Lập lịch theo `Asia/Ho_Chi_Minh`.

## Technical Decisions

- Bảng `settings` (khóa/giá trị JSON) do module `ops` ghi; `admin_audit.request_id` thêm ở 6.4; `tasks.files_removed_at` thêm ở 6.5, do `tasks` ghi.
- Guard `intake-open` dùng chung gắn vào các route tạo Task; một test duyệt route ở CI fail nếu route "tạo Task" thiếu guard. Server trả 503 `PAUSED`.
- Mỗi bảng chỉ một module ghi: `ops` đọc dữ liệu Task qua hàm của service `tasks`; thống kê đọc qua `tasks`, `wallet`, `topups`. `wallet.adjust(tx, …)` ghi sổ cái và tính lại Tier trong cùng transaction.
- Guard khóa tài khoản đọc `locked_at` từ CSDL, không từ JWT (`ACCOUNT_LOCKED`).
- `RunningHubPort.getBalance()` có adapter giả; adapter thật đọc `RH_BALANCE_ENDPOINT`. Ngưỡng cảnh báo `RH_BALANCE_ALERT_COINS` mặc định 27.000.
- Gỡ nội dung do `storage` điều phối: thu hồi token chia sẻ, xóa khóa `in/` và `out/` trên R2, rồi `tasks` đặt `files_removed_at`; idempotent và chạy lại được khi R2 xóa lỗi một phần.
- Sao lưu chạy chỉ trong tiến trình `worker` (`pg_dump` custom format, mảng đối số cố định), vẫn đúng bốn container.

## UX & Interaction Patterns

- Trang `/admin/ops` (Left Sidebar Admin phong cách Vercel): thẻ trạng thái, nút "Mở lại nhận Task" có hộp xác nhận, bảng thống kê, tra cứu tài khoản, gỡ nội dung, nhật ký.
- Chân trang với `/terms`, `/privacy`, "Báo cáo vi phạm" (`mailto:`); biểu ngữ "Hệ thống đang bảo trì, tạm dừng nhận tác vụ mới" ở các trang tạo Task. Thông báo tiếng Việt cho các `details.reason` mới; viewport 360 px; không emoji.

## Cross-Story Dependencies

- 6.1 làm trước; luồng BE 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → 6.7 và luồng FE (trên mock) 6.8 → 6.9 song song; 6.10 chỉ bắt đầu khi cả hai xong; 6.11 làm cuối với người vận hành thật.
- Phụ thuộc: adapter Discord (3.4), `audit` và route Admin (3.5), giao diện Admin (3.7), bộ quét (2.7), chia sẻ (2.9), cấu hình ánh xạ lỗi RunningHub (2.5).
