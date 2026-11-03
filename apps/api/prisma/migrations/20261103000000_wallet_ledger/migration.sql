-- AlterTable
ALTER TABLE "users" ADD COLUMN "balance" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "held" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "users" ADD CONSTRAINT "users_balance_non_negative_chk" CHECK ("balance" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_held_non_negative_chk" CHECK ("held" >= 0);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "task_id" UUID,
    "topup_id" UUID,
    "pack" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_type_valid_chk" CHECK ("type" IN ('GRANT','TOPUP','ADJUST','HOLD','CAPTURED','RELEASED')),
    CONSTRAINT "ledger_entries_amount_sign_chk" CHECK (
        ("type" IN ('GRANT','TOPUP') AND "amount" > 0)
        OR ("type" = 'HOLD' AND "amount" < 0)
        OR ("type" = 'RELEASED' AND "amount" > 0)
        OR ("type" = 'CAPTURED' AND "amount" = 0)
        OR ("type" = 'ADJUST' AND "amount" <> 0)
    ),
    CONSTRAINT "ledger_entries_task_id_required_chk" CHECK (
        "type" NOT IN ('HOLD','CAPTURED','RELEASED') OR "task_id" IS NOT NULL
    ),
    CONSTRAINT "ledger_entries_topup_id_required_chk" CHECK (
        "type" <> 'TOPUP' OR "topup_id" IS NOT NULL
    ),
    CONSTRAINT "ledger_entries_pack_valid_chk" CHECK (
        "pack" IS NULL OR ("type" = 'TOPUP' AND "pack" IN ('starter','pro','creator'))
    )
);

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_created_at_idx" ON "ledger_entries"("user_id", "created_at");

-- Partial unique indexes (AD-2)
CREATE UNIQUE INDEX "ledger_entries_hold_task_uniq" ON "ledger_entries"("task_id") WHERE "type" = 'HOLD';
CREATE UNIQUE INDEX "ledger_entries_settle_task_uniq" ON "ledger_entries"("task_id") WHERE "type" IN ('CAPTURED','RELEASED');

CREATE UNIQUE INDEX "ledger_entries_topup_uniq" ON "ledger_entries"("topup_id") WHERE "type" = 'TOPUP';

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
