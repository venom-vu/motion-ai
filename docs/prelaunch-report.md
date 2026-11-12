# Báo cáo cổng trước khi bật VietQR thương mại (Story 6.11)

> Mẫu. Người vận hành điền sau khi chạy `scripts/prelaunch/` theo `docs/prelaunch-checklist.md`. Dán nguyên dòng JSON mỗi script in ra vào cột "Bằng chứng" (đã che bí mật, không dán khóa API, webhook hay JWT).
>
> **Không bật VietQR thương mại khi còn dòng "Chưa đạt" hoặc "Chưa chạy" mà chưa có quyết định chấp nhận rủi ro bằng văn bản của PM.**

Kết quả: `Đạt` / `Không đạt` / `Chấp nhận rủi ro` / `Chưa chạy`.

## Thông tin chung

| Mục | Giá trị |
|-----|---------|
| Commit / image triển khai | |
| VPS (cấu hình CPU/RAM/đĩa) | |
| Host RunningHub (`.ai` / `.cn`) | |
| Ngưỡng đã ghi đè (`PRELAUNCH_*`) | Mặc định |

## Năm bước tự động

| # | Bước | Kết quả | Số liệu chính | Bằng chứng (JSON) | Ngày | Người chạy |
|---|------|---------|---------------|-------------------|------|------------|
| 1 | Discord nhận tin ≤ 10 s | Chưa chạy | `latencyMs` = | | | |
| 2 | ffmpeg cắt clip 20 s 1080p | Chưa chạy | `trimMs` = ; CPU max = ; đĩa tạm max = ; `/health` p95 = ; restart = ; OOM = | | | |
| 3 | Endpoint số dư RunningHub | Chưa chạy | host = ; endpoint = ; HTTP = ; `adapterCoins` = | | | |
| 4 | Benchmark 20 mẫu | Chưa chạy | biên Creator nạp lẻ FS/BR/MC = / / ; lỗi kỹ thuật = | | | |
| 4b | Mẫu nhạy cảm (không tính vào 20) | Chưa chạy | chuỗi lỗi / "không có lớp lọc nội dung" | | | |
| 5 | Sao lưu R2 + restore-drill | Chưa chạy | RTO (`rtoMs`) = ; `checked` = | | | |

## Chi tiết benchmark (bước 4)

Giây GPU = `gpu_coins` / số coin mỗi giây GPU (`PRELAUNCH_COINS_PER_GPU_SECOND`, mặc định 0,4). Sai số độ dài ngưỡng ±0,5 s. Face Swap ghi kèm SLA 60 s (không chặn tự động).

| Mẫu | Pipeline | Tham số | Trạng thái / reasonCode | `gpu_coins` | Giây GPU | Giây GPU / giây video | Sai số độ dài (s) | `running_at`→`finished_at` (s) | SLA 60 s (FS) | Xem nửa sau (≥ 15 s) |
|-----|----------|---------|-------------------------|-------------|----------|-----------------------|-------------------|-------------------------------|---------------|----------------------|
| face-1 | face_swap | góc nghiêng | | | | – | – | | | – |
| face-2 | face_swap | góc nghiêng | | | | – | – | | | – |
| face-3 | face_swap | đủ sáng | | | | – | – | | | – |
| face-4 | face_swap | đủ sáng | | | | – | – | | | – |
| face-5 | face_swap | bán thân | | | | – | – | | | – |
| body-1 | body_retouch | intensity 3 | | | | – | – | | – | – |
| body-2 | body_retouch | intensity 3 | | | | – | – | | – | – |
| body-3 | body_retouch | intensity 5 | | | | – | – | | – | – |
| body-4 | body_retouch | intensity 5 | | | | – | – | | – | – |
| body-5 | body_retouch | intensity 8 | | | | – | – | | – | – |
| motion-1 | motion_control | 3 s | | | | | | | – | – |
| motion-2 | motion_control | 3 s | | | | | | | – | – |
| motion-3 | motion_control | 5 s | | | | | | | – | – |
| motion-4 | motion_control | 5 s | | | | | | | – | – |
| motion-5 | motion_control | 5 s | | | | | | | – | – |
| motion-6 | motion_control | 10 s | | | | | | | – | – |
| motion-7 | motion_control | 10 s | | | | | | | – | – |
| motion-8 | motion_control | 15 s | | | | | | | – | |
| motion-9 | motion_control | 15 s | | | | | | | – | |
| motion-10 | motion_control | 20 s | | | | | | | – | |

Task `failed`: ghi `reasonCode` và chuỗi lỗi thô (`rawFailure`) tại đây.

| Mẫu | reasonCode | Chuỗi lỗi thô RunningHub |
|-----|------------|--------------------------|
| | | |

### Điều kiện thông qua (PRD §12)

| Điều kiện | Kết quả | Ghi chú |
|-----------|---------|---------|
| Biên gộp Creator, kịch bản nạp lẻ ≥ 70% ở mọi pipeline (`/admin/stats?scope=benchmark`) | | |
| Tỷ lệ lỗi kỹ thuật trên 20 mẫu = 0% | | |
| Sai số độ dài Motion trong ±0,5 s | | |
| Clip 15/20 s: nửa sau không biến dạng mặt, không trôi cơ thể (xem thủ công) | | |

### Kế hoạch B (nếu không đạt)

| Phương án (giá Motion / credit gói) | Biên Creator nạp lẻ tính lại | Quyết định PM |
|-------------------------------------|------------------------------|---------------|
| | | |

## Phát hiện về workflow thật

| Mục | Giá trị thật | Khớp giả định? | Hành động |
|-----|--------------|----------------|-----------|
| Chuỗi lỗi `NO_FACE` | | | |
| Chuỗi lỗi `NO_POSE` | | | |
| Chuỗi lỗi hết tiền RunningHub | | | |
| Chuỗi lỗi nội dung bị chặn (`CONTENT_BLOCKED`) | | | Điền `RH_CONTENT_BLOCKED_PREFIXES` + fixture |
| Workflow Motion có báo `NO_FACE`? | | | |
| Độ phân giải / hướng video đầu ra Motion | | | Cập nhật Story 5.6/PRD nếu khác |

## Mục duyệt thủ công

| Mục | Kết quả | Ngày | Người duyệt | Ghi chú |
|-----|---------|------|-------------|---------|
| Tên miền và DNS ở Cloudflare | Chưa chạy | | | |
| Origin CA + SSL Full (strict) | Chưa chạy | | | |
| `ufw` chỉ nhận IP Cloudflare; truy cập thẳng IP bị từ chối | Chưa chạy | | | |
| `CF-Connecting-IP` giả mạo bị bỏ qua | Chưa chạy | | | |
| Preset Nitro (Story 1.4), FE chạy trên Cloudflare Pages | Chưa chạy | | | |
| Lifecycle R2 (`in-raw/` 1 ngày, `in/` 7 ngày, `out/` 30 ngày) và CORS chỉ miền FE | Chưa chạy | | | |
| Biến môi trường đủ (`ADMIN_EMAILS`, workflow ID, tài khoản nhận tiền, webhook Discord, `NUXT_PUBLIC_REPORT_EMAIL`, `BENCHMARK_USER_EMAILS`) | Chưa chạy | | | |
| Ví RunningHub nạp trong trần USD 50–100 | Chưa chạy | | | |
| `/terms`, `/privacy` `status: 'final'` sau tư vấn pháp lý | Chưa chạy | | | |
| Cam kết ToS độ tuổi 18 và quyền hình ảnh (FR19) | Chưa chạy | | | |
| Sao lưu 03:00 đã chạy ít nhất một đêm | Chưa chạy | | | |

## Quyết định chấp nhận rủi ro

| Dòng | Rủi ro | Lý do chấp nhận | Người quyết định | Ngày |
|------|--------|-----------------|------------------|------|
| | | | | |

## PM xác nhận

- [ ] Mọi dòng ở trạng thái Đạt hoặc có quyết định chấp nhận rủi ro bằng văn bản
- [ ] Phát hiện đã cập nhật ngược vào spine (Deferred), PRD §9 và §12, danh sách ánh xạ cấu hình, `.memlog.md`

PM: ____________________ Ngày: ____________________

Quyết định bật VietQR thương mại: ☐ Bật ☐ Chưa bật
