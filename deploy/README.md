# Deploy

## Smoke test compose end-to-end

`pnpm test` mặc định bỏ qua test dựng cả stack. Để chạy (cần Docker, build image, mất vài phút):

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test
```

Test dựng project `flowvis-e2e` (cổng api `3101`, Postgres `15432`, Redis `16379`), kiểm tra:
`GET /health` qua cổng publish trả `ok`, bảng `infra_probes` tồn tại (migrate trong container chạy được),
`nestjs-worker` và `nestjs-api` vẫn chạy; luôn `compose down -v` khi kết thúc.

Postgres và Redis chỉ bind `127.0.0.1` trên host.

## Smoke test đăng nhập (Story 1.11)

`apps/api/test/smoke-login.test.mjs` dựng stack bằng `compose.yml` + `compose.smoke.yml` (project `flowvis-smoke`, api `3102`, Postgres `15433`, Redis `16380`), vẫn bốn container. Máy chủ Google giả chạy trong tiến trình test (cổng `3199` trên host); container api tới đó qua `host.docker.internal`. Override đặt `NODE_ENV=test` vì `GOOGLE_TOKEN_URL`/`GOOGLE_USERINFO_URL` bị bỏ qua ở production. Sau kịch bản, test chạy `docker compose exec nestjs-worker node apps/api/dist/scripts/reconcile.js` (thoát 0 nếu không lệch) rồi `down -v`.

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test
```

## Smoke test Face Swap (Story 2.14)

`apps/api/test/smoke-face-swap.test.mjs` dựng stack bốn container (project `flowvis-smoke-fs`, api `3103`, Postgres `15434`, Redis `16381`). RunningHub giả (cổng `3197`), S3/R2 giả (`3198`) và Google giả (`3199`) chạy trong tiến trình test; container tới qua `host.docker.internal`. Ba kịch bản: thành công (500 -> 400, `queued -> running -> succeeded`, CAPTURED, ảnh tải được), `NO_FACE` (failed, RELEASED, số dư về 500), quá hạn (hạn chót ép 10 giây qua `RH_DEADLINE_MS`, `timed_out`, kết quả muộn bị bỏ qua). Thêm chia sẻ (`GET /s/<token>` 302, sau `DELETE` 404), kiểm tra hợp đồng `MOCK_*` và đối soát `reconcile.js`.

Các biến ghi đè `RUNNINGHUB_BASE_URL`, `RH_DEADLINE_MS`, `RESULT_URL_ALLOW_HOSTS` và chế độ path-style của `R2_ENDPOINT` chỉ có tác dụng khi `NODE_ENV=test` (bản thân `R2_ENDPOINT` vẫn là ghi đè tùy chọn ở production) (`test-overrides.test.mjs` chứng minh bị bỏ qua ở production). SLA 60 giây không đo ở đây; thuộc benchmark Epic 6.

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test
```

## Bucket R2 (Story 2.2)

Ảnh tải lên đi thẳng lên R2 bằng presigned PUT. Bucket phải **riêng tư** (không bật public access hay custom domain công khai). Đặt `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (xem `apps/api/.env.example`) rồi chạy thủ công, idempotent:

```bash
pnpm --filter @flowvis/api run build
node --env-file=apps/api/.env apps/api/dist/scripts/configure-bucket.js
```

Script đặt CORS chỉ cho `FRONTEND_URL` (PUT/GET/HEAD) và lifecycle: `in-raw/` xóa sau 1 ngày, `in/` xóa sau 7 ngày. Job worker mỗi giờ chuyển bản ghi `uploads` pending quá 24 giờ sang `expired`.

Presigned PUT ký kèm `Content-Type` và `Content-Length`: client phải PUT đúng `Content-Type` trả về trong `headers` và body có độ dài đúng bằng `sizeBytes` đã khai báo (không dùng chunked/stream), nếu không R2 trả 403.

## Smoke test Body Retouch (Story 4.6)

`apps/api/test/smoke-body-retouch.test.mjs` dựng stack bốn container (project `flowvis-smoke-bd`, api `3105`, Postgres `15436`, Redis `16383`); RunningHub giả (`3197`), S3/R2 giả (`3198`), Google giả (`3199`) chạy trong tiến trình test. Chạy: `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test`. Kịch bản: thành công `intensity` 8 (500 -> 400, RH nhận `smoke-workflow-body-reshape` với node `10/image` và `20/intensity` = `8`, `/result` có `sourceUrl`), `NO_POSE` (failed, RELEASED, thông báo Body Retouch), chung hàng đợi với Face Swap (không quá 2 Task đồng thời, mỗi Task một HOLD và một CAPTURED), ảnh gốc hết hạn (xóa đối tượng `in/` khỏi S3 giả nên `sourceUrl` là `null`), rồi `reconcile.js`. Benchmark Epic 6 phải có ít nhất một ảnh nhạy cảm chạy qua Body Retouch.

## Smoke test nạp tiền (Story 3.8)

`apps/api/test/smoke-topup.test.mjs` dựng stack bốn container (project `flowvis-smoke-tp`, api `3104`, Postgres `15435`, Redis `16382`). Google giả (cổng `3199`) và Discord webhook giả (cổng `3196`) chạy trong tiến trình test. Chạy: `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker). Kịch bản: đường thành công (Discord nhận đúng 1 thông báo, +12.000 credit, Tier Pro, đúng 1 dòng `TOPUP`), `bank_ref` trùng, xác nhận lúc 23:30 giờ VN (`approve_by` 08:15 hôm sau, quá hạn QR vẫn `pending`), QR hết hạn (`expired`, `TOPUP_QR_EXPIRED`), hai Admin duyệt song song, rồi `reconcile.js`.

Biến chỉ có tác dụng khi `NODE_ENV=test` (bị bỏ qua ở production): `TOPUP_QR_TTL_MS` (rút hạn QR), `TOPUP_FAKE_NOW` (ISO, giả đồng hồ tính `approve_by`), `TOPUP_SWEEP_INTERVAL` (chu kỳ bộ quét, ms). Biến cấu hình thật: `TOPUP_BANK_BIN`, `TOPUP_BANK_ACCOUNT_NO`, `TOPUP_BANK_ACCOUNT_NAME`, `DISCORD_WEBHOOK_URL`, `ADMIN_EMAILS` (xem `deploy/.env.example`; giá trị smoke là giả).

Cảnh báo quá hạn duyệt đơn nạp dùng cột `overdue_notify_attempts` (tối đa 5 lượt, giãn 60 giây giữa các lượt); Discord sập kéo dài thì dừng sau lượt thứ 5 và ghi log lỗi. `TOPUP_BANK_BIN` phải đủ 6 chữ số và `TOPUP_BANK_ACCOUNT_NO` 6 đến 19 chữ số, sai định dạng thì tạo/hiển thị đơn trả 500 và ghi log.

## Cắt video bằng ffmpeg (Story 5.4)

Worker cắt video Motion Control ở bước chuẩn bị: một ffmpeg mỗi lúc (khóa FIFO trong tiến trình worker), chạy với `nice -n 19`, thư mục tạm riêng cho từng Task trong `$TMPDIR/flowvis-trim` và xóa khi xong, khi lỗi, khi hủy và khi worker khởi động. Cần đĩa trống tối thiểu 3 lần kích thước video đầu vào. Việc đo CPU và đĩa thật trên VPS 4 vCPU thuộc bước kiểm thử ffmpeg của Epic 6.

## Smoke test Motion Control (Story 5.9)

`apps/api/test/smoke-motion-control.test.mjs` dựng stack bốn container (project `flowvis-smoke-mt`, api `3106`, Postgres `15437`, Redis `16384`); RunningHub giả (`3197`), S3/R2 giả (`3198`), Google giả (`3199`) chạy trong tiến trình test. Cần `ffmpeg` trên máy chạy test (video mẫu và video kết quả giả sinh bằng `ffmpeg -f lavfi`, H.264, 24 FPS, 720x1280). Kiểm tra payload RH giả (`smoke-workflow-motion`, node `1/image`, `2/video`), giá, Cap, ví, hàng đợi, nhập kết quả, chia sẻ, thư mục tạm (`$TMPDIR/flowvis-trim` trong worker phải rỗng) và `reconcile.js`. `RH_DEADLINE_MS` (chỉ có tác dụng khi `NODE_ENV=test`) được rút ngắn để thử quá hạn 360 giây. Epic 6 còn phải xác nhận `nodeId`/`fieldName` thật của workflow Motion và đo tải ffmpeg trên VPS.
