-- Nhật ký thao tác Admin (Story 3.5). Chỉ AuditService ghi bảng này.
CREATE TABLE "admin_audit" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "before_after" JSONB NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_audit_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "admin_audit_target_idx" ON "admin_audit"("target");
CREATE INDEX "admin_audit_at_idx" ON "admin_audit"("at" DESC);
