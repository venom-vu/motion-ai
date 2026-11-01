# Đối chiếu memlog với prd.md + addendum.md

Đầu vào: `.memlog.md` (35 mục). Đối chiếu với `prd.md` và `addendum.md`. Không sửa PRD.

## Kết luận chung
Phần lớn quyết định và con số đã có trong PRD: giá và gói, định mức 100/100/50 mỗi giây, Cap và Priority, quy tắc rơi Tier, 500 credit, device fingerprint, IP 3 tài khoản/24h, VietQR, lưu trữ 7/30 ngày, ngân sách USD 50–100, SM-1..SM-4, đối tượng người dùng, biên gộp, benchmark. Có 5 khoảng hở hoặc mâu thuẫn bên dưới.

## Khoảng hở / mâu thuẫn

### G1. Addendum lỗi thời, mâu thuẫn memlog và PRD (mâu thuẫn)
- Memlog (mục 27 và 32) đã chốt: IP tối đa 3 tài khoản nhận credit mỗi 24 giờ; tài khoản thứ 4 trở đi bắt đầu với 0 credit. PRD FR-11 đã ghi đúng.
- `addendum.md` mục "Chống lạm dụng" vẫn ghi "ngưỡng chưa chốt".
- Addendum mục "Mô hình chi phí" vẫn giữ lưu ý "74/412 ... không khớp con số >82% / >65% ... cần xác nhận lại". Memlog (mục 32) đã chốt mốc 91% và 82%, và PRD §11 đã giải quyết.
- Addendum dòng đầu nói "phần bị lỗi hiển thị được ghi rõ là chưa xác nhận". Nhiều mục nay đã chốt (timeout, giới hạn dung lượng, trần GPU-giây, dung sai ±0,5 giây, hoàn tiền).
- Addendum mục "Workflow RunningHub" vẫn viết "Chưa có số liệu thực đo". Điều này đúng, nhưng nên trỏ sang benchmark §12.
- Đề xuất: cập nhật addendum cho khớp PRD, hoặc ghi chú addendum chỉ là lịch sử.

### G2. Rủi ro lạm dụng free-tier và ngân sách đốt đã bị bỏ khỏi §9 (ý định tính chất bị rơi)
- Memlog (mục 20) đánh dấu mơ hồ: đăng ký nhiều tài khoản Google × 500 credit so với trần đốt USD 50–100.
- Mục 20 cũng nêu hai ẩn số: chi phí mỗi lần chạy RunningHub và giới hạn concurrency của tài khoản RunningHub.
- PRD §9 chỉ còn 2 câu hỏi mở (benchmark và ToS) và §10 viết "mọi giả định đã chốt".
- Chưa có nơi nào ghi:
  - số lượng tài khoản trial tối đa mà ngân sách chịu được (ví dụ, 500 credit ≈ 5 ảnh ≈ 85–140 VNĐ mỗi tài khoản, nên cần ước tính số tài khoản trial so với trần);
  - giả định 2 Lane (concurrency) cần xác nhận với giới hạn thật của RunningHub; benchmark §12 không đo điều này.
- Lý do bỏ "trần toàn cục" được ghi ở addendum nhưng không có cơ chế bù: FR-16 chỉ cảnh báo khi RunningHub còn dưới 20% ngân sách.
- Đề xuất: thêm vào §9 hoặc §12 một mục xác nhận concurrency limit và kịch bản trial-abuse.

### G3. Hàng đợi và Priority chỉ định nghĩa cho Motion Control (có thể bỏ sót)
- Memlog (mục 13 và 33): FREE (Priority 10) chỉ chạy khi không còn Task trả phí nào trong hàng đợi, không có Lane riêng. Quyết định này nói chung về tài khoản và Tier, không giới hạn ở video.
- PRD FR-7 chỉ áp dụng quy tắc cho "Task Motion Control". FR-1 và FR-3 (Face Swap, Body Retouch) không nói ảnh có đi qua cùng hàng đợi 2 Lane hay có Priority hay không.
- Đề xuất: làm rõ trong FR-7 hoặc §6 rằng cả 3 Pipeline dùng chung hàng đợi.

### G4. Mâu thuẫn nội bộ PRD về Pre-check và credit (mâu thuẫn so với memlog)
- Memlog (mục 11 và 30): Pre-check chặn "trước khi tính phí / trước khi GPU".
- PRD FR-18 và §6 đặt Pre-check trước khi Hold và không tính phí.
- Bảng lỗi §4.5 lại ghi hàng "Pre-check vi phạm nội dung → Release 100%", và FR-14 cũng cho `rejected` đi Release. Điều này ngụ ý đã có Hold trước đó, trái với §6.
- Đề xuất: thống nhất là không Hold khi `rejected` ở Pre-check, hoặc nêu rõ Pre-check xảy ra sau Hold.

### G5. Chi tiết thanh toán VietQR không hoàn chỉnh (đã bị đánh dấu "garbled")
- Memlog (mục 9) ghi chi tiết VietQR bị lỗi và "cần xác nhận".
- Memlog mục 16 chốt luồng chính: QR động, nội dung `NAP <MA_GIAO_DICH>`, bấm "Đã chuyển khoản", admin duyệt.
- PRD không nêu:
  - thời hạn hiệu lực của mã giao dịch/QR;
  - SLA duyệt của admin;
  - xử lý khi người dùng chuyển nhưng không bấm "Đã chuyển khoản";
  - trạng thái giao dịch hết hạn.
- Chỉ có trạng thái `pending` và "Cần xem xét". Chưa có dữ liệu trong memlog về các điểm này, nên chỉ ghi nhận là chưa rõ, không phải PRD bỏ sót.

## Đã đối chiếu, không có khoảng hở
Giá và gói; credit không hết hạn; định mức; Cap/Priority; quy tắc rơi và giữ Tier; 500 credit/Google; device fingerprint; IP 3/24h; tolerance ±0,5s; thời hạn lưu 7/30 ngày; moderation nsfwjs + client; ToS lúc đăng ký/nạp/tải; timeout 180/360s; dung lượng 10/100 MB; resize 2048 px; mã hóa đầu ra 720p/24FPS; cảnh báo 15%/30 phút; SM-1..4 (SM-3 là 90%); trần đốt USD 50–100; đối tượng VN-only và phương án thay thế 30–100k / 50–150k; InsightFace, DWPose, FR-20; SLA Face Swap 60s; không hoàn credit khi chất lượng kém; trần voucher 15%; benchmark 20 tác vụ (biên Creator ≥70%, lỗi 0%).
