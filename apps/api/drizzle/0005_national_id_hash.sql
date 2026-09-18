ALTER TABLE "medicore_hr_db"."employees" ADD COLUMN IF NOT EXISTS "national_id_hash" varchar(64);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."employees" ADD CONSTRAINT "employees_national_id_hash_unique" UNIQUE("national_id_hash");
-- Re-adding a UNIQUE constraint raises duplicate_table (42P07), not
-- duplicate_object — the index behind the constraint is what collides.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
