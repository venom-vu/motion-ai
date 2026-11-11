-- Cấu hình vận hành (Story 6.2). Chỉ module ops ghi bảng này.
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "settings" ("key", "value") VALUES
    ('intake_paused', 'false'::jsonb),
    ('rh_budget_exhausted', 'false'::jsonb),
    ('breaker_reset_at', 'null'::jsonb),
    ('last_breaker_trigger', 'null'::jsonb)
ON CONFLICT ("key") DO NOTHING;
