-- Bộ đếm thử lại thông báo Discord cho đơn nạp (Story 3.4).
ALTER TABLE "topups"
    ADD COLUMN "notify_attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "notify_attempted_at" TIMESTAMPTZ(6);
