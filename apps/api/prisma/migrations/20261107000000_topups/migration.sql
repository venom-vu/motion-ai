-- CreateTable
CREATE TABLE "topups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_transfer',
    "qr_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "approve_by" TIMESTAMPTZ(6),
    "bank_ref" TEXT,
    "reject_reason" TEXT,
    "note" TEXT,
    "tos_version" TEXT NOT NULL,
    "notified_at" TIMESTAMPTZ(6),
    "overdue_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topups_status_valid_chk" CHECK ("status" IN ('awaiting_transfer','pending','approved','rejected','needs_review','expired')),
    CONSTRAINT "topups_pack_valid_chk" CHECK ("pack" IN ('starter','pro','creator')),
    CONSTRAINT "topups_amount_positive_chk" CHECK ("amount_vnd" > 0),
    CONSTRAINT "topups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "topups_code_key" ON "topups"("code");

-- CreateIndex (Postgres cho phép nhiều NULL trong UNIQUE)
CREATE UNIQUE INDEX "topups_bank_ref_key" ON "topups"("bank_ref");

-- CreateIndex
CREATE INDEX "topups_user_id_status_idx" ON "topups"("user_id", "status");

-- CreateIndex
CREATE INDEX "topups_user_id_created_at_idx" ON "topups"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "topups_status_idx" ON "topups"("status");

-- NOT VALID để không thất bại trên DB dev có dữ liệu thử; chỉ kiểm các dòng mới.
ALTER TABLE "ledger_entries"
    ADD CONSTRAINT "ledger_entries_topup_id_fkey" FOREIGN KEY ("topup_id") REFERENCES "topups"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
