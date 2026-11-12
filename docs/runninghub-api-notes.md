# Ghi chú API RunningHub thật (khung, Story 6.11)

> Người vận hành điền từ kết quả `node scripts/prelaunch/step3-runninghub.mjs` và bước benchmark. Chỉ chép phản hồi **đã che khóa** (script tự thay khóa bằng `***`). Không ghi khóa API, không ghi nội dung nhạy cảm.

Ngày ghi: ____ · Người ghi: ____

## Host

| Mục | Giá trị |
|-----|---------|
| Host dùng (`RUNNINGHUB_API_HOST`, `.ai` hay `.cn`) | |
| Cách xác thực thật (Bearer, `apiKey` trong body, cả hai) | Adapter hiện gửi cả hai |
| Giới hạn tần suất (header `rateLimitHeaders`, tài liệu) | |
| Coin cho mỗi giây GPU thật (đặt `PRELAUNCH_COINS_PER_GPU_SECOND`, mặc định 0,4) | |

## Endpoint số dư (`RH_BALANCE_ENDPOINT`)

| Mục | Giá trị |
|-----|---------|
| Đường dẫn | |
| Phương thức | POST (theo adapter) |
| Tham số gửi | `{"apiKey": "***"}` |
| HTTP status | |
| Phản hồi thô (đã che) | |
| Trường số dư thật | Adapter đọc `data.remainCoins` → `data.coins` → `coins` |
| Adapter đọc đúng (`adapterCoins`)? | |

Nếu trường số dư thật khác, mở story sửa `RunningHubOpenApiAdapter.getBalance()` (`apps/api/src/modules/tasks/runninghub-openapi.adapter.ts`).

## Endpoint hủy task

| Mục | Giá trị |
|-----|---------|
| Tồn tại? | |
| Đường dẫn / tham số / phản hồi | |

`RunningHubPort` không có thao tác hủy và kiến trúc (spine) không phụ thuộc vào việc hủy. Ghi kết quả ở đây; không thêm code hủy trong MVP.

## Chuỗi lỗi thật (từ benchmark)

Ghi nguyên văn chuỗi hoặc mã lỗi JSON (đã loại nội dung nhạy cảm). Sau khi ghi, cập nhật `RH_FAILURE_PREFIX_MAP`, `RH_BUDGET_KEYWORDS`, `RH_CONTENT_BLOCKED_PREFIXES` trong `apps/api/src/modules/pipelines/pipeline-config.ts` và thêm fixture kiểm thử (story riêng). `RH_CONTENT_BLOCKED_PREFIXES` giữ rỗng cho tới khi có chuỗi thật.

| Lỗi | Pipeline | Chuỗi / mã thô | Ánh xạ đề xuất |
|-----|----------|----------------|----------------|
| Không thấy mặt | | | `NO_FACE` |
| Không thấy dáng người | | | `NO_POSE` |
| Hết tiền / số dư | | | `RH_BUDGET` |
| Nội dung bị chặn | | | `CONTENT_BLOCKED` |

Nếu node lọc không chặn ảnh nhạy cảm nào: ghi **"không có lớp lọc nội dung"** ở đây, trong `docs/prelaunch-report.md` và PRD §9.

## Đầu ra Motion thật

| Mục | Giá trị |
|-----|---------|
| Độ phân giải | |
| Hướng (dọc/ngang) | |
| FPS | |
| Workflow Motion có báo `NO_FACE`? | |
