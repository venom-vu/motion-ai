-- Story 6.4: idempotency cho cộng/trừ bù credit. Cho phép null (nhiều dòng audit không có requestId).
ALTER TABLE "admin_audit" ADD COLUMN "request_id" TEXT;
CREATE UNIQUE INDEX "admin_audit_request_id_key" ON "admin_audit"("request_id");
