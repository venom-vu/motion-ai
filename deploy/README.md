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
