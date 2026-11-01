-- CreateTable
CREATE TABLE "infra_probes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "probe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "infra_probes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "infra_probes_probe_key_non_empty_chk" CHECK (char_length("probe_key") > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "infra_probes_probe_key_key" ON "infra_probes"("probe_key");
