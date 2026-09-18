import {
  pgSchema,
  serial,
  integer,
  varchar,
  text,
  date,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Dedicated Postgres schema. Lowercase on purpose: Postgres folds unquoted
 * identifiers to lowercase, so "Medicore_hr_db" would require quoting in every
 * raw query forever.
 */
export const app = pgSchema('medicore_hr_db');

// 'viewer' is read-only — see requireRole() in src/rbac.ts.
export const officerRoleEnum = app.enum('officer_role', ['hr_officer', 'admin', 'viewer']);

export const roleEnum = app.enum('role', ['nurse', 'doctor', 'lab', 'pharmacist', 'admin']);

export const employmentStatusEnum = app.enum('employment_status', [
  'active',
  'on_leave',
  'suspended',
  'terminated',
  'retired',
  'deceased'
]);

export const onboardingStatusEnum = app.enum('onboarding_status', [
  'in_progress', // record saved but not all sections final
  'docs_pending', // submitted, but one or more documents not yet verified
  'completed' // all documents verified — onboarding finished
]);

export const contractTypeEnum = app.enum('contract_type', ['permanent', 'fixed']);

export const documentStatusEnum = app.enum('document_status', ['pending', 'received', 'verified']);

/** HR officers — the platform's login accounts. */
export const hrOfficers = app.table('hr_officers', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 60 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  role: officerRoleEnum('role').notNull().default('hr_officer'),
  isActive: boolean('is_active').notNull().default(true),
  // Login brute-force protection — time-boxed (unlike upload_links' permanent
  // lockout) since these are real accounts, not disposable links.
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * One row per active login. The JWT cookie carries this row's id as its `sid`
 * claim so a session can be revoked server-side (logout, admin-forced
 * sign-out) instead of just waiting out the token's natural expiry.
 */
export const sessions = app.table(
  'sessions',
  {
    id: serial('id').primaryKey(),
    officerId: integer('officer_id')
      .notNull()
      .references(() => hrOfficers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: varchar('user_agent', { length: 255 }),
    // SHA-256 hex of the opaque refresh token handed to the client — the raw
    // token itself is never stored, mirroring how passwordHash never stores
    // the password. Rotated on every /api/auth/refresh call.
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 })
  },
  (t) => [
    index('sessions_officer_id_idx').on(t.officerId),
    index('sessions_refresh_token_hash_idx').on(t.refreshTokenHash)
  ]
);

/** Append-only trail of who did what — logins, PII reveals, CRUD, exports. */
export const auditLogs = app.table(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorOfficerId: integer('actor_officer_id').references(() => hrOfficers.id),
    action: varchar('action', { length: 60 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }),
    entityId: varchar('entity_id', { length: 60 }),
    metadata: jsonb('metadata'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('audit_logs_actor_officer_id_idx').on(t.actorOfficerId),
    index('audit_logs_created_at_idx').on(t.createdAt)
  ]
);

export const employees = app.table(
  'employees',
  {
  id: serial('id').primaryKey(),
  employeeCode: varchar('employee_code', { length: 20 }).notNull().unique(), // HRM-2026-0001
  registeredBy: integer('registered_by')
    .notNull()
    .references(() => hrOfficers.id),
  onboardingStatus: onboardingStatusEnum('onboarding_status').notNull().default('docs_pending'),
  fullNameLatin: varchar('full_name_latin', { length: 160 }).notNull(),
  fullNameAmharic: varchar('full_name_amharic', { length: 160 }),
  // AES-256-GCM ciphertext (base64) — see src/crypto-field.ts. `text` because
  // ciphertext + IV + auth tag runs well past the original plaintext length.
  nationalId: text('national_id').notNull(),
  // HMAC-SHA256 blind index of the plaintext national ID — lets us enforce
  // uniqueness via an indexed lookup without the encrypted column (whose
  // ciphertext differs per row even for the same plaintext) being usable
  // for that. Nullable so legacy pre-existing rows don't block on backfill
  // (see src/db/backfill-national-id-hash.ts); a plain unique index still
  // allows any number of NULLs in Postgres.
  nationalIdHash: varchar('national_id_hash', { length: 64 }).unique(),
  dob: date('dob').notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  email: varchar('email', { length: 160 }),
  gender: varchar('gender', { length: 16 }),
  employmentType: varchar('employment_type', { length: 60 }).notNull(),
  department: varchar('department', { length: 60 }).notNull(),
  jobCategory: varchar('job_category', { length: 60 }).notNull(),
  role: roleEnum('role').notNull(),
  eduQualification: text('edu_qualification'),
  jobGrade: varchar('job_grade', { length: 20 }),
  specializationText: varchar('specialization_text', { length: 160 }),
  employmentStatus: employmentStatusEnum('employment_status').notNull().default('active'),
  statusEffectiveDate: date('status_effective_date'),
  handbookIssued: boolean('handbook_issued').notNull().default(false),
  conductSigned: boolean('conduct_signed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  // scope() filters every hr_officer list/detail query by registered_by.
  (t) => [index('employees_registered_by_idx').on(t.registeredBy)]
);

// One row per employee — role-specific columns stay null for other roles.
export const credentials = app.table('credentials', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: 'cascade' }),
  licenseNumber: varchar('license_number', { length: 60 }),
  licenseExpiry: date('license_expiry'),
  // nurse
  nurseGrade: varchar('nurse_grade', { length: 40 }),
  yearsExperience: integer('years_experience'),
  cprCertified: boolean('cpr_certified').notNull().default(false),
  // doctor
  boardCertNumber: varchar('board_cert_number', { length: 60 }),
  onCallEligible: boolean('on_call_eligible').notNull().default(false),
  specialty: varchar('specialty', { length: 80 }),
  subspecialty: varchar('subspecialty', { length: 120 }),
  academicRank: varchar('academic_rank', { length: 60 }),
  // lab / pharmacist
  certificationType: varchar('certification_type', { length: 80 }),
  // admin / support
  educationLevel: varchar('education_level', { length: 60 }),
  previousRole: varchar('previous_role', { length: 160 })
});

export const contracts = app.table('contracts', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: 'cascade' }),
  contractType: contractTypeEnum('contract_type').notNull(),
  hireDate: date('hire_date').notNull(),
  probationEndDate: date('probation_end_date'),
  contractEndDate: date('contract_end_date'),
  baseSalaryEtb: numeric('base_salary_etb', { precision: 12, scale: 2 }).notNull(),
  riskAllowance: varchar('risk_allowance', { length: 20 }),
  bankName: varchar('bank_name', { length: 80 }).notNull(),
  // Encrypted at rest (AES-256-GCM, base64) — see src/crypto-field.ts.
  bankAccountNumber: text('bank_account_number').notNull(),
  pensionNumber: text('pension_number').notNull(),
  tinNumber: text('tin_number').notNull()
});

export const documents = app.table(
  'documents',
  {
    id: serial('id').primaryKey(),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    docType: varchar('doc_type', { length: 80 }).notNull(),
    status: documentStatusEnum('status').notNull().default('pending'),
    fileAttached: boolean('file_attached').notNull().default(false),
    fileName: varchar('file_name', { length: 200 }),
    filePath: text('file_path'),
    mimeType: varchar('mime_type', { length: 100 }),
    fileSize: integer('file_size'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  // The employee list/CSV export run two correlated count subqueries against
  // documents per employee row — without this index each is a seq scan.
  (t) => [index('documents_employee_id_idx').on(t.employeeId)]
);

/**
 * One shareable self-service upload link per employee. HR generates it, sends
 * it to the employee; the employee proves identity with the last 4 digits of
 * their employee code and uploads documents themselves.
 */
export const uploadLinks = app.table('upload_links', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Wrong-last4 attempts. The link is auto-expired once this hits the lockout
  // threshold — see verifyPortalIdentity() in routes/upload-links.ts.
  failedAttempts: integer('failed_attempts').notNull().default(0),
  createdBy: integer('created_by')
    .notNull()
    .references(() => hrOfficers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const emergencyContacts = app.table('emergency_contacts', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  relationship: varchar('relationship', { length: 40 }).notNull(),
  phone: varchar('phone', { length: 32 }).notNull()
});

export const hrOfficersRelations = relations(hrOfficers, ({ many }) => ({
  employees: many(employees),
  sessions: many(sessions)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  officer: one(hrOfficers, { fields: [sessions.officerId], references: [hrOfficers.id] })
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(hrOfficers, { fields: [auditLogs.actorOfficerId], references: [hrOfficers.id] })
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  registrar: one(hrOfficers, { fields: [employees.registeredBy], references: [hrOfficers.id] }),
  credential: one(credentials, { fields: [employees.id], references: [credentials.employeeId] }),
  contract: one(contracts, { fields: [employees.id], references: [contracts.employeeId] }),
  documents: many(documents),
  emergencyContacts: many(emergencyContacts),
  uploadLink: one(uploadLinks, { fields: [employees.id], references: [uploadLinks.employeeId] })
}));

export const uploadLinksRelations = relations(uploadLinks, ({ one }) => ({
  employee: one(employees, { fields: [uploadLinks.employeeId], references: [employees.id] })
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  employee: one(employees, { fields: [credentials.employeeId], references: [employees.id] })
}));

export const contractsRelations = relations(contracts, ({ one }) => ({
  employee: one(employees, { fields: [contracts.employeeId], references: [employees.id] })
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  employee: one(employees, { fields: [documents.employeeId], references: [employees.id] })
}));

export const emergencyContactsRelations = relations(emergencyContacts, ({ one }) => ({
  employee: one(employees, { fields: [emergencyContacts.employeeId], references: [employees.id] })
}));
