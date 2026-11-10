# Epic 5 Context: Motion Control

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Người dùng cho nhân vật trong ảnh chuyển động theo video mẫu: tải video, cắt đoạn bằng thanh Trim bước 1 giây, thấy giá theo thời gian thực và nhận video MP4 kết quả. Thời lượng tối đa theo Tier (FREE 5, Starter 10, Pro 15, Creator 20 giây). Epic dùng lại động cơ Task, ví, hàng đợi, cổng đồng thời RunningHub, bộ quét và khôi phục của Epic 2; chỉ thêm bước chuẩn bị ffmpeg và pipeline Motion. Cần Epic 2 xong; độc lập với Epic 3 và 4.

## Stories

- Story 5.1: [CONTRACT] Hợp đồng cho Motion Control
- Story 5.2: [BE] Tải video lên và kiểm tra bằng ffprobe
- Story 5.3: [BE] Tạo Task Motion Control và tính giá phía server
- Story 5.4: [BE] Cắt video bằng ffmpeg ở bước chuẩn bị của worker
- Story 5.5: [BE] Gửi Task Motion lên RunningHub
- Story 5.6: [BE] Nhập kết quả video, ảnh bìa và chia sẻ
- Story 5.7: [FE] Tải video mẫu và thanh Trim
- Story 5.8: [FE] Trang Motion Control, giá trực tiếp và kết quả video
- Story 5.9: [INTEGRATION] Nối FE với BE và smoke test Motion Control

## Requirements & Constraints

- Giá Motion = 50 credit × số giây nguyên, do server quyết định; backend dùng `ffprobe` đo lại độ dài thật, không tin client. Dung sai ±0,5 giây của file đầu ra không đổi credit đã giữ, không hoàn phần lẻ.
- Cap theo Tier Snapshot lúc bấm Tạo, server quyết định; độ dài Trim từ 3 giây đến Cap, bước 1 giây, nằm trong video.
- Video MP4/MOV, tối đa 100 MB. Mọi lỗi sau HOLD (`NO_POSE`, `NO_FACE`…) là `failed` và RELEASED 100%; `PREP_TIMEOUT` luôn là `timed_out`. `ApiErrorCode` không thêm giá trị mới.
- Kết quả là MP4 kèm ảnh bìa; `sourceUrl` của Motion luôn rỗng; link chia sẻ không lộ video mẫu.

## Technical Decisions

- Workflow ID đọc từ `RUNNINGHUB_WORKFLOW_MOTION`. Cùng hàng đợi chung, 2 Lane, Priority rồi FIFO.
- Hạn chuẩn bị 120 giây (gồm chờ khóa ffmpeg, tải R2, cắt); hạn xử lý video 360 giây tính từ lúc bắt đầu tải input lên RunningHub.
- ffmpeg do worker chạy: re-encode libx264 preset veryfast, 24 FPS, `nice` thấp; một khóa trong tiến trình worker nên mỗi lúc chỉ một ffmpeg.
- `ffprobe`/`ffmpeg` gọi bằng mảng đối số, không qua shell, không ghép khóa hay tên file người dùng vào lệnh.
- Hằng số 50 phía mã nguồn chỉ nằm ở `motionPrice(seconds)` trong `packages/contracts`; nguồn giá thật là cấu hình server (`GET /config/pricing`).
- RunningHub luôn được giả ở `RunningHubPort` trong test; đo tải ffmpeg trên VPS thuộc Epic 6.

## UX & Interaction Patterns

- Trang `/motion-control`: tải ảnh nhân vật và video mẫu, thanh Trim bước 1 giây, giá cập nhật thời gian thực, kết quả là video có ảnh bìa.
- Thông báo `NO_POSE`/`NO_FACE` riêng cho pipeline Motion; không emoji trong UI.

## Cross-Story Dependencies

- 5.1 làm trước; BE 5.2 → 5.3 → 5.4 → 5.5 → 5.6 và FE 5.7 → 5.8 (trên mock) song song; 5.9 chỉ bắt đầu khi cả hai luồng xong, epic chỉ triển khai thật sau 5.9.
- Phụ thuộc Epic 2: `tasks.create`, nhập kết quả (2.6), bộ quét (2.7), chia sẻ (2.9), thành phần FE tải ảnh (2.10).
