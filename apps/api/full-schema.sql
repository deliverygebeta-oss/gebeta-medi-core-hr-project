-- MediCore HR — full database schema
-- Consolidated from apps/api/drizzle/0000_*.sql through 0007_*.sql, in order.
-- Reproduces the exact current state of the medicore_hr_db schema on a fresh
-- Postgres database. Normally you don't need to run this by hand — use
-- `bun run db:migrate` (apps/api) instead, which applies the same migrations
-- with journal tracking. This file is a convenience reference/one-shot setup.

CREATE SCHEMA IF NOT EXISTS "medicore_hr_db";

-- Enums
DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."contract_type" AS ENUM('permanent', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."document_status" AS ENUM('pending', 'received', 'verified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."employment_status" AS ENUM('active', 'on_leave', 'suspended', 'terminated', 'retired', 'deceased');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."officer_role" AS ENUM('hr_officer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- added in 0004:
ALTER TYPE "medicore_hr_db"."officer_role" ADD VALUE IF NOT EXISTS 'viewer';

DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."onboarding_status" AS ENUM('in_progress', 'docs_pending', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "medicore_hr_db"."role" AS ENUM('nurse', 'doctor', 'lab', 'pharmacist', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "medicore_hr_db"."hr_officers" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(60) NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"role" "medicore_hr_db"."officer_role" DEFAULT 'hr_officer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "hr_officers_username_unique" UNIQUE("username")
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" varchar(20) NOT NULL,
	"registered_by" integer NOT NULL,
	"onboarding_status" "medicore_hr_db"."onboarding_status" DEFAULT 'docs_pending' NOT NULL,
	"full_name_latin" varchar(160) NOT NULL,
	"full_name_amharic" varchar(160),
	"national_id" text NOT NULL,
	"national_id_hash" varchar(64),
	"dob" date NOT NULL,
	"phone" varchar(32) NOT NULL,
	"email" varchar(160),
	"gender" varchar(16),
	"employment_type" varchar(60) NOT NULL,
	"department" varchar(60) NOT NULL,
	"job_category" varchar(60) NOT NULL,
	"role" "medicore_hr_db"."role" NOT NULL,
	"edu_qualification" text,
	"job_grade" varchar(20),
	"specialization_text" varchar(160),
	"employment_status" "medicore_hr_db"."employment_status" DEFAULT 'active' NOT NULL,
	"status_effective_date" date,
	"handbook_issued" boolean DEFAULT false NOT NULL,
	"conduct_signed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code"),
	CONSTRAINT "employees_national_id_hash_unique" UNIQUE("national_id_hash")
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"license_number" varchar(60),
	"license_expiry" date,
	"nurse_grade" varchar(40),
	"years_experience" integer,
	"cpr_certified" boolean DEFAULT false NOT NULL,
	"board_cert_number" varchar(60),
	"on_call_eligible" boolean DEFAULT false NOT NULL,
	"specialty" varchar(80),
	"subspecialty" varchar(120),
	"academic_rank" varchar(60),
	"certification_type" varchar(80),
	"education_level" varchar(60),
	"previous_role" varchar(160),
	CONSTRAINT "credentials_employee_id_unique" UNIQUE("employee_id")
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"contract_type" "medicore_hr_db"."contract_type" NOT NULL,
	"hire_date" date NOT NULL,
	"probation_end_date" date,
	"contract_end_date" date,
	"base_salary_etb" numeric(12, 2) NOT NULL,
	"risk_allowance" varchar(20),
	"bank_name" varchar(80) NOT NULL,
	"bank_account_number" text NOT NULL,
	"pension_number" text NOT NULL,
	"tin_number" text NOT NULL,
	CONSTRAINT "contracts_employee_id_unique" UNIQUE("employee_id")
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"doc_type" varchar(80) NOT NULL,
	"status" "medicore_hr_db"."document_status" DEFAULT 'pending' NOT NULL,
	"file_attached" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_name" varchar(200),
	"file_path" text,
	"mime_type" varchar(100),
	"file_size" integer
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."emergency_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"relationship" varchar(40) NOT NULL,
	"phone" varchar(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."upload_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"token" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "upload_links_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "upload_links_token_unique" UNIQUE("token")
);

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

CREATE TABLE IF NOT EXISTS "medicore_hr_db"."sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"officer_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"ip_address" varchar(45),
	"user_agent" varchar(255),
	"refresh_token_hash" varchar(64)
);

-- Foreign keys
DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."contracts" ADD CONSTRAINT "contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."credentials" ADD CONSTRAINT "credentials_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."emergency_contacts" ADD CONSTRAINT "emergency_contacts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."employees" ADD CONSTRAINT "employees_registered_by_hr_officers_id_fk" FOREIGN KEY ("registered_by") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."upload_links" ADD CONSTRAINT "upload_links_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "medicore_hr_db"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."upload_links" ADD CONSTRAINT "upload_links_created_by_hr_officers_id_fk" FOREIGN KEY ("created_by") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."audit_logs" ADD CONSTRAINT "audit_logs_actor_officer_id_hr_officers_id_fk" FOREIGN KEY ("actor_officer_id") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "medicore_hr_db"."sessions" ADD CONSTRAINT "sessions_officer_id_hr_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "medicore_hr_db"."hr_officers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "audit_logs_actor_officer_id_idx" ON "medicore_hr_db"."audit_logs" USING btree ("actor_officer_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "medicore_hr_db"."audit_logs" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "documents_employee_id_idx" ON "medicore_hr_db"."documents" USING btree ("employee_id");
CREATE INDEX IF NOT EXISTS "employees_registered_by_idx" ON "medicore_hr_db"."employees" USING btree ("registered_by");
CREATE INDEX IF NOT EXISTS "sessions_officer_id_idx" ON "medicore_hr_db"."sessions" USING btree ("officer_id");
CREATE INDEX IF NOT EXISTS "sessions_refresh_token_hash_idx" ON "medicore_hr_db"."sessions" USING btree ("refresh_token_hash");
