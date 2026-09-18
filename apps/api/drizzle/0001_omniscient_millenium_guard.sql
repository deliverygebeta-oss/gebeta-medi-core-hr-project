ALTER TABLE "medicore_hr_db"."documents" ADD COLUMN IF NOT EXISTS "file_name" varchar(200);--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."documents" ADD COLUMN IF NOT EXISTS "file_path" text;--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."documents" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "medicore_hr_db"."documents" ADD COLUMN IF NOT EXISTS "file_size" integer;