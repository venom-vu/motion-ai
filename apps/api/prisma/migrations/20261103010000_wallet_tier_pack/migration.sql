-- AlterTable
ALTER TABLE "users" ADD COLUMN "tier_pack" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_tier_pack_valid_chk" CHECK ("tier_pack" IS NULL OR "tier_pack" IN ('starter','pro','creator'));
