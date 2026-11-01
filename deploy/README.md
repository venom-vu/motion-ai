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
