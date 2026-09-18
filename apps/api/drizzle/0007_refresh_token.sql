ALTER TABLE "medicore_hr_db"."sessions" ADD COLUMN IF NOT EXISTS "refresh_token_hash" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_refresh_token_hash_idx" ON "medicore_hr_db"."sessions" USING btree ("refresh_token_hash");
