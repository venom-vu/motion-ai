ALTER TABLE "tasks" ADD COLUMN "result_key" TEXT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_succeeded_result_key_chk" CHECK ("status" <> 'succeeded' OR "result_key" IS NOT NULL);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_result_key_only_succeeded_chk" CHECK ("status" = 'succeeded' OR "result_key" IS NULL);
