CREATE TABLE IF NOT EXISTS "medicore_hr_db"."upload_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_links_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "upload_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."upload_links" ADD CONSTRAINT "upload_links_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."upload_links" ADD CONSTRAINT "upload_links_created_by_hr_officers_id_fk" FOREIGN KEY ("created_by") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
