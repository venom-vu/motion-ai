# Epic 2 Context: Face Swap một lần bấm, hoàn credit khi lỗi

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng ghép mặt bằng một lần bấm, nhận ảnh kết quả lưu trên R2, tải về hoặc chia sẻ, và được hoàn credit tự động khi hệ thống lỗi. Epic dựng động cơ xử lý Task dùng chung cho Body Retouch (Epic 4) và Motion Control (Epic 5).

## Stories

- Story 2.1: [CONTRACT] Hợp đồng cho tải lên, Task và kết quả
- Story 2.2: [BE] Tải ảnh lên R2 an toàn
- Story 2.3: [BE] Tạo Task Face Swap và xếp vào hàng đợi
- Story 2.4: [BE] Máy trạng thái Task bằng compare-and-set
- Story 2.5: [BE] Worker xử lý Task qua RunningHub
- Story 2.6: [BE] Nhập kết quả về R2 và chốt tiền
- Story 2.7: [BE] Bộ quét Task treo và hạn chót
- Story 2.8: [BE] Ưu tiên theo Tier và hết hạn hàng đợi FREE
- Story 2.9: [BE] Chia sẻ kết quả bằng token
- Story 2.10: [FE] Thành phần tải ảnh có cam kết ToS
- Story 2.11: [FE] Trang Face Swap và tiến trình xử lý
- Story 2.12: [FE] Trang kết quả và lịch sử Task
- Story 2.13: [FE] Trang chia sẻ công khai có Open Graph
- Story 2.14: [INTEGRATION] Nối FE với BE và smoke test Face Swap

## Requirements & Constraints

- Ảnh đầu vào: JPG/PNG/WebP, tối đa 10 MB, cạnh ngắn ≥ 512 px, tỷ lệ 1:2 đến 2:1; một schema duy nhất cho FE và BE.
- Face Swap giá 100 credit, do server quyết định, không nhận từ client. Tạo Task bắt buộc `consent` đúng và `tos_version`.
- Tối đa 3 Task `queued`/`running` mỗi người dùng; tối đa 10 file `in-raw/` chưa xác nhận.
- Mọi lỗi sau HOLD là `failed` (hoặc `timed_out`/`cancelled`) và RELEASED 100%; không có trạng thái `rejected`.
- Kết quả lưu trên R2, không lộ link CDN RunningHub; ảnh kết quả ghi EXIF `Software: AI Generator`. `sourceUrl` có thể rỗng khi ảnh gốc quá 7 ngày.
- Thông báo lỗi tiếng Việt sinh từ `reasonCode`, có thể ghi đè theo pipeline.

## Technical Decisions

- Trạng thái Task: `queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`; chuyển chỉ qua compare-and-set.
- Khóa R2 do server sinh: `in-raw/<userId>/<uuid>` → `in/<userId>/<uuid>` → `out/<userId>/<uuid>`; tải lên trực tiếp bằng presigned PUT rồi `confirm`.
- Vị trí hàng đợi tính từ CSDL theo `(priority, queued_at)`; Priority lấy từ Tier Snapshot.
- Chia sẻ bằng token ngẫu nhiên, chỉ lưu hash; `GET /s/{token}` không cần đăng nhập, chuyển hướng tới URL ký.
- RunningHub được giả ở `RunningHubPort` trong mọi test; `CONTENT_BLOCKED` điền chuỗi lỗi thật ở Epic 6.

## UX & Interaction Patterns

- Thành phần tải ảnh dùng chung: chọn từ camera/thư viện, thanh tiến trình, nút hủy/thử lại, lỗi tiếng Việt.
- Kết quả hiển thị slider Before/After; trang chia sẻ công khai có Open Graph.

## Cross-Story Dependencies

- 2.1 làm trước; sau đó hai luồng song song: BE 2.2→2.9 và FE 2.10→2.13 (chạy trên mock). 2.14 chỉ bắt đầu khi cả hai luồng xong.
- Bảng `tasks` dựng ở 2.3, các story sau thêm cột đúng lúc cần dùng.
