ALTER TYPE "medicore_hr_db"."officer_role" ADD VALUE IF NOT EXISTS 'viewer';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medicore_hr_db"."audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_officer_id" integer,
	"action" varchar(60) NOT NULL,
	"entity_type" varchar(40),
	"entity_id" varchar(60),
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medicore_hr_db"."sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"officer_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"ip_address" varchar(45),
	"user_agent" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."contracts" ALTER COLUMN "bank_account_number" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."contracts" ALTER COLUMN "pension_number" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."contracts" ALTER COLUMN "tin_number" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."employees" ALTER COLUMN "national_id" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."hr_officers" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."hr_officers" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."audit_logs" ADD CONSTRAINT "audit_logs_actor_officer_id_hr_officers_id_fk" FOREIGN KEY ("actor_officer_id") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."sessions" ADD CONSTRAINT "sessions_officer_id_hr_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
