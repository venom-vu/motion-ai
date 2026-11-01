---
title: 'Story 1.3: [BE] Khung api, worker, PostgreSQL và Redis'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
baseline_commit: '038392336cbc70e097c1541aada95f8b09bc4dcd'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại gói `@motion-ai/api` và `deploy/compose.yml` mới chỉ có bộ khung rỗng từ Story 1.1, chưa kết nối PostgreSQL 16 (qua Prisma `7.10.1` + `@prisma/adapter-pg` `7.10.1`) và Redis 7 (qua `ioredis` `5.11.1` + `bullmq` `6.5.3` + `@nestjs/bullmq` `12.0.0`), chưa có endpoint `GET /health` kiểm tra kết nối thật, chưa hoàn thiện cấu hình Docker Compose 4 container (`nestjs-api`, `nestjs-worker`, `postgres-16`, `redis-7`) và chưa có bài kiểm thử hạ tầng cho lỗi trùng khóa `P2002` trên pool kết nối cũng như xử lý job BullMQ.

**Approach:** Cài đặt các thư viện ghim cố định của tầng hạ tầng Backend vào `apps/api`, thiết lập Prisma 7 (`prisma.config.ts`, generator `prisma-client`, cơ chế migration SQL thô), tích hợp dịch vụ Prisma và Redis/BullMQ vào hai entrypoint (`api` có `GET /health`, `worker` chạy BullMQ với `maxRetriesPerRequest: null` không mở cổng HTTP), hoàn thiện `deploy/compose.yml` với đúng 4 container cùng `.env.example`, và bổ sung bộ kiểm thử tích hợp trên PostgreSQL 16 và Redis 7 thật.

## Boundaries & Constraints

**Always:**
- Chỉ sửa đổi các file trong phạm vi `apps/api/**`, `deploy/**` và `pnpm-lock.yaml` ở thư mục gốc để tuân thủ tuyệt đối ranh giới nhánh `be/*` của `scripts/check-branch-boundaries.mjs`.
- Ghim chính xác phiên bản các thư viện cốt lõi theo `ARCHITECTURE-SPINE.md` (không dùng `^` hoặc `~`): `prisma` `7.10.1`, `@prisma/client` `7.10.1`, `@prisma/adapter-pg` `7.10.1`, `ioredis` `5.11.1`, `bullmq` `6.5.3`, `@nestjs/bullmq` `12.0.0`.
- Định nghĩa `deploy/compose.yml` khởi động đúng 4 dịch vụ: `nestjs-api`, `nestjs-worker`, `postgres-16` (`postgres:16-alpine`), `redis-7` (`redis:7-alpine`), trong đó `redis-7` bắt buộc chạy với `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction` (AD-15) và `nestjs-worker` không mở cổng HTTP công khai.
- Thiết lập `apps/api/prisma.config.ts` và `apps/api/prisma/schema.prisma` sử dụng generator `prisma-client` cùng `@prisma/adapter-pg`, có migration khởi tạo chạy thành công trên CSDL trống và hỗ trợ thêm migration SQL thô (`apps/api/prisma/migrations/*/migration.sql`).
- Triển khai `GET /health` trên entrypoint `api` trả về HTTP `200` kèm trạng thái kết nối thực tế tới PostgreSQL (`SELECT 1`) và Redis (`PING`), đồng thời bật `enableShutdownHooks()` trên cả `api` và `worker`.
- Cấu hình kết nối `ioredis` cho worker/BullMQ với `maxRetriesPerRequest: null` (AD-15).
- Mọi thông tin kết nối và bí mật chỉ đọc từ biến môi trường; cung cấp `.env.example` (`apps/api/.env.example` và `deploy/.env.example`), tuyệt đối không lưu bí mật thật trong repo.
- Kiểm thử tích hợp trên PostgreSQL thật xác nhận sau khi lỗi trùng khóa `P2002` làm rollback một interactive transaction, kết nối lấy từ pool vẫn thực thi truy vấn tiếp theo bình thường (trên bảng riêng của test), và kiểm thử trên Redis thật xác nhận worker BullMQ xử lý thành công một job mẫu với `maxRetriesPerRequest: null`.

**Never:**
- Không sửa bất kỳ file nào ngoài `apps/api/**`, `deploy/**` và `pnpm-lock.yaml` (không sửa `.github/workflows/ci.yml`, `packages/contracts/**`, `apps/web/**`, hay `package.json` gốc).
- Không tạo trước các bảng nghiệp vụ của các story sau (`users`, `refresh_tokens` thuộc Story 1.5; `ledger_entries` thuộc Story 1.6; `signup_grants` thuộc Story 1.8; `tasks` thuộc Epic 2; `topups` thuộc Epic 3).
- Không mở cổng lắng nghe HTTP trong tiến trình `worker` (`src/worker.ts`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gọi `GET /health` khi PostgreSQL và Redis đều sẵn sàng | PostgreSQL phản hồi `SELECT 1` và Redis phản hồi `PONG` | HTTP `200` với `{ status: 'ok', postgres: 'up', redis: 'up' }` | N/A |
| Gọi `GET /health` khi PostgreSQL hoặc Redis mất kết nối | Một trong hai dịch vụ ném lỗi kết nối / timeout khi ping | HTTP `200` báo cáo rõ trạng thái từng dịch vụ (`postgres: 'down'` hoặc `redis: 'down'`) mà không làm sập tiến trình API | Bắt ngoại lệ ping và chuyển thành trạng thái `'down'` |
| Khởi chạy entrypoint `worker` (`bootstrapWorker`) | Chạy `src/worker.ts` / `dist/worker.js` | Khởi tạo `ApplicationContext` của NestJS và kết nối Redis/BullMQ với `maxRetriesPerRequest: null`, không mở bất kỳ cổng HTTP nào | Thoát mã lỗi `1` nếu khởi tạo thất bại |
| Rollback interactive transaction do lỗi trùng khóa `P2002` | Trong `prisma.$transaction(async (tx) => ...)`, chèn 2 dòng trùng khóa duy nhất vào bảng kiểm thử | Transaction bị rollback và ném lỗi `P2002`; ngay sau đó gọi truy vấn mới trên `prisma` ngoài transaction vẫn trả kết quả đúng từ connection pool | Không chạy thêm câu lệnh nào bên trong `tx` sau khi xảy ra `P2002` |
| Xử lý job mẫu qua BullMQ + ioredis | Đẩy một job mẫu vào hàng đợi BullMQ với kết nối worker `maxRetriesPerRequest: null` | Worker nhận và xử lý hoàn tất job mẫu, trả về kết quả đúng | Đóng worker, queue và kết nối Redis gọn gàng sau khi xong |
| Chạy migration Prisma và migration SQL thô trên CSDL trống | Thực thi `prisma migrate deploy` trên PostgreSQL 16 trống | Áp dụng thành công các file `migration.sql` (bao gồm câu lệnh SQL thô) mà không báo lỗi | Dừng quá trình migrate với mã lỗi khác `0` nếu SQL không hợp lệ |

</frozen-after-approval>

## Code Map

- `apps/api/package.json` -- Bổ sung các dependency ghim cố định (`@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `prisma@7.10.1`, `ioredis@5.11.1`, `bullmq@6.5.3`, `@nestjs/bullmq@12.0.0`, `pg`, `@types/pg`) và các script hỗ trợ Prisma (`prisma:generate`, `prisma:migrate:deploy`).
- `apps/api/.env.example` -- Mẫu biến môi trường cho ứng dụng backend (`PORT`, `DATABASE_URL`, `REDIS_URL`) không chứa bí mật thật.
- `apps/api/prisma.config.ts` -- Cấu hình chuẩn Prisma 7 định nghĩa đường dẫn schema, thư mục migrations và nạp `DATABASE_URL` từ biến môi trường.
- `apps/api/prisma/schema.prisma` -- Khai báo datasource `postgresql`, generator `prisma-client` (xuất client TypeScript cho ESM) và model hạ tầng tối thiểu phục vụ kiểm tra kết nối/migration & kiểm thử `P2002` mà không lấn sang các bảng nghiệp vụ của Story 1.5+.
- `apps/api/prisma/migrations/` -- Thư mục chứa migration khởi tạo và cơ chế chạy migration SQL thô (`migration.sql`), kèm hướng dẫn tạo migration SQL thô (`prisma migrate dev --create-only`).
- `apps/api/src/infra/prisma.service.ts` -- `PrismaService` khởi tạo `PrismaClient` thông qua `PrismaPg` (`@prisma/adapter-pg`) với `pg.Pool` đọc từ `DATABASE_URL`, quản lý vòng đời kết nối và hàm `checkHealth()`.
- `apps/api/src/infra/redis.service.ts` -- Quản lý kết nối `ioredis` (`5.11.1`) đọc từ `REDIS_URL`, cung cấp cấu hình `maxRetriesPerRequest: null` cho BullMQ worker và hàm `checkHealth()` (`PING`).
- `apps/api/src/infra/infra.module.ts` -- Module hạ tầng toàn cục (`@Global()`) xuất `PrismaService`, `RedisService` và cấu hình `@nestjs/bullmq`.
- `apps/api/src/health.controller.ts` -- Controller xử lý `GET /health`, trả về HTTP `200` kèm trạng thái kết nối PostgreSQL và Redis.
- `apps/api/src/app.module.ts` -- Tích hợp `InfraModule` và `HealthController` vào `AppModule` cùng 8 domain module hiện có.
- `apps/api/src/main.ts` -- Bật `app.enableShutdownHooks()` trong `bootstrapApi()` để đóng kết nối DB/Redis an toàn khi dừng container.
- `apps/api/src/worker.ts` -- Giữ nguyên mô hình `NestFactory.createApplicationContext` không mở cổng HTTP, đảm bảo kết nối worker dùng `maxRetriesPerRequest: null`.
- `deploy/Dockerfile` -- Image đa giai đoạn dựa trên `node:22-bookworm-slim` để build và chạy `nestjs-api` hoặc `nestjs-worker`.
- `deploy/compose.yml` -- Định nghĩa đúng 4 dịch vụ `nestjs-api`, `nestjs-worker`, `postgres-16` (`postgres:16-alpine`), `redis-7` (`redis:7-alpine` với `appendonly yes --appendfsync everysec --maxmemory-policy noeviction`), biến môi trường và healthcheck.
- `deploy/.env.example` -- Mẫu biến môi trường cho Docker Compose (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `REDIS_URL`, `PORT`).
- `apps/api/test/app.test.mjs` -- Mở rộng bộ kiểm thử tích hợp kiểm chứng: cấu trúc `deploy/compose.yml` (4 dịch vụ và cờ Redis AD-15), kiểm tra không rò rỉ bí mật và có `.env.example`, `GET /health` trả 200 kèm trạng thái PostgreSQL/Redis, `worker` không mở cổng HTTP, migration + lỗi `P2002` rollback interactive transaction rồi tái sử dụng pool trên PostgreSQL 16 thật, và xử lý job mẫu BullMQ với `maxRetriesPerRequest: null` trên Redis 7 thật.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json`, `pnpm-lock.yaml` -- Cài đặt `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `ioredis@5.11.1`, `bullmq@6.5.3`, `@nestjs/bullmq@12.0.0`, `pg` và `@types/pg` vào `@motion-ai/api` (ghim cố định phiên bản) -- Cung cấp đúng bộ thư viện hạ tầng đã ghim trong `ARCHITECTURE-SPINE.md` (AR2).
- [x] `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` -- Thiết lập cấu hình Prisma 7 với generator `prisma-client`, driver adapter `@prisma/adapter-pg` và tạo migration SQL khởi tạo (kèm cơ chế migration SQL thô) -- Đáp ứng yêu cầu Prisma 7 và cơ chế migration SQL thô (AR2, AR5).
- [x] `apps/api/src/infra/prisma.service.ts`, `apps/api/src/infra/redis.service.ts`, `apps/api/src/infra/infra.module.ts` -- Xây dựng `PrismaService` (dùng `PrismaPg` + `pg.Pool`), `RedisService` (`ioredis` với tùy chọn `maxRetriesPerRequest: null` cho worker) và `InfraModule` tích hợp `@nestjs/bullmq` -- Kết nối tầng CSDL và hàng đợi theo AD-15 và AR19.
- [x] `apps/api/src/health.controller.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/worker.ts` -- Thêm `GET /health` trả về 200 kèm trạng thái PostgreSQL và Redis, bật `enableShutdownHooks()` ở `main.ts` và bảo đảm `worker.ts` chạy `ApplicationContext` không mở cổng HTTP -- Đáp ứng AC2 và đóng các mục deferred từ Story 1.1.
- [x] `deploy/Dockerfile`, `deploy/compose.yml`, `deploy/.env.example`, `apps/api/.env.example` -- Hoàn thiện Docker Compose gồm đúng 4 container (`nestjs-api`, `nestjs-worker`, `postgres-16` dùng `postgres:16-alpine`, `redis-7` dùng `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`) và các file `.env.example` -- Đáp ứng AC1, AC6, AR3, AR19 và NFR3.
- [x] `apps/api/test/app.test.mjs` -- Viết kiểm thử tự động kiểm tra cấu hình `deploy/compose.yml`, `.env.example`, endpoint `GET /health`, tiến trình `worker` không mở cổng HTTP, chạy migration trên PostgreSQL 16 thật, kiểm thử lỗi trùng khóa `P2002` rollback transaction rồi tái sử dụng pool, và kiểm thử worker BullMQ xử lý job mẫu với `maxRetriesPerRequest: null` trên Redis 7 thật -- Bảo chứng toàn bộ Acceptance Criteria và I/O Matrix (AR25).

**Acceptance Criteria:**
- Given `deploy/compose.yml`, when khởi chạy `docker compose up` (hoặc kiểm tra cấu hình dịch vụ), then có đúng bốn dịch vụ `nestjs-api`, `nestjs-worker`, `postgres-16` (`postgres:16-alpine`), `redis-7` và `redis-7` chạy với `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction`.
- Given các dịch vụ đã chạy, when gọi `GET /health` tới `nestjs-api`, then nhận HTTP `200` kèm trạng thái kết nối PostgreSQL và Redis, đồng thời tiến trình `worker` chạy mà không mở cổng HTTP.
- Given Prisma `7.10.1` với `@prisma/adapter-pg` `7.10.1`, `prisma.config.ts` và generator `prisma-client`, when chạy migration trên CSDL trống, then migration thực thi thành công và hỗ trợ thêm migration SQL thô.
- Given PostgreSQL 16 thật, when một lỗi trùng khóa `P2002` làm rollback một interactive transaction, then kết nối lấy từ pool vẫn chạy truy vấn đúng ở lần kế tiếp (dùng bảng kiểm thử riêng).
- Given `ioredis` `5.11.1` và `bullmq` `6.5.3`, when chạy test BullMQ trên Redis 7 thật, then worker xử lý thành công một job mẫu với `maxRetriesPerRequest: null`.
- Given toàn bộ kho mã sau khi thực hiện story, when kiểm tra biến môi trường và ranh giới nhánh `be/*`, then mọi bí mật chỉ đọc từ biến môi trường, có `.env.example`, không có bí mật trong repo và chỉ các file trong `apps/api/`, `deploy/`, `pnpm-lock.yaml` được thay đổi.

## Implementation Notes

- Đã ghim cố định phiên bản các thư viện hạ tầng trong `apps/api/package.json`: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `ioredis@5.11.1`, `bullmq@6.5.3`, `@nestjs/bullmq@12.0.0`, `pg@8.23.1`, `@types/pg@8.23.1`.
- Thiết lập Prisma 7 với `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma` (generator `prisma-client` xuất TypeScript ESM vào `src/generated/prisma`, được loại trừ khỏi git qua `apps/api/.gitignore`) và migration khởi tạo `20261101000000_init_infra_probe` cho bảng hạ tầng `infra_probes` kèm ràng buộc SQL thô `CHECK (char_length("probe_key") > 0)`.
- Xây dựng `PrismaService` (`PrismaPg` + `pg.Pool`), `RedisService` (`ioredis` với `maxRetriesPerRequest: null` cho kết nối worker/BullMQ), `InfraModule` toàn cục và `HealthController` (`GET /health`).
- Hoàn thiện `deploy/Dockerfile`, `deploy/compose.yml` (4 dịch vụ: `postgres-16`, `redis-7`, `nestjs-api`, `nestjs-worker`), `deploy/.env.example` và `apps/api/.env.example`.
- Mở rộng `apps/api/test/app.test.mjs` thành 11 bài kiểm thử tích hợp chạy trên PostgreSQL 16 và Redis 7 thật.

## Spec Change Log

## Review Triage Log

- `[blind-hunter #1 / edge-case-hunter #2 / verification-gap other #2]` (`deploy/compose.yml:53-54, 75-76`) — `high` (`patch`): `DATABASE_URL` và `REDIS_URL` trong `nestjs-api` và `nestjs-worker` chưa có giá trị fallback `:-...` trỏ tới `postgres-16:5432` và `redis-7:6379`, khiến `docker compose up` không có file `.env` truyền chuỗi rỗng vào container.
- `[blind-hunter #2 / edge-case-hunter #1]` (`deploy/compose.yml:52-56`) — `medium` (`patch`): Ánh xạ cổng của `nestjs-api` đang viết cứng cổng đích `:3001` (`"${PORT:-3001}:3001"`) thay vì `"${PORT:-3001}:${PORT:-3001}"`, làm lệch cổng khi biến `PORT` khác `3001`.
- `[blind-hunter #3]` (`apps/api/src/infra/redis.service.ts:35-92`) — `medium` (`patch`): `RedisService.checkHealth()` tạo kết nối TCP mới và gọi `disconnect()` mỗi lần gọi `/health` trong khi `this.client` không được tái sử dụng; cần ưu tiên dùng `this.client` khi sẵn sàng và đóng kết nối probe an toàn.
- `[blind-hunter #4]` (`apps/api/prisma/schema.prisma:11-16`, `apps/api/prisma/migrations/20261101000000_init_infra_probe/migration.sql`) — `false` (rejected): Generator `prisma-client` của Prisma 7.10.1 bắt buộc có ít nhất một model trong `schema.prisma` để sinh `PrismaClient` và mã lỗi `P2002` chỉ phát sinh qua thao tác model của Prisma; `InfraProbe` đã được quy định trong Code Map của spec đã phê duyệt.
- `[blind-hunter #5 / edge-case-hunter #4]` (`apps/api/src/infra/prisma.service.ts:10-18`, `apps/api/prisma.config.ts:9-11`) — `medium` (`patch`): Không nhúng chuỗi mật khẩu mẫu trong mã nguồn runtime `prisma.service.ts` (chỉ đọc từ `process.env.DATABASE_URL`) và dùng toán tử `||` thay cho `??` trong `prisma.config.ts` để xử lý cả khi `DATABASE_URL=""`.
- `[blind-hunter #6 / verification-gap #1 / verification-gap other #1]` (`deploy/Dockerfile:8-12`, `apps/api/test/app.test.mjs`) — `high` (`patch`): `deploy/Dockerfile` thiếu `--filter .` khi chạy `pnpm install` (làm thiếu `tsc` từ gói gốc khi build trong Docker) và `COPY apps/api ./apps/api` chép cả `node_modules`/`dist`/`src/generated` từ host; cần sửa `deploy/Dockerfile` chỉ chép file nguồn/cấu hình, cài kèm `--filter .`, chạy dưới user `node` và bổ sung test kiểm tra `docker compose config` + `docker build` trong `apps/api/test/app.test.mjs`.
- `[blind-hunter #7]` (`deploy/compose.yml:46-82`) — `medium` (`patch`): Cập nhật lệnh khởi chạy của `nestjs-api` trong `deploy/compose.yml` chạy `prisma migrate deploy` trước khi khởi động `dist/main.js` để CSDL trống tự động được migrate khi chạy `docker compose up`.
- `[blind-hunter #8]` (`apps/api/package.json:9`) — `low` (`patch`): Bổ sung `prisma.config.ts` vào lệnh `lint` của `apps/api/package.json` và thêm `--ignore-pattern 'src/generated/**'` để ESLint không quét thư mục mã sinh tự động của Prisma.
- `[blind-hunter #9 / edge-case-hunter #5 / verification-gap #2]` (`apps/api/src/infra/redis.service.ts:20-36, 59-68`, `apps/api/test/app.test.mjs`) — `medium` (`patch`): Kiểm tra giao thức `redis:` / `rediss:` và chỉ số `db >= 0` trong `parseRedisUrlToOptions`, tránh truyền trùng URL + options trong `createWorkerConnection`, và bổ sung unit test kiểm tra đầy đủ `parseRedisUrlToOptions` (auth, port, db, `rediss:` TLS và URL không hợp lệ).
- `[blind-hunter #10]` (`apps/api/test/app.test.mjs:61-65, 223-285`) — `low` (`patch`): Lưu và khôi phục `process.env.PORT` trong hook `after()` của `apps/api/test/app.test.mjs`.
- `[edge-case-hunter #3]` (`apps/api/src/main.ts:11`) — `medium` (`patch`): `Number.parseInt(process.env.PORT ?? '3001', 10)` trả về `NaN` khi `PORT=""` hoặc không phải số; cần dùng `process.env.PORT || '3001'` và kiểm tra `Number.isNaN`/`port < 0` để fallback về `3001`.

## Verification

**Commands:**
- `pnpm run check:boundaries -- --branch be/1-3-api-worker-postgres-redis` -- expected: exit code 0, chỉ sửa các file trong `apps/api/`, `deploy/` và `pnpm-lock.yaml`
- `pnpm run lint` -- expected: exit code 0 trên toàn monorepo
- `pnpm run typecheck` -- expected: exit code 0 trên cả 3 gói (`@motion-ai/contracts`, `@motion-ai/api`, `@motion-ai/web`)
- `pnpm run build` -- expected: exit code 0 trên cả 3 gói
- `pnpm test` -- expected: exit code 0, bao gồm test ranh giới nhánh và toàn bộ test tích hợp PostgreSQL (`P2002` pool reuse, migration), Redis/BullMQ (`maxRetriesPerRequest: null`), `/health` và `worker` của `@motion-ai/api`


### Review Findings

- [x] [Review][Patch] (đã chọn B: smoke test bật bằng `RUN_COMPOSE_E2E=1`, mặc định bỏ qua; kiểm `/health` qua cổng publish, bảng `infra_probes` tồn tại, worker còn sống; luôn `compose down -v` trong `finally`; ghi cách chạy vào README) Không có test nào chạy thật luồng `docker compose up` của `nestjs-api` (migrate trong container, `/health` qua cổng publish) và `nestjs-worker` — `docker compose config` và `docker build` vẫn xanh nếu đường dẫn `prisma`/`--config` hoặc mapping cổng hỏng [deploy/compose.yml:46-82] (verification-gap, medium)
- [x] [Review][Patch] Worker thoát ngay sau bootstrap (đã chạy thử: exit code 0 sau vài giây) nên `restart: unless-stopped` sẽ lặp khởi động; `RedisService.client` là `lazyConnect` và không bao giờ `connect()` nên nhánh tái dùng client trong `checkHealth()` là mã chết (mỗi `/health` mở một kết nối probe mới); guard `maxRetriesPerRequest !== null` trong worker không bao giờ kích hoạt. Sửa: kết nối client khi khởi tạo module (giữ tiến trình sống, chứng minh kết nối Redis), thêm `commandTimeout` cho client, bỏ guard vô nghĩa, thêm test spawn worker kiểm tra còn sống và không lắng nghe cổng [apps/api/src/worker.ts:10-24, apps/api/src/infra/redis.service.ts] (blind-hunter+edge-case-hunter+verification-gap+acceptance-auditor, high)
- [x] [Review][Patch] Healthcheck của `nestjs-api` chỉ kiểm `r.ok` nên container vẫn "healthy" khi Postgres/Redis down (`/health` luôn trả 200 theo spec); healthcheck phải đọc body và yêu cầu `status === 'ok'` [deploy/compose.yml:68-72] (blind-hunter+edge-case-hunter, medium)
- [x] [Review][Patch] Postgres (mật khẩu mặc định) và Redis (không auth) được publish trên mọi interface host; bind vào `127.0.0.1` [deploy/compose.yml:11-12,32-33] (blind-hunter+edge-case-hunter, medium)
- [x] [Review][Patch] Test migrate SQL lỗi dùng `assert.throws` không predicate nên pass với mọi lỗi (sai đường dẫn config, mất kết nối...); phải khớp stderr/mã lỗi migrate [apps/api/test/app.test.mjs] (verification-gap, medium)
- [x] [Review][Patch] Test P2002 pool-reuse dùng pool mặc định (max 10) nên truy vấn sau có thể chạy trên kết nối khác; dùng `max: 1` để chứng minh dùng lại cùng kết nối [apps/api/test/app.test.mjs] (blind-hunter+edge-case-hunter, medium)
- [x] [Review][Patch] `PORT` như `3001abc` được parseInt thành 3001, giá trị > 65535 làm `listen` ném lỗi; kiểm tra chặt `^\d+$` và ≤ 65535, thêm test cho `''`, `abc`, `-1`, `70000` [apps/api/src/main.ts:11-13] (blind-hunter+edge-case-hunter+verification-gap, low)
- [x] [Review][Defer] Migration chỉ chạy trong lệnh start của `nestjs-api`; worker và nhiều replica api không có thứ tự/khóa với migration — deferred: worker hiện chưa truy vấn DB; xử lý khi story thêm bảng nghiệp vụ (cân nhắc service `migrate` one-shot)
- [x] [Review][Defer] `?schema=` trong `DATABASE_URL` được Prisma CLI áp dụng nhưng `PrismaPg`/`pg.Pool` lúc runtime có thể bỏ qua — deferred: chưa xác minh (tối đa medium); settle bằng cách chạy truy vấn runtime với URL dùng schema không phải `public`

#### Rejected

- `false` — File ngoài phạm vi / thiếu lockfile: commit nằm trên `main` (script ranh giới chỉ giới hạn `be/*`), và `pnpm-lock.yaml` có +1226 dòng trong commit (mình chỉ loại nó khỏi diff review).
- `false` — `prisma` không có trong image runtime: nằm trong `dependencies`, được copy qua `node_modules`; phần chưa chạy thật được gom vào quyết định về smoke test.
- `low` — Mật khẩu mặc định `change_me_local_password`, fallback `DATABASE_URL` localhost trong `prisma.config.ts`: placeholder cho dev, cần cho `prisma generate` lúc build.
- `low` — `/health` thêm trạng thái `degraded`; P2002 dùng `infra_probes` (Code Map cho phép); `pnpm test` cần Docker/Postgres (spec yêu cầu test tích hợp thật).
- `low` — IPv6/`rediss` servername, timeout truy vấn Postgres trong `/health`, `.dockerignore`, devDependencies trong image, timeout cho test spawn, `PORT=0` trong mapping: không gây hại cụ thể ở hiện tại, sửa thêm guard/tệp.
- Bỏ qua (sửa phải đổi spec) — Số test "11 vs 13" và mô tả triage log về `checkHealth`: mã sẽ được sửa ở patch worker/Redis.
