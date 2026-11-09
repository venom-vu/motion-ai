# Epic 4 Context: Body Retouch

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng chỉnh dáng ảnh theo mức `intensity` 1–10 bằng một lần bấm và xem so sánh trước/sau. Epic dùng lại động cơ Task, ví, hàng đợi, kết quả và chia sẻ của Epic 2, chỉ thêm pipeline `body_retouch`. Cần Epic 2 xong; độc lập với Epic 3.

## Stories

- Story 4.1: [CONTRACT] Hợp đồng cho Body Retouch
- Story 4.2: [BE] Tạo Task Body Retouch
- Story 4.3: [BE] Kết quả Body Retouch
- Story 4.4: [FE] Trang Body Retouch và thanh mức điều chỉnh
- Story 4.5: [FE] So sánh trước/sau
- Story 4.6: [INTEGRATION] Nối FE với BE và smoke test Body Retouch

## Requirements & Constraints

- Giá 100 credit do server quyết định; mọi chuyển trạng thái và bút toán đi qua `tasks.transition` và `wallet`, không có đường riêng cho Body Retouch.
- `intensity`: số nguyên 1–10, mặc định 5, một schema dùng chung FE/BE; ngoài khoảng hoặc không nguyên là `VALIDATION_FAILED`.
- Nhãn ba vùng: 1–3 "Uốn nhẹ dáng", 4–7 "Tự nhiên", 8–10 "Đường cong tối đa".
- Lỗi không thấy người dùng lại mã `NO_POSE` (không thêm mã mới); thông báo theo pipeline: "Không tìm thấy người trong ảnh. Vui lòng chọn ảnh có người rõ thân." Motion Control có thông báo `NO_POSE` khác (Epic 5).
- Kết quả phải cùng kích thước ảnh đầu vào, lệch thì `OUTPUT_INVALID` và RELEASED. `sourceUrl` rỗng khi ảnh gốc quá 7 ngày; link chia sẻ không bao giờ lộ ảnh gốc.
- Pipeline dễ chạm bộ lọc nội dung RunningHub nhất (nhất là `intensity` 8–10); ánh xạ `CONTENT_BLOCKED` do Epic 6 điền.

## Technical Decisions

- Workflow ID đọc từ `RUNNINGHUB_WORKFLOW_BODY_RESHAPE`; thiếu thì `api` và `worker` không khởi động.
- Cùng một hàng đợi chung, 2 Lane, Priority rồi FIFO với Face Swap; cùng đường poll, hạn chót 180 giây, bộ quét.
- `intensity` lưu trong `params` của Task, truyền cho workflow theo tên node khai báo trong cấu hình pipeline.
- `POST /tasks/body-retouch` nhận khóa ảnh `in/`, `intensity`, `consent`; trả Task cùng hình dạng `POST /tasks/face-swap`. Các endpoint đọc/hủy/kết quả/chia sẻ dùng chung.
- RunningHub luôn được giả ở `RunningHubPort` trong test.

## UX & Interaction Patterns

- Trang `/body-retouch`: thành phần tải ảnh dùng chung, thanh trượt bước 1, nhãn vùng, nút "Tạo" hiển thị giá từ `GET /config/pricing`; lối vào cạnh Face Swap.
- Thành phần so sánh trước/sau tái sử dụng được, thao tác bằng bàn phím, núm 36px icon `lucide:arrow-left-right`, không emoji; thiếu `sourceUrl` thì chỉ hiện kết quả kèm "Ảnh gốc đã hết hạn lưu".

## Cross-Story Dependencies

- 4.1 làm trước; sau đó BE 4.2 → 4.3 và FE 4.4 → 4.5 (trên mock) song song; 4.6 chỉ bắt đầu khi cả hai luồng xong.
- Phụ thuộc Epic 2: `tasks.create`, Story 2.6 (nhập kết quả), 2.9 (chia sẻ), 2.10–2.12 (FE).
