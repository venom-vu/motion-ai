-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pipeline" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason_code" TEXT,
    "tier_snapshot" JSONB NOT NULL,
    "consent" BOOLEAN NOT NULL,
    "tos_version" TEXT NOT NULL,
    "input_keys" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "hold_amount" INTEGER NOT NULL,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enqueue_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tasks_status_valid_chk" CHECK ("status" IN ('queued','running','succeeded','failed','timed_out','cancelled')),
    CONSTRAINT "tasks_pipeline_valid_chk" CHECK ("pipeline" IN ('face_swap')),
    CONSTRAINT "tasks_consent_true_chk" CHECK ("consent" = true),
    CONSTRAINT "tasks_hold_amount_positive_chk" CHECK ("hold_amount" > 0),
    CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "tasks_user_id_status_idx" ON "tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_status_queued_at_idx" ON "tasks"("status", "queued_at");

-- HOLD được INSERT trước Task trong cùng transaction (AD-3) nên FK phải hoãn tới COMMIT.
-- NOT VALID để không thất bại trên DB dev có dữ liệu thử; chỉ kiểm các dòng mới.
ALTER TABLE "ledger_entries"
    ADD CONSTRAINT "ledger_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID;
