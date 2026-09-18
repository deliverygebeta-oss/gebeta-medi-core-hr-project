-- drizzle-kit also emitted ADD COLUMN national_id_hash + its UNIQUE constraint
-- here because the hand-written 0005 predates the snapshot — both already
-- exist on every database that ran 0005, so they are deliberately omitted.
CREATE INDEX IF NOT EXISTS "audit_logs_actor_officer_id_idx" ON "medicore_hr_db"."audit_logs" USING btree ("actor_officer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "medicore_hr_db"."audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_employee_id_idx" ON "medicore_hr_db"."documents" USING btree ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_registered_by_idx" ON "medicore_hr_db"."employees" USING btree ("registered_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_officer_id_idx" ON "medicore_hr_db"."sessions" USING btree ("officer_id");
