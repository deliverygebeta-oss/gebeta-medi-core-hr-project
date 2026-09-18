ALTER TABLE "medicore_hr_db"."upload_links" ADD COLUMN IF NOT EXISTS "failed_attempts" integer DEFAULT 0 NOT NULL;
