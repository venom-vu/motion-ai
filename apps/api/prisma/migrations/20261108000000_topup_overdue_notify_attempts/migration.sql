-- Bộ đếm thử lại cảnh báo quá hạn duyệt cho đơn nạp (review Epic 3): giới hạn lượt và giãn cách khi Discord lỗi.
ALTER TABLE "topups"
    ADD COLUMN "overdue_notify_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "overdue_notify_attempted_at" TIMESTAMPTZ(6);
