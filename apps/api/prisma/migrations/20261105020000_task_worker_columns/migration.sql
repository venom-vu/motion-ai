ALTER TABLE "tasks"
  ADD COLUMN "running_at" TIMESTAMPTZ(6),
  ADD COLUMN "prep_deadline_at" TIMESTAMPTZ(6),
  ADD COLUMN "deadline_at" TIMESTAMPTZ(6),
  ADD COLUMN "submit_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "finished_at" TIMESTAMPTZ(6),
  ADD COLUMN "rh_orphan_until" TIMESTAMPTZ(6),
  ADD COLUMN "gate_deadline" TIMESTAMPTZ(6),
  ADD COLUMN "runninghub_task_id" TEXT,
  ADD COLUMN "gpu_coins" INTEGER;
