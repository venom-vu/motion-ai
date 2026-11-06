# Deploy

## Smoke test compose end-to-end

`pnpm test` mặc định bỏ qua test dựng cả stack. Để chạy (cần Docker, build image, mất vài phút):

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test
```

Test dựng project `motion-ai-e2e` (cổng api `3101`, Postgres `15432`, Redis `16379`), kiểm tra:
`GET /health` qua cổng publish trả `ok`, bảng `infra_probes` tồn tại (migrate trong container chạy được),
`nestjs-worker` và `nestjs-api` vẫn chạy; luôn `compose down -v` khi kết thúc.

Postgres và Redis chỉ bind `127.0.0.1` trên host.

## Smoke test đăng nhập (Story 1.11)

`apps/api/test/smoke-login.test.mjs` dựng stack bằng `compose.yml` + `compose.smoke.yml` (project `motion-ai-smoke`, api `3102`, Postgres `15433`, Redis `16380`), vẫn bốn container. Máy chủ Google giả chạy trong tiến trình test (cổng `3199` trên host); container api tới đó qua `host.docker.internal`. Override đặt `NODE_ENV=test` vì `GOOGLE_TOKEN_URL`/`GOOGLE_USERINFO_URL` bị bỏ qua ở production. Sau kịch bản, test chạy `docker compose exec nestjs-worker node apps/api/dist/scripts/reconcile.js` (thoát 0 nếu không lệch) rồi `down -v`.

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test
```

## Smoke test Face Swap (Story 2.14)

`apps/api/test/smoke-face-swap.test.mjs` dựng stack bốn container (project `motion-ai-smoke-fs`, api `3103`, Postgres `15434`, Redis `16381`). RunningHub giả (cổng `3197`), S3/R2 giả (`3198`) và Google giả (`3199`) chạy trong tiến trình test; container tới qua `host.docker.internal`. Ba kịch bản: thành công (500 -> 400, `queued -> running -> succeeded`, CAPTURED, ảnh tải được), `NO_FACE` (failed, RELEASED, số dư về 500), quá hạn (hạn chót ép 10 giây qua `RH_DEADLINE_MS`, `timed_out`, kết quả muộn bị bỏ qua). Thêm chia sẻ (`GET /s/<token>` 302, sau `DELETE` 404), kiểm tra hợp đồng `MOCK_*` và đối soát `reconcile.js`.

Các biến ghi đè `RUNNINGHUB_BASE_URL`, `RH_DEADLINE_MS`, `RESULT_URL_ALLOW_HOSTS` và chế độ path-style của `R2_ENDPOINT` chỉ có tác dụng khi `NODE_ENV=test` (bản thân `R2_ENDPOINT` vẫn là ghi đè tùy chọn ở production) (`test-overrides.test.mjs` chứng minh bị bỏ qua ở production). SLA 60 giây không đo ở đây; thuộc benchmark Epic 6.

```bash
RUN_COMPOSE_E2E=1 pnpm --filter @motion-ai/api test
```

## Bucket R2 (Story 2.2)

Ảnh tải lên đi thẳng lên R2 bằng presigned PUT. Bucket phải **riêng tư** (không bật public access hay custom domain công khai). Đặt `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (xem `apps/api/.env.example`) rồi chạy thủ công, idempotent:

```bash
pnpm --filter @motion-ai/api run build
node --env-file=apps/api/.env apps/api/dist/scripts/configure-bucket.js
```

Script đặt CORS chỉ cho `FRONTEND_URL` (PUT/GET/HEAD) và lifecycle: `in-raw/` xóa sau 1 ngày, `in/` xóa sau 7 ngày. Job worker mỗi giờ chuyển bản ghi `uploads` pending quá 24 giờ sang `expired`.

Presigned PUT ký kèm `Content-Type` và `Content-Length`: client phải PUT đúng `Content-Type` trả về trong `headers` và body có độ dài đúng bằng `sizeBytes` đã khai báo (không dùng chunked/stream), nếu không R2 trả 403.
