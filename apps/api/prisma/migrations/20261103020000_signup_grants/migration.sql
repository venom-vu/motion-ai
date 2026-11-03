-- CreateTable
CREATE TABLE "signup_grants" (
    "user_id" UUID NOT NULL,
    "fingerprint_hash" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "granted" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_grants_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "signup_grants" ADD CONSTRAINT "signup_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signup_grants" ADD CONSTRAINT "signup_grants_granted_nonneg_chk" CHECK ("granted" >= 0);

-- Mỗi thiết bị chỉ nhận thưởng một lần (lưới an toàn cuối; luồng chính dùng advisory lock)
CREATE UNIQUE INDEX "signup_grants_fingerprint_granted_uidx" ON "signup_grants" ("fingerprint_hash") WHERE "granted" > 0;

CREATE INDEX "signup_grants_ip_hash_created_at_idx" ON "signup_grants" ("ip_hash", "created_at");
