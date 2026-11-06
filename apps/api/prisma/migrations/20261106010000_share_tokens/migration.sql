-- CreateTable
CREATE TABLE "share_tokens" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "share_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_tokens_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "share_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "share_tokens_token_hash_key" ON "share_tokens"("token_hash");

-- Mỗi Task có tối đa một token đang hiệu lực (Prisma không khai báo được unique một phần).
CREATE UNIQUE INDEX "share_tokens_task_active_key" ON "share_tokens"("task_id") WHERE "revoked_at" IS NULL;

-- CreateIndex
CREATE INDEX "share_tokens_user_id_idx" ON "share_tokens"("user_id");
