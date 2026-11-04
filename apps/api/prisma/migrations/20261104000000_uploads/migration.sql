-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "confirmed_key" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mime_type" TEXT NOT NULL,
    "declared_bytes" INTEGER NOT NULL,
    "size_bytes" INTEGER,
    "etag" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uploads_kind_valid_chk" CHECK ("kind" IN ('image','video')),
    CONSTRAINT "uploads_status_valid_chk" CHECK ("status" IN ('pending','confirmed','expired')),
    CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_key_key" ON "uploads"("key");

-- CreateIndex
CREATE INDEX "uploads_user_id_status_created_at_idx" ON "uploads"("user_id", "status", "created_at");
