# Motion AI Monorepo

Nền tảng SaaS tạo ảnh/video AI (Face Swap, Body Retouch, Motion Control) xây dựng trên kiến trúc Modular Monolith (NestJS + Nuxt 4).

## Yêu cầu hệ thống & Trình quản lý gói

- **Node.js:** `>= 22.22.3` (được ghim trong `.nvmrc` và trường `engines` của `package.json`).
- **Trình quản lý gói duy nhất:** `pnpm` (sử dụng pnpm workspaces).
- **Quy tắc Lockfile:** Toàn bộ monorepo chỉ sử dụng **duy nhất một file `pnpm-lock.yaml` ở thư mục gốc**. Không chạy `npm`, `yarn`, `bun` hoặc tạo lockfile riêng bên trong `apps/*` hay `packages/*`.

## Cấu trúc thư mục

```text
.
├── apps/
│   ├── api/                  # @motion-ai/api — NestJS 12.3.2 (ESM), 2 entrypoint (main.ts & worker.ts), 8 module, 3 port
│   └── web/                  # @motion-ai/web — Nuxt 4.6.3 (Slate Cyber UI)
├── packages/
│   └── contracts/            # @motion-ai/contracts — DTO, enum, schema, dữ liệu mock dùng chung
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

# Biên dịch (build) cả 3 gói: @motion-ai/contracts, @motion-ai/api, @motion-ai/web
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
