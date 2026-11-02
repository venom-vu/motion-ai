# @motion-ai/web — Giao diện Nuxt 4 Mobile-First & Desktop Adaptive (Slate Cyber)

Ứng dụng Frontend của **Motion AI** được xây dựng trên **Nuxt `4.6.3`**, tích hợp hệ màu **Slate Cyber** (Tailwind CSS `3.4.19`), bộ icon vector **Lucide** (`@nuxt/icon` `2.6.2` + `@iconify-json/lucide` `1.2.150`), và client API có kiểu sinh từ gói hợp đồng chung `@motion-ai/contracts`.

## 1. Cấu hình triển khai Cloudflare Pages (`cloudflare-pages`)

Trong `apps/web/nuxt.config.ts`, Nitro được cấu hình tường minh với preset:

```ts
nitro: {
  preset: 'cloudflare-pages',
}
```

### Kết quả kiểm chứng `pnpm --filter @motion-ai/web run build`

- **Lệnh kiểm tra:** `pnpm --filter @motion-ai/web run build` (`nuxt build`)
- **Preset Nitro:** `cloudflare-pages`
- **Đầu ra biên dịch xác nhận tại `apps/web/.output/public/`:**
  - `apps/web/.output/public/_worker.js/index.js`: Cloudflare Pages Worker bundle xử lý SSR và định tuyến.
  - `apps/web/.output/public/_routes.json`: Cấu hình định tuyến Cloudflare Pages (`version: 1`, `include: ["/*"]`, `exclude` cho tài nguyên tĩnh `/_nuxt/*`).
  - `apps/web/.output/nitro.json`: Ghi nhận `"preset": "cloudflare-pages"`.

## 2. Chế độ chạy API (`mock` / `live`)

Client API (`apps/web/utils/api-client.ts` và composable `useApiClient`) điều khiển qua biến môi trường runtime:

- `NUXT_PUBLIC_API_MODE=mock` (mặc định): Trả dữ liệu mock khớp hoàn toàn với Zod schema của `@motion-ai/contracts` (`GET /config/pricing`, `GET /me`, `GET /wallet/ledger`, `GET /auth/google`, `POST /auth/refresh`, `POST /auth/logout`) **không thực hiện bất kỳ lời gọi mạng (`fetch`) nào**.
- `NUXT_PUBLIC_API_MODE=live`: Gọi tới `NUXT_PUBLIC_API_BASE_URL` (mặc định `http://localhost:3001`), parse dữ liệu phản hồi qua Zod schema và ánh xạ tập trung mọi mã lỗi `ApiErrorCode` sang thông báo tiếng Việt thân thiện qua bảng `API_ERROR_MESSAGES_VI`.

## 3. Các lệnh phát triển

Chạy từ thư mục gốc monorepo:

- `pnpm --filter @motion-ai/web run dev`: Khởi chạy máy chủ phát triển Nuxt 4.
- `pnpm --filter @motion-ai/web run lint`: Kiểm tra ESLint (phủ cả `.ts`, `.mjs` và `.vue`).
- `pnpm --filter @motion-ai/web run typecheck`: Chạy `nuxt prepare && nuxt typecheck`.
- `pnpm --filter @motion-ai/web run build`: Biên dịch đầu ra Cloudflare Pages tại `.output/public`.
- `pnpm --filter @motion-ai/web run test`: Chạy bộ kiểm thử tự động trong `apps/web/test/smoke.test.mjs`.
