# Hướng dẫn Migration Prisma & SQL thô

Thư mục này chứa các bản migration PostgreSQL của `@motion-ai/api` được quản lý qua Prisma 7 (`apps/api/prisma.config.ts`).

## 1. Áp dụng migration lên cơ sở dữ liệu

```bash
pnpm --filter @motion-ai/api run prisma:migrate:deploy
```

## 2. Tạo migration mới có kèm câu lệnh SQL thô (`CHECK`, partial unique index...)

Một số ràng buộc dữ liệu của flowvis (như `CHECK (balance >= 0)` hoặc chỉ mục duy nhất một phần `CREATE UNIQUE INDEX ... WHERE ...` theo AD-2) không thể khai báo trực tiếp trong `schema.prisma`. Quy trình chuẩn:

1. Tạo thư mục migration rỗng (hoặc sinh từ thay đổi schema nhưng chưa áp dụng):
   ```bash
   pnpm --filter @motion-ai/api exec prisma migrate dev --create-only --name <ten_migration>
   ```
2. Bổ sung các câu lệnh SQL thô (`ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)`, `CREATE UNIQUE INDEX ... WHERE ...`) vào file `prisma/migrations/<timestamp>_<ten_migration>/migration.sql`.
3. Chạy `pnpm --filter @motion-ai/api run prisma:migrate:deploy` để áp dụng và kiểm thử trên PostgreSQL 16 thật.
