-- Story 6.5: đánh dấu Task đã bị Admin gỡ nội dung (do module tasks ghi).
ALTER TABLE "tasks" ADD COLUMN "files_removed_at" TIMESTAMPTZ(6);
