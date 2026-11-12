# flowvis Monorepo

Nền tảng SaaS tạo ảnh/video AI (Face Swap, Body Retouch, Motion Control) xây dựng trên kiến trúc Modular Monolith (NestJS + Nuxt 4).

## Yêu cầu hệ thống & Trình quản lý gói

- **Node.js:** `>= 22.22.3` (được ghim trong `.nvmrc` và trường `engines` của `package.json`).
- **Trình quản lý gói duy nhất:** `pnpm` (sử dụng pnpm workspaces).
- **Quy tắc Lockfile:** Toàn bộ monorepo chỉ sử dụng **duy nhất một file `pnpm-lock.yaml` ở thư mục gốc**. Không chạy `npm`, `yarn`, `bun` hoặc tạo lockfile riêng bên trong `apps/*` hay `packages/*`.

## Cấu trúc thư mục

```text
.
├── apps/
│   ├── api/                  # @flowvis/api — NestJS 12.3.2 (ESM), 2 entrypoint (main.ts & worker.ts), 8 module, 3 port
│   └── web/                  # @flowvis/web — Nuxt 4.6.3 (Slate Cyber UI)
├── packages/
│   └── contracts/            # @flowvis/contracts — DTO, enum, schema, dữ liệu mock dùng chung
├── deploy/
│   └── compose.yml           # Khung Docker Compose cho hạ tầng triển khai
├── scripts/
│   └── check-branch-boundaries.mjs  # Kiểm tra ranh giới đường dẫn theo tiền tố nhánh
└── .github/workflows/ci.yml  # Pipeline CI kiểm tra ranh giới nhánh, lint, typecheck, build, test
```

## Các lệnh phát triển (chạy tại thư mục gốc)

```bash
# Cài đặt toàn bộ dependencies cho monorepo
pnpm install

# Kiểm tra lint trên toàn bộ workspace
pnpm run lint

# Kiểm tra kiểu TypeScript (typecheck) trên toàn bộ workspace
pnpm run typecheck

# Biên dịch (build) cả 3 gói: @flowvis/contracts, @flowvis/api, @flowvis/web
pnpm run build

# Chạy toàn bộ unit test và bài test kiểm tra ranh giới nhánh
pnpm test

# Kiểm tra ranh giới đường dẫn theo nhánh hiện tại
pnpm run check:boundaries
```

## Quy ước nhánh & Ranh giới thư mục (Branch Path Boundaries)

Để hai luồng Backend và Frontend phát triển độc lập không xung đột, CI cưỡng chế ranh giới file được phép sửa theo tiền tố nhánh:

| Tiền tố nhánh | Phạm vi đường dẫn được phép sửa |
|---|---|
| `fe/*` | Chỉ `apps/web/**` (và `package-lock.json` gốc) |
| `be/*` | Chỉ `apps/api/**`, `deploy/**` (và `package-lock.json` gốc) |
| `contract/*` | Chỉ `packages/contracts/**` (và `package-lock.json` gốc) |
| `shared/*` | Toàn bộ kho mã (cấu hình gốc, `packages/contracts/**`, `apps/**`, `deploy/**`) |

## Smoke test Face Swap (Story 2.14)

Ba kịch bản smoke Face Swap (thành công, `NO_FACE`, quá hạn 180 giây được tăng tốc) nằm trong `apps/api/test/smoke-face-swap.test.mjs`, chạy bằng `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker). RunningHub và R2 được giả trong tiến trình test, chỉ bật khi `NODE_ENV=test`. SLA 60 giây được đo ở benchmark Epic 6, không phải ở đây. Chi tiết: `deploy/README.md`.

## Smoke test Body Retouch (Story 4.6)

Smoke `apps/api/test/smoke-body-retouch.test.mjs` chạy bằng `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker). Bốn kịch bản: thành công `intensity` 8, `NO_POSE`, chạy chung hàng đợi với Face Swap (không quá 2 đồng thời), ảnh gốc hết hạn (`sourceUrl` là `null`), rồi đối soát. Smoke chỉ gọi HTTP API thật, không đo SLA 60 giây (thuộc Epic 6). Lưu ý: ít nhất một ảnh nhạy cảm trong 1-2 ảnh của benchmark Epic 6 phải chạy qua Body Retouch (pipeline dễ chạm bộ lọc nội dung, ánh xạ `CONTENT_BLOCKED` do Epic 6 điền). Chi tiết: `deploy/README.md`.

## Chạy thử toàn bộ Epic 1 (FE nối BE) và smoke test đăng nhập

FE chỉ có một chế độ `live` (không có chế độ mock). "Mock" là các hằng `MOCK_*` trong `packages/contracts`; smoke test kiểm tra chúng khớp schema và khớp hình dạng phản hồi BE thật.

1. Chạy stack: `cp deploy/.env.example deploy/.env`, rồi `docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build --wait` (4 container: Postgres, Redis, api, worker). API mặc định ở cổng `3001`.
2. Chạy FE: `NUXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @flowvis/web run dev` (hoặc trỏ tới BE đã triển khai).
3. Chạy test: `pnpm test` (bỏ qua smoke Docker). Smoke đầy đủ: `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker). Smoke giả Google bằng `GOOGLE_TOKEN_URL`/`GOOGLE_USERINFO_URL` (chỉ có tác dụng khi `NODE_ENV=test`), kiểm tra người dùng mới có 500 credit và đúng một dòng "Tặng", tài khoản thứ hai cùng thiết bị có 0 credit, rồi chạy đối soát.
4. Đăng nhập Google thật là bước thủ công, chạy một lần khi có `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL` thật (không nằm trong CI, không commit bí mật): mở FE, đăng nhập Google, kiểm tra số dư 500 và dòng "Tặng" ở trang lịch sử.

## Smoke test nạp tiền (Story 3.8)

Smoke nạp tiền VietQR (`apps/api/test/smoke-topup.test.mjs`) chạy bằng `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker; `pnpm test` bỏ qua phần Docker nhưng vẫn kiểm tra `MOCK_*` khớp schema). FE gọi API đúng schema trong `packages/contracts`, nên smoke xác nhận ở mức hợp đồng. Biến môi trường cần có: `TOPUP_BANK_BIN`, `TOPUP_BANK_ACCOUNT_NO`, `TOPUP_BANK_ACCOUNT_NAME`, `DISCORD_WEBHOOK_URL`, `ADMIN_EMAILS` (xem `deploy/.env.example`). Chi tiết và các ghi đè chỉ dành cho `NODE_ENV=test`: `deploy/README.md`.

## Smoke test Motion Control (Story 5.9)

Smoke `apps/api/test/smoke-motion-control.test.mjs` chạy bằng `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker và `ffmpeg`/`ffprobe` trên máy chạy test để sinh video mẫu). Kịch bản: thành công 10 giây (500 credit), `NO_POSE`, vượt Cap Starter (`TRIM_EXCEEDS_CAP`), ví FREE (hai video 5 giây rồi `INSUFFICIENT_CREDIT`), hai Task song song, quá hạn (`RH_DEADLINE_MS` rút ngắn), kết quả lệch độ dài 10,4 giây (thành công) và 10,6 giây (`OUTPUT_INVALID`), chia sẻ `/s/<token>`, `/info`, `/poster`, dọn thư mục tạm và `reconcile.js`. Gói Tier lấy qua luồng nạp tiền thật (Admin duyệt). Smoke chỉ gọi HTTP API, không đo SLA hay tải ffmpeg trên VPS. Ở Epic 6 cần đối chiếu `nodeId`/`fieldName` của workflow Motion (đang `[ASSUMPTION]` trong `pipeline-config.ts`) và chạy benchmark ffmpeg. Chi tiết: `deploy/README.md`.

## Smoke test vận hành và runbook Admin (Story 6.10)

Smoke `apps/api/test/smoke-ops.test.mjs` chạy bằng `RUN_COMPOSE_E2E=1 pnpm --filter @flowvis/api test` (cần Docker). Stack bốn container có ngắt mạch thật bật (không đặt `OPS_BREAKER_DISABLED`); RunningHub, R2, Google và Discord được giả trong tiến trình test (helper `apps/api/test/helpers/smoke-fakes.mjs`). Kịch bản: ngắt mạch 5 lỗi liên tiếp (503 `PAUSED` ở 3 route tạo Task, Discord đúng một cảnh báo), mở lại, ngưỡng 15% trên 20 Task (30 `NO_POSE` không kích hoạt), khóa/mở khóa tài khoản, cộng bù idempotent, gỡ nội dung, sao lưu giữ 7 bản và lỗi `pg_dump`, restore-drill, dựng lại hàng đợi sau khi xóa Redis, rồi `reconcile.js` phải thoát 0. Chân trang được kiểm bằng HTML SSR của bản build Nuxt (`apps/web/test/footer-ssr.test.mjs`, không dùng trình duyệt). Mock và phản hồi BE thật được đối chiếu qua schema `@flowvis/contracts`.

### Runbook Admin (trang `/admin/ops`)

- **Ngắt mạch kích hoạt** (hệ thống tạm dừng nhận Task mới, người dùng thấy biểu ngữ bảo trì): xem `lastBreakerTrigger` (quy tắc và số liệu) và log worker; xử lý nguyên nhân (RunningHub, R2, ffmpeg), rồi bấm "Mở lại nhận Task" (`POST /admin/ops/resume`). Lỗi cũ không tính lại sau khi mở.
- **Hết ngân sách RunningHub** (`rhBudgetExhausted`): nạp coin RunningHub, kiểm tra `rhBalance`, rồi mở lại. Trong lúc tạm dừng, đăng nhập, nạp credit, lịch sử và tải kết quả vẫn dùng được; Task bị ảnh hưởng đã `failed` `RH_BUDGET` và RELEASED 100%.
- **Sao lưu lỗi** (Discord `ops.backup_failed`, hoặc quá 36 giờ không có bản thành công): xem `lastBackup`, kiểm tra `pg_dump`/R2 trong log worker; bản cũ không bị xóa khi lỗi. Chạy lại bằng lịch 03:00 hoặc xác nhận qua `deploy/RESTORE.md` (có lệnh restore-drill).
- **Đơn nạp quá hạn**: vào `/admin/topups`, đối chiếu `bank_ref` với sao kê; duyệt đơn `needs_review`/`expired` đúng số tiền, hoặc bỏ qua. Không có đường tự hoàn credit Task đã `succeeded`; dùng cộng bù (`ADJUST`) kèm lý do.
- **Vi phạm nội dung**: tra cứu theo mã Task hoặc `shareUrl`, bấm gỡ (thu hồi liên kết, xóa `in/` và `out/` trên R2, số dư không đổi); khóa tài khoản nếu cần. Người dùng báo cáo qua `mailto:` ở chân trang.

## Cổng trước khi bật VietQR thương mại (Story 6.11)

> **Không bật VietQR thương mại khi `docs/prelaunch-report.md` còn bất kỳ dòng nào chưa đạt** (hoặc chưa chạy) mà chưa có quyết định chấp nhận rủi ro bằng văn bản và chữ ký PM.

Năm bước chạy với Discord, VPS và RunningHub thật, mỗi bước một lệnh tại gốc repo (cần build `@flowvis/api` trước; bí mật chỉ đặt qua biến môi trường, không commit). Mỗi script in một dòng JSON để dán vào báo cáo; mã thoát `0` đạt, `1` không đạt, `2` lỗi chạy (riêng `--sensitive` của bước 4 chỉ ghi nhận: `0` hoặc `2`).

1. Discord: `node scripts/prelaunch/step1-discord.mjs` (cần `DISCORD_WEBHOOK_URL`; `--compose` để chạy trong container worker).
2. ffmpeg trên host VPS: `node scripts/prelaunch/step2-ffmpeg.mjs <clip-20s-1080p.mp4>`.
3. RunningHub: `node scripts/prelaunch/step3-runninghub.mjs` (cần `RUNNINGHUB_API_KEY`, `RH_BALANCE_ENDPOINT`), chép kết quả vào `docs/runninghub-api-notes.md`.
4. Benchmark 20 mẫu: `node scripts/prelaunch/step4-benchmark.mjs --manifest <manifest ngoài repo>` (cần `PRELAUNCH_API_URL`, `PRELAUNCH_BENCH_JWT`, `PRELAUNCH_ADMIN_JWT`; nên đặt `PRELAUNCH_BENCH_REFRESH_TOKEN`/`PRELAUNCH_ADMIN_REFRESH_TOKEN` để script tự làm mới access token 15 phút; mẫu manifest ở `scripts/prelaunch/benchmark-manifest.example.json`; mẫu nhạy cảm chạy riêng với `--sensitive`).
5. Khôi phục: `node scripts/prelaunch/step5-restore.mjs` (sao lưu thủ công lên R2 rồi `restore-drill`, in RTO).

Ngưỡng mặc định (`[ASSUMPTION]`, ghi đè bằng biến `PRELAUNCH_*`): cắt ≤ 60 s, `/health` p95 < 1 s, `intensity` 3,3,5,5,8, biên gộp Creator ≥ 70% theo kịch bản nạp lẻ. Hướng dẫn đầy đủ và các mục duyệt thủ công: `docs/prelaunch-checklist.md`; mẫu báo cáo: `docs/prelaunch-report.md`. Không commit ảnh/video mẫu hay ảnh nhạy cảm.
