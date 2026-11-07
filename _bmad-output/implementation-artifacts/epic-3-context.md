# Epic 3 Context: Nạp credit bằng VietQR

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng nạp credit bằng chuyển khoản VietQR và được lên Tier theo gói nạp; Admin nhận thông báo Discord và duyệt đơn trên dashboard sau khi đối chiếu ngân hàng. Epic tạo đường thu tiền duy nhất của MVP, đảm bảo mỗi giao dịch chỉ cộng credit một lần và mọi thao tác Admin truy vết được. Chỉ cần Epic 1, không phụ thuộc Epic 2.

## Stories

- Story 3.1: [CONTRACT] Hợp đồng cho nạp tiền và duyệt đơn
- Story 3.2: [BE] Tạo đơn nạp và mã VietQR
- Story 3.3: [BE] Xác nhận chuyển khoản, hạn QR và hạn duyệt
- Story 3.4: [BE] Thông báo Discord cho Admin
- Story 3.5: [BE] Duyệt và từ chối đơn, nhật ký Admin
- Story 3.6: [FE] Trang nạp credit và theo dõi đơn
- Story 3.7: [FE] Dashboard Admin duyệt đơn nạp
- Story 3.8: [INTEGRATION] Nối FE với BE và smoke test nạp tiền

## Requirements & Constraints

- Gói nạp: Starter 49.000 VNĐ = 5.000 credit, Pro 99.000 = 12.000, Creator 199.000 = 30.000. Lấy từ `GET /config/pricing`, không hardcode nơi khác; số tiền luôn do server quyết định, không nhận từ client.
- Người dùng phải tích cam kết ToS (`consent`) cho mỗi lần nạp; thiếu thì `CONSENT_REQUIRED`. Phiên bản ToS lưu vào đơn. Tài khoản bị khóa nhận `ACCOUNT_LOCKED`.
- Mỗi người dùng tối đa 3 đơn đang mở (`awaiting_transfer`, `pending`, `needs_review`), vượt thì `TOPUP_LIMIT`. Route ghi có rate limit (`RATE_LIMITED`).
- Mã QR hết hạn sau 15 phút nếu chưa bấm "Đã chuyển khoản". Đơn đã `pending` không bao giờ tự `expired` hay `rejected`, chỉ chờ Admin.
- Hạn duyệt `approve_by` = 15 phút sau thời điểm đầu tiên nằm trong khung 08:00–23:00 giờ Việt Nam (UTC+7). Ví dụ: 10:00 → 10:15; 23:30 → 08:15 hôm sau; 07:00 → 08:15; 22:50 → 23:05 (áp dụng nguyên văn). Cách tính biên khung là `[ASSUMPTION]`.
- Mọi lần duyệt (kể cả đơn `expired`) bắt buộc `bank_ref` duy nhất, trùng thì `BANK_REF_DUPLICATE`; từ chối bắt buộc `reject_reason`; thao tác sai trạng thái thì `TOPUP_STATE_INVALID`. Đơn `approved`/`rejected` là cuối.
- Thông tin tài khoản nhận tiền (mã ngân hàng, số tài khoản, tên chủ tài khoản) và địa chỉ Discord webhook lấy từ biến môi trường, có `.env.example`; giá trị chưa được cung cấp `[ASSUMPTION]`.
- Route `/admin/**` chỉ role `admin` (401/403 với người khác).
- Thông báo Discord không chứa email, token hay thông tin tài khoản nhận tiền.

## Technical Decisions

- Trạng thái đơn: `awaiting_transfer` → `pending` → `approved` | `rejected` | `needs_review`; `awaiting_transfer` → `expired`; `needs_review` ↔ `pending` (return-to-pending) hoặc → `rejected`; `expired` chỉ duyệt qua `approve-expired`.
- Mọi chuyển trạng thái là UPDATE có điều kiện (compare-and-set); người dùng xác nhận và bộ quét hết hạn chạy đồng thời thì đúng một bên thắng. Xác nhận lặp lại là idempotent, không lỗi.
- Bảng `topups` (tạo ở 3.2) chỉ module `topups` được ghi; bảng `admin_audit` (tạo ở 3.5) chỉ service `audit` ghi. Thêm khóa ngoại `ledger_entries.topup_id` → `topups`. `code` ngẫu nhiên khó đoán, duy nhất, va chạm thì sinh lại; nội dung chuyển khoản `NAP <code>`.
- Duyệt (AD-16): `topups` mở transaction, CAS sang `approved`, lưu `bank_ref`, gọi `wallet.topup(tx, userId, topupId, amount, pack)` (bút toán `TOPUP`, unique theo `topup_id`), `wallet` tính lại Tier và `tier_pack` trong cùng transaction, rồi ghi `admin_audit` qua `audit`. Duyệt song song chỉ cộng một lần (test trên PostgreSQL thật). Lỗi P2002 trong luồng ví rollback toàn bộ transaction.
- Tier tính ở một nơi (`wallet`): Creator được duyệt thì có Priority 1 ngay.
- `qrPayload` sinh cục bộ theo chuẩn VietQR/EMVCo, có CRC hợp lệ, không gọi dịch vụ ngoài; thư viện dựng ảnh QR ở FE do người triển khai chọn `[ASSUMPTION]`.
- Công việc định kỳ dùng `@nestjs/schedule` trong worker (cùng chu kỳ bộ quét): đổi `awaiting_transfer` quá hạn sang `expired`; gửi lại thông báo `pending` còn `notified_at` rỗng (tối đa 5 lần mỗi đơn); gửi đúng một cảnh báo quá `approve_by` (`overdue_notified_at`).
- Thông báo qua `NotifierPort` với adapter Discord webhook (thay adapter log của Story 1.7, nên cảnh báo đối soát sổ cái cũng đi qua Discord). Discord lỗi không làm hỏng xác nhận của người dùng; `notified_at` đặt sau khi gửi thành công. Test dùng máy chủ HTTP giả.
- Hợp đồng (`packages/contracts`): enum trạng thái đơn, enum gói, bốn mã lỗi mới (`TOPUP_LIMIT`, `BANK_REF_DUPLICATE`, `TOPUP_STATE_INVALID`, `TOPUP_QR_EXPIRED`), schema request/response dùng chung, bảng ánh xạ thông báo tiếng Việt (ví dụ `pending` = "Đang chờ duyệt", `needs_review` = "Cần xem xét"), mock cho mọi trạng thái. Endpoint người dùng: `POST /topups`, `POST /topups/{id}/confirm-transfer`, `GET /topups`, `GET /topups/{id}`. Endpoint Admin: `GET /admin/topups`, `approve`, `approve-expired`, `reject`, `needs-review`, `return-to-pending`.

## UX & Interaction Patterns

- Trang `/topup` và `VietQRModal`: ba gói, ô cam kết ToS, ảnh QR, số tiền, nội dung chuyển khoản có nút sao chép, thông tin tài khoản nhận, đồng hồ đếm ngược dựa trên `qr_expires_at` của server (không dùng đồng hồ máy). Hết hạn thì hiện "Mã đã hết hạn", vô hiệu nút "Đã chuyển khoản", có nút tạo mã mới. Nút xác nhận chỉ gọi một lần dù bấm nhiều lần.
- Đơn `pending` ngoài khung giờ có dòng giải thích sẽ duyệt từ 08:00 sáng hôm sau. `approved` cập nhật số dư và Tier trên tiêu đề; `rejected`/`needs_review`/`expired` hiển thị lý do, hướng dẫn liên hệ, nút tạo đơn mới. Danh sách đơn: mới nhất trước, tải thêm khi cuộn, có trạng thái rỗng và lỗi.
- Modal nạp mở tại chỗ khi thiếu credit và giữ nguyên dữ liệu đang thao tác; theo CLAUDE.md và DESIGN/EXPERIENCE mới nhất thì dùng Centered Dialog, không dùng Bottom Sheet (câu trong Story 3.6 nhắc Bottom Sheet đã cũ). Icon Lucide (`lucide:copy`, `lucide:clock`, `lucide:x`, `lucide:check`), không emoji, vùng chạm tối thiểu 48px, dùng được ở 360px. Mockup: `ux-designs/ux-motion-ai-2026-11-01/mockups/vietqr-modal.html`.
- Dashboard `/admin/topups`: bộ lọc trạng thái (mặc định `pending`), nhãn nổi bật cho đơn quá `approve_by`, form Duyệt bắt buộc `bank_ref` (hiện số tiền cần đối chiếu, xác nhận trước khi gửi, chống gửi nhiều lần), form Từ chối bắt buộc lý do, lối duyệt riêng có cảnh báo cho đơn `expired`, tự làm mới khi đơn đã bị Admin khác đổi. Desktop dùng Left Sidebar 220px phong cách Vercel; mobile xếp thẻ 1 cột. Mockup: `mockups/desktop-vietqr-admin.html`.
- FE chạy trên mock trước, rồi chuyển sang chế độ `live` ở Story 3.8.

## Cross-Story Dependencies

- 3.1 làm trước; sau đó hai luồng song song: BE 3.2 → 3.3 → 3.4 → 3.5 và FE (mock) 3.6 → 3.7. Story 3.8 chỉ bắt đầu khi cả hai luồng xong.
- Phụ thuộc Epic 1: `wallet` (ledger append-only, tính Tier), auth/role admin, `GET /me`, `GET /config/pricing`, `NotifierPort` (adapter log Story 1.7), job đối soát sổ cái, `@nestjs/throttler`, mã lỗi chung.
- 3.4 cần trạng thái `pending` từ 3.3; 3.5 cần `audit` và `wallet.topup` của Epic 1; 3.8 kiểm tra đối soát sổ cái không lệch và test hợp đồng khớp schema ở CI.
