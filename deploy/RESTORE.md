# Khôi phục PostgreSQL từ sao lưu R2

Job trong container `nestjs-worker` chạy 03:00 giờ Việt Nam (`Asia/Ho_Chi_Minh`): `pg_dump` (custom format) -> `pg_restore --list` -> tải lên R2 `db-backup/<ngày-giờ>.dump` -> `HEAD` xác nhận -> giữ 7 bản mới nhất. Kết quả nằm ở `settings.last_backup` và `GET /admin/ops/status` (`lastBackup`). Quá 36 giờ không có bản thành công, Discord nhận đúng một cảnh báo.

## Khôi phục

1. Dừng `nestjs-api` và `nestjs-worker`.
2. Tải bản mới nhất trong `db-backup/` từ R2 (dashboard Cloudflare hoặc `aws s3 cp --endpoint-url`).
3. Tạo CSDL trống rồi khôi phục:
   ```bash
   createdb -h <host> -U <user> flowvis_restored
   pg_restore -h <host> -U <user> --no-owner --no-privileges -d flowvis_restored <file>.dump
   ```
4. Trỏ `DATABASE_URL` sang CSDL đã khôi phục (hoặc đổi tên CSDL), rồi khởi động lại `nestjs-api` và `nestjs-worker`.
5. Chạy đối soát: `node apps/api/dist/scripts/reconcile.js` (thoát 0 nếu không lệch).

## Redis không được sao lưu

Redis/BullMQ chỉ điều phối. Sau khi khôi phục PostgreSQL, bộ quét Story 2.7 dựng lại hàng đợi từ trạng thái Task (Task `queued` chưa có job được enqueue lại).

## Restore-drill

Kiểm tra bản sao lưu khôi phục được (cần `pg_restore` 16 và quyền `CREATE DATABASE`; có sẵn trong image worker):

```bash
docker compose -f deploy/compose.yml exec nestjs-worker node apps/api/dist/scripts/restore-drill.js
```

Script tải bản mới nhất, khôi phục vào CSDL tạm, kiểm tra mỗi user có `balance = SUM(ledger_entries.amount)` và `held` khớp sổ cái, xóa CSDL tạm, in `{"ok":true,"durationMs":...,"checked":N}` và thoát 0 (lệch hoặc lỗi: `ok:false`, thoát 1).
