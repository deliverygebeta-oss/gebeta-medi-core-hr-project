import { Hono } from 'hono';
import { and, desc, eq, isNull, like, sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { contracts, credentials, documents, emergencyContacts, employees, hrOfficers, uploadLinks } from '../db/schema';
import { createEmployeeSchema, updateEmployeeSchema } from '../validation';
import { officer, requireAuth, type OfficerClaims } from '../auth';
import { requireRole } from '../rbac';
import { clientIp, logAudit } from '../audit';
import { rateLimit } from '../rate-limit';
import { encryptField, decryptField, decryptFieldSafe, hashField, maskTail } from '../crypto-field';
import {
  deleteEmployeeFolders,
  documentFile,
  sanitizeHeaderFilename,
  saveDocumentFile,
  StorageError
} from '../storage';

const app = new Hono();
app.use('*', requireAuth);
// Authenticated main API — keyed by officer id (not just IP) so an office
// full of people behind one NAT'd IP don't throttle each other.
app.use(
  '*',
  rateLimit({ windowMs: 60_000, max: 180, keyFn: (c) => String(officer(c).sub) })
);

const emptyToNull = (v: string | undefined) => (v ? v : null);

// Reduces a phone number to its bare 9-digit Ethiopian subscriber number so
// "+251 91 234 5678", "251912345678" and "0912345678" all compare equal for
// duplicate detection, without changing what's actually stored/displayed.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('251')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * hr_officer only sees what they registered. admin AND viewer see the whole
 * hospital — a read-only viewer scoped to "employees they registered" would
 * see nothing, since a viewer never registers anyone.
 */
function scope(claims: OfficerClaims) {
  return claims.role === 'hr_officer' ? eq(employees.registeredBy, claims.sub) : undefined;
}

function computeOnboardingStatus(
  docs: { status: string }[]
): 'docs_pending' | 'completed' {
  return docs.length > 0 && docs.every((d) => d.status === 'verified')
    ? 'completed'
    : 'docs_pending';
}

async function nextEmployeeCode(tx: typeof db = db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `HRM-${year}-`;
  const [row] = await tx
    .select({ max: dsql<string | null>`max(${employees.employeeCode})` })
    .from(employees)
    .where(like(employees.employeeCode, `${prefix}%`));
  const lastSeq = row?.max ? parseInt(row.max.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Employee row with nationalId decrypted (still needs masking for most responses). */
function decryptEmployee<T extends { nationalId: string }>(row: T): T {
  return { ...row, nationalId: decryptFieldSafe(row.nationalId) };
}

/** Contract row with bank/pension/TIN decrypted. */
function decryptContract<T extends { bankAccountNumber: string; pensionNumber: string; tinNumber: string }>(
  row: T
): T {
  return {
    ...row,
    bankAccountNumber: decryptFieldSafe(row.bankAccountNumber),
    pensionNumber: decryptFieldSafe(row.pensionNumber),
    tinNumber: decryptFieldSafe(row.tinNumber)
  };
}

function maskEmployee<T extends { nationalId: string }>(row: T): T {
  return { ...row, nationalId: maskTail(row.nationalId) };
}

function maskContract<T extends { bankAccountNumber: string; pensionNumber: string; tinNumber: string }>(
  row: T
): T {
  return {
    ...row,
    bankAccountNumber: maskTail(row.bankAccountNumber),
    pensionNumber: maskTail(row.pensionNumber),
    tinNumber: maskTail(row.tinNumber)
  };
}

/**
 * Decrypt-then-mask an employee (+ optional nested contract) for a normal API
 * response. Full plaintext is only ever returned by the dedicated, audited
 * /reveal endpoint.
 */
function sanitizeForResponse<T extends { nationalId: string; contract?: unknown }>(employee: T): T {
  let safe = maskEmployee(decryptEmployee(employee));
  if (
    safe.contract &&
    typeof safe.contract === 'object' &&
    'bankAccountNumber' in (safe.contract as object)
  ) {
    safe = {
      ...safe,
      contract: maskContract(decryptContract(safe.contract as Parameters<typeof decryptContract>[0]))
    };
  }
  return safe;
}

/** Preview the next employee code (shown in the ID banner before submit). */
app.get('/next-code', async (c) => {
  return c.json({ employeeCode: await nextEmployeeCode() });
});

/** Server-side CSV export — scoped, audited, and ahead of /:id so "export.csv" never matches as an id. */
app.get('/export.csv', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const rows = await db
    .select({
      employeeCode: employees.employeeCode,
      fullNameLatin: employees.fullNameLatin,
      role: employees.role,
      department: employees.department,
      employmentStatus: employees.employmentStatus,
      onboardingStatus: employees.onboardingStatus,
      contractType: contracts.contractType,
      createdAt: employees.createdAt,
      docsTotal: dsql<number>`(select count(*)::int from ${documents} d where d.employee_id = ${employees.id})`,
      docsVerified: dsql<number>`(select count(*)::int from ${documents} d where d.employee_id = ${employees.id} and d.status = 'verified')`
    })
    .from(employees)
    .leftJoin(contracts, eq(contracts.employeeId, employees.id))
    .where(scope(claims))
    .orderBy(desc(employees.id));

  // Quote + double embedded quotes, and neutralize spreadsheet formula
  // injection: a name entered as "=HYPERLINK(...)" would otherwise execute
  // when the export is opened in Excel. The apostrophe prefix is Excel's own
  // "treat as text" marker.
  const csvCell = (value: string) => {
    const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ['Employee ID', 'Name', 'Role', 'Department', 'Employment Status', 'Onboarding Status', 'Progress', 'Registered Date'];
  const csvRows = rows.map((e) => [
    csvCell(e.employeeCode),
    csvCell(e.fullNameLatin),
    csvCell(e.role),
    csvCell(e.department),
    csvCell(e.employmentStatus),
    csvCell(e.onboardingStatus),
    csvCell(`${e.docsVerified}/${e.docsTotal}`),
    csvCell(e.createdAt.toISOString())
  ]);
  const csv = [header.join(','), ...csvRows.map((r) => r.join(','))].join('\n');

  await logAudit({
    actorOfficerId: claims.sub,
    action: 'csv_exported',
    metadata: { count: rows.length },
    ipAddress: clientIp(c)
  });

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="medicore_export_${new Date().toISOString().split('T')[0]}.csv"`);
  return c.body(csv);
});

/** Dashboard stats for the logged-in officer (admin/viewer: hospital-wide). */
app.get('/stats', async (c) => {
  const claims = officer(c);
  const rows = await db
    .select({
      onboardingStatus: employees.onboardingStatus,
      count: dsql<number>`count(*)::int`
    })
    .from(employees)
    .where(scope(claims))
    .groupBy(employees.onboardingStatus);

  const byStatus = Object.fromEntries(rows.map((r) => [r.onboardingStatus, r.count]));
  return c.json({
    total: rows.reduce((sum, r) => sum + r.count, 0),
    completed: byStatus.completed ?? 0,
    docsPending: byStatus.docs_pending ?? 0,
    inProgress: byStatus.in_progress ?? 0
  });
});

/**
 * List employees registered by the logged-in officer, with document progress.
 * Optional ?limit= & ?offset= — omitted, the full list is returned (the
 * frontend paginates client-side today; this is the escape hatch for when
 * the table outgrows a single response).
 */
app.get('/', async (c) => {
  const claims = officer(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 0, 0), 500);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
  let query = db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullNameLatin: employees.fullNameLatin,
      role: employees.role,
      department: employees.department,
      employmentStatus: employees.employmentStatus,
      onboardingStatus: employees.onboardingStatus,
      contractType: contracts.contractType,
      createdAt: employees.createdAt,
      docsTotal: dsql<number>`(select count(*)::int from ${documents} d where d.employee_id = ${employees.id})`,
      docsVerified: dsql<number>`(select count(*)::int from ${documents} d where d.employee_id = ${employees.id} and d.status = 'verified')`
    })
    .from(employees)
    .leftJoin(contracts, eq(contracts.employeeId, employees.id))
    .where(scope(claims))
    .orderBy(desc(employees.id))
    .$dynamic();
  if (limit > 0) query = query.limit(limit).offset(offset);
  return c.json(await query);
});

/** Full record with credentials, contract, documents and emergency contacts — PII masked by default. */
app.get('/:id', async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const where = claims.role === 'hr_officer'
    ? and(eq(employees.id, id), eq(employees.registeredBy, claims.sub))
    : eq(employees.id, id);

  const employee = await db.query.employees.findFirst({
    where,
    with: {
      credential: true,
      contract: true,
      documents: true,
      emergencyContacts: true,
      uploadLink: true,
      registrar: { columns: { id: true, username: true, fullName: true } }
    }
  });

  if (!employee) return c.json({ error: 'Employee not found' }, 404);
  return c.json(sanitizeForResponse(employee));
});

/**
 * Reveal full, unmasked PII for one employee. A separate, deliberate action
 * (not folded into GET /:id) so every view of a raw national ID / bank
 * account is individually audited — masked-by-default is the norm, this is
 * the exception that leaves a trail.
 */
app.post('/:id/reveal', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const where = claims.role === 'hr_officer'
    ? and(eq(employees.id, id), eq(employees.registeredBy, claims.sub))
    : eq(employees.id, id);

  const employee = await db.query.employees.findFirst({ where, with: { contract: true } });
  if (!employee) return c.json({ error: 'Employee not found' }, 404);

  const contract = employee.contract ? decryptContract(employee.contract) : null;

  await logAudit({
    actorOfficerId: claims.sub,
    action: 'pii_revealed',
    entityType: 'employee',
    entityId: id,
    ipAddress: clientIp(c)
  });

  return c.json({
    nationalId: decryptFieldSafe(employee.nationalId),
    bankAccountNumber: contract?.bankAccountNumber ?? null,
    pensionNumber: contract?.pensionNumber ?? null,
    tinNumber: contract?.tinNumber ?? null
  });
});

/** Update a document's status / attachment and recompute onboarding status. */
const patchDocSchema = z.object({
  status: z.enum(['pending', 'received', 'verified']).optional(),
  fileAttached: z.boolean().optional()
});

app.patch('/:id/documents/:docId', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  const docId = Number(c.req.param('docId'));
  if (!Number.isInteger(id) || !Number.isInteger(docId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = patchDocSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed' }, 422);

  const ownerWhere = claims.role === 'hr_officer'
    ? and(eq(employees.id, id), eq(employees.registeredBy, claims.sub))
    : eq(employees.id, id);
  const [owner] = await db.select({ id: employees.id }).from(employees).where(ownerWhere);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(documents.id, docId), eq(documents.employeeId, id)))
      .returning();
    if (!updated) return null;

    const docs = await tx
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.employeeId, id));
    const onboardingStatus = computeOnboardingStatus(docs);
    await tx
      .update(employees)
      .set({ onboardingStatus, updatedAt: new Date() })
      .where(eq(employees.id, id));

    return { document: updated, onboardingStatus };
  });

  if (!result) return c.json({ error: 'Document not found' }, 404);
  await logAudit({
    actorOfficerId: claims.sub,
    action: 'document_status_changed',
    entityType: 'document',
    entityId: docId,
    metadata: { employeeId: id, status: result.document.status },
    ipAddress: clientIp(c)
  });
  return c.json(result);
});

/** Look up an employee the current officer is allowed to touch. */
async function ownedEmployee(claims: OfficerClaims, id: number) {
  const where = claims.role === 'hr_officer'
    ? and(eq(employees.id, id), eq(employees.registeredBy, claims.sub))
    : eq(employees.id, id);
  const [row] = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      fullNameLatin: employees.fullNameLatin
    })
    .from(employees)
    .where(where);
  return row;
}

/** Upload a document file into the HR-EMP-FILE bucket. */
app.post('/:id/documents/:docId/file', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  const docId = Number(c.req.param('docId'));
  if (!Number.isInteger(id) || !Number.isInteger(docId)) return c.json({ error: 'Invalid id' }, 400);

  const owner = await ownedEmployee(claims, id);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.employeeId, id)));
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'Attach the file in a "file" form field' }, 400);

  try {
    const stored = await saveDocumentFile(owner.employeeCode, owner.fullNameLatin, doc.docType, file);
    const [updated] = await db
      .update(documents)
      .set({ ...stored, fileAttached: true, updatedAt: new Date() })
      .where(eq(documents.id, docId))
      .returning();
    await logAudit({
      actorOfficerId: claims.sub,
      action: 'document_uploaded',
      entityType: 'document',
      entityId: docId,
      metadata: { employeeId: id, fileName: stored.fileName },
      ipAddress: clientIp(c)
    });
    return c.json(updated);
  } catch (err) {
    if (err instanceof StorageError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

/** Download a previously uploaded document file. */
app.get('/:id/documents/:docId/file', async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  const docId = Number(c.req.param('docId'));
  if (!Number.isInteger(id) || !Number.isInteger(docId)) return c.json({ error: 'Invalid id' }, 400);

  const owner = await ownedEmployee(claims, id);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.employeeId, id)));
  if (!doc?.filePath) return c.json({ error: 'No file uploaded for this document' }, 404);

  const file = documentFile(doc.filePath);
  if (!(await file.exists())) return c.json({ error: 'File is missing from the bucket' }, 404);

  // These files are ID scans and certificates — viewing one is as sensitive
  // as a PII reveal, so it leaves the same kind of trail.
  await logAudit({
    actorOfficerId: claims.sub,
    action: 'document_downloaded',
    entityType: 'document',
    entityId: docId,
    metadata: { employeeId: id, fileName: doc.fileName },
    ipAddress: clientIp(c)
  });

  c.header('Content-Type', doc.mimeType ?? 'application/octet-stream');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header(
    'Content-Disposition',
    `attachment; filename="${sanitizeHeaderFilename(doc.fileName ?? 'document')}"`
  );
  return c.body(file.stream());
});

/** Update employee (and optionally contract) fields. */
app.patch('/:id', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const owner = await ownedEmployee(claims, id);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = updateEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422);
  }
  const { contract, ...fields } = parsed.data;

  if (typeof fields.phone === 'string') {
    const normalizedPhone = normalizePhone(fields.phone);
    const allPhones = await db
      .select({ id: employees.id, employeeCode: employees.employeeCode, phone: employees.phone })
      .from(employees);
    const conflict = allPhones.find((e) => e.id !== id && normalizePhone(e.phone) === normalizedPhone);
    if (conflict) {
      return c.json({ error: `Phone number is already registered to employee ${conflict.employeeCode}` }, 409);
    }
  }

  let nextNationalIdHash: string | undefined;
  if (typeof fields.nationalId === 'string') {
    const normalizedNationalId = fields.nationalId.trim();
    nextNationalIdHash = hashField(normalizedNationalId);

    const [hashMatch] = await db
      .select({ id: employees.id, employeeCode: employees.employeeCode })
      .from(employees)
      .where(eq(employees.nationalIdHash, nextNationalIdHash));
    if (hashMatch && hashMatch.id !== id) {
      return c.json({ error: `National ID is already registered to employee ${hashMatch.employeeCode}` }, 409);
    }
    const unhashedRows = await db
      .select({ id: employees.id, employeeCode: employees.employeeCode, nationalId: employees.nationalId })
      .from(employees)
      .where(isNull(employees.nationalIdHash));
    const legacyConflict = unhashedRows.find(
      (e) => e.id !== id && decryptFieldSafe(e.nationalId).trim() === normalizedNationalId
    );
    if (legacyConflict) {
      return c.json({ error: `National ID is already registered to employee ${legacyConflict.employeeCode}` }, 409);
    }
  }

  try {
  await db.transaction(async (tx) => {
    const employeeSet: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(fields)) {
      if (value === '') {
        employeeSet[key] = null;
      } else if (key === 'nationalId' && typeof value === 'string') {
        employeeSet[key] = encryptField(value);
        employeeSet.nationalIdHash = nextNationalIdHash;
      } else {
        employeeSet[key] = value;
      }
    }
    // fullNameLatin can never be null — an empty edit keeps the old name
    if (employeeSet.fullNameLatin === null) delete employeeSet.fullNameLatin;
    await tx.update(employees).set(employeeSet).where(eq(employees.id, id));

    if (contract && Object.keys(contract).length > 0) {
      const contractSet: Record<string, unknown> = {};
      if (contract.baseSalaryEtb !== undefined) contractSet.baseSalaryEtb = String(contract.baseSalaryEtb);
      if (contract.bankName !== undefined) contractSet.bankName = contract.bankName;
      if (contract.bankAccountNumber !== undefined) contractSet.bankAccountNumber = encryptField(contract.bankAccountNumber);
      if (contract.pensionNumber !== undefined) contractSet.pensionNumber = encryptField(contract.pensionNumber);
      if (contract.tinNumber !== undefined) contractSet.tinNumber = encryptField(contract.tinNumber);
      await tx.update(contracts).set(contractSet).where(eq(contracts.employeeId, id));
    }
  });
  } catch (err: any) {
    if (err?.code === '23505' && String(err?.constraint_name ?? '').includes('national_id_hash')) {
      return c.json({ error: 'National ID is already registered to another employee' }, 409);
    }
    throw err;
  }

  await logAudit({
    actorOfficerId: claims.sub,
    action: 'employee_updated',
    entityType: 'employee',
    entityId: id,
    metadata: { fields: Object.keys(fields), contractFields: contract ? Object.keys(contract) : [] },
    ipAddress: clientIp(c)
  });

  const updated = await db.query.employees.findFirst({
    where: eq(employees.id, id),
    with: { credential: true, contract: true, documents: true, emergencyContacts: true }
  });
  return c.json(updated ? sanitizeForResponse(updated) : updated);
});

/** Delete an employee record and their document folder. */
app.delete('/:id', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const owner = await ownedEmployee(claims, id);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  await db.delete(employees).where(eq(employees.id, id)); // FK cascade removes child rows
  await deleteEmployeeFolders(owner.employeeCode);
  await logAudit({
    actorOfficerId: claims.sub,
    action: 'employee_deleted',
    entityType: 'employee',
    entityId: id,
    metadata: { employeeCode: owner.employeeCode, fullNameLatin: owner.fullNameLatin },
    ipAddress: clientIp(c)
  });
  return c.json({ deleted: true, employeeCode: owner.employeeCode });
});

/** Reassign an employee to a different HR officer — admin only, audited. */
const reassignSchema = z.object({ newOfficerId: z.number().int().positive() });

app.post('/:id/reassign', requireRole('admin'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = reassignSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'newOfficerId is required' }, 422);

  const [target] = await db.select().from(hrOfficers).where(eq(hrOfficers.id, parsed.data.newOfficerId));
  if (!target || !target.isActive) return c.json({ error: 'Target officer not found or inactive' }, 404);

  const [existing] = await db.select({ id: employees.id, registeredBy: employees.registeredBy }).from(employees).where(eq(employees.id, id));
  if (!existing) return c.json({ error: 'Employee not found' }, 404);

  await db.update(employees).set({ registeredBy: target.id, updatedAt: new Date() }).where(eq(employees.id, id));
  await logAudit({
    actorOfficerId: claims.sub,
    action: 'employee_reassigned',
    entityType: 'employee',
    entityId: id,
    metadata: { fromOfficerId: existing.registeredBy, toOfficerId: target.id },
    ipAddress: clientIp(c)
  });

  return c.json({ reassigned: true, employeeId: id, newOfficerId: target.id });
});

/** Create a full onboarding record in one transaction, owned by the officer. */
app.post('/', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const parsed = createEmployeeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.flatten() }, 422);
  }
  const input = parsed.data;

  const normalizedPhone = normalizePhone(input.phone);
  const normalizedNationalId = input.nationalId.trim();
  const nationalIdHash = hashField(normalizedNationalId);

  // Phone is stored in plaintext — the table is a hospital's staff register
  // (hundreds, not millions of rows), so a normalized in-memory comparison
  // is simpler and plenty fast; no need for a computed column.
  const allPhones = await db.select({ employeeCode: employees.employeeCode, phone: employees.phone }).from(employees);
  const phoneConflict = allPhones.find((e) => normalizePhone(e.phone) === normalizedPhone);
  if (phoneConflict) {
    return c.json(
      { error: `Phone number is already registered to employee ${phoneConflict.employeeCode}` },
      409
    );
  }

  // National ID is encrypted at rest, so it can't be matched with a plain
  // WHERE — compare via the blind-index hash (indexed, O(1)) plus a
  // decrypt-fallback for any legacy rows a backfill hasn't hashed yet.
  const [hashMatch] = await db
    .select({ employeeCode: employees.employeeCode })
    .from(employees)
    .where(eq(employees.nationalIdHash, nationalIdHash));
  if (hashMatch) {
    return c.json(
      { error: `National ID is already registered to employee ${hashMatch.employeeCode}` },
      409
    );
  }
  const unhashedRows = await db
    .select({ employeeCode: employees.employeeCode, nationalId: employees.nationalId })
    .from(employees)
    .where(isNull(employees.nationalIdHash));
  const legacyConflict = unhashedRows.find(
    (e) => decryptFieldSafe(e.nationalId).trim() === normalizedNationalId
  );
  if (legacyConflict) {
    return c.json(
      { error: `National ID is already registered to employee ${legacyConflict.employeeCode}` },
      409
    );
  }

  let created;
  // nextEmployeeCode() is max()+1 — two simultaneous registrations can pick
  // the same code and the unique constraint aborts one of them. That loser
  // just needs a fresh code, so retry the whole transaction a couple of
  // times before giving up.
  for (let attempt = 1; ; attempt++) {
  try {
    created = await db.transaction(async (tx) => {
    const employeeCode = await nextEmployeeCode(tx as unknown as typeof db);

    const [employee] = await tx
      .insert(employees)
      .values({
        employeeCode,
        registeredBy: claims.sub,
        onboardingStatus: computeOnboardingStatus(input.documents),
        fullNameLatin: input.fullNameLatin,
        fullNameAmharic: emptyToNull(input.fullNameAmharic),
        nationalId: encryptField(input.nationalId),
        nationalIdHash,
        dob: input.dob,
        phone: input.phone,
        email: emptyToNull(input.email),
        gender: emptyToNull(input.gender),
        employmentType: input.employmentType,
        department: input.department,
        jobCategory: input.jobCategory,
        role: input.role,
        eduQualification: emptyToNull(input.eduQualification),
        jobGrade: emptyToNull(input.jobGrade),
        specializationText: emptyToNull(input.specializationText),
        employmentStatus: input.employmentStatus,
        statusEffectiveDate: emptyToNull(input.statusEffectiveDate),
        handbookIssued: input.handbookIssued,
        conductSigned: input.conductSigned
      })
      .returning();

    await tx.insert(credentials).values({
      employeeId: employee.id,
      licenseNumber: emptyToNull(input.credential.licenseNumber),
      licenseExpiry: emptyToNull(input.credential.licenseExpiry),
      nurseGrade: emptyToNull(input.credential.nurseGrade),
      yearsExperience: input.credential.yearsExperience ?? null,
      cprCertified: input.credential.cprCertified,
      boardCertNumber: emptyToNull(input.credential.boardCertNumber),
      onCallEligible: input.credential.onCallEligible,
      specialty: emptyToNull(input.credential.specialty),
      subspecialty: emptyToNull(input.credential.subspecialty),
      academicRank: emptyToNull(input.credential.academicRank),
      certificationType: emptyToNull(input.credential.certificationType),
      educationLevel: emptyToNull(input.credential.educationLevel),
      previousRole: emptyToNull(input.credential.previousRole)
    });

    await tx.insert(contracts).values({
      employeeId: employee.id,
      contractType: input.contract.contractType,
      hireDate: input.contract.hireDate,
      probationEndDate: emptyToNull(input.contract.probationEndDate),
      contractEndDate: emptyToNull(input.contract.contractEndDate),
      baseSalaryEtb: String(input.contract.baseSalaryEtb),
      riskAllowance: emptyToNull(input.contract.riskAllowance),
      bankName: input.contract.bankName,
      bankAccountNumber: encryptField(input.contract.bankAccountNumber),
      pensionNumber: encryptField(input.contract.pensionNumber),
      tinNumber: encryptField(input.contract.tinNumber)
    });

    if (input.documents.length > 0) {
      await tx.insert(documents).values(
        input.documents.map((d) => ({
          employeeId: employee.id,
          docType: d.docType,
          status: d.status,
          fileAttached: d.fileAttached
        }))
      );
    }

    await tx.insert(emergencyContacts).values({
      employeeId: employee.id,
      name: input.emergencyContact.name,
      relationship: input.emergencyContact.relationship,
      phone: input.emergencyContact.phone
    });

    return employee;
    });
    break;
  } catch (err: any) {
    // Safety net for the narrow race window between the checks above and
    // this insert (two officers submitting the same national ID at once) —
    // the unique index on national_id_hash is the actual source of truth.
    const constraint = String(err?.constraint_name ?? '');
    if (err?.code === '23505' && constraint.includes('national_id_hash')) {
      return c.json({ error: 'National ID is already registered to another employee' }, 409);
    }
    if (err?.code === '23505' && constraint.includes('employee_code') && attempt < 3) {
      continue;
    }
    throw err;
  }
  }

  await logAudit({
    actorOfficerId: claims.sub,
    action: 'employee_created',
    entityType: 'employee',
    entityId: created.id,
    metadata: { employeeCode: created.employeeCode },
    ipAddress: clientIp(c)
  });

  // Return the plaintext we already have in hand rather than re-decrypting.
  return c.json({ ...created, nationalId: input.nationalId }, 201);
});

/** Generate or renew a self-service upload link for an employee (expires in 7 days). */
app.post('/:id/upload-link', requireRole('admin', 'hr_officer'), async (c) => {
  const claims = officer(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const owner = await ownedEmployee(claims, id);
  if (!owner) return c.json({ error: 'Employee not found' }, 404);

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

  const [link] = await db
    .insert(uploadLinks)
    .values({
      employeeId: id,
      token,
      expiresAt,
      createdBy: claims.sub,
      createdAt: new Date()
    })
    .onConflictDoUpdate({
      target: uploadLinks.employeeId,
      set: {
        token,
        expiresAt,
        // A renewed link starts with a clean attempt budget — the old
        // counter belonged to the previous, now-replaced token.
        failedAttempts: 0,
        createdAt: new Date()
      }
    })
    .returning();

  await logAudit({
    actorOfficerId: claims.sub,
    action: 'upload_link_generated',
    entityType: 'employee',
    entityId: id,
    ipAddress: clientIp(c)
  });

  return c.json({
    token: link.token,
    expiresAt: link.expiresAt,
    url: `/upload/${link.token}`
  });
});

export default app;
