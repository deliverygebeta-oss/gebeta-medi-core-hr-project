import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { documents, uploadLinks } from '../db/schema';
import { saveDocumentFile, StorageError } from '../storage';

const app = new Hono();

const MAX_ATTEMPTS = 5;

type PortalDenied = { ok: false; status: 401 | 404 | 410 | 422; error: string };
type PortalGranted = {
  ok: true;
  employee: {
    id: number;
    employeeCode: string;
    fullNameLatin: string;
    fullNameAmharic: string | null;
    department: string;
    role: string;
    onboardingStatus: string;
    documents: (typeof documents.$inferSelect)[];
  };
  expiresAt: Date;
};

/**
 * The single gate every portal request must pass — token AND last4 are
 * re-checked on every call (verify, status poll, upload), not just once at
 * "login". This is deliberate: a bare token (e.g. leaked via a forwarded
 * message or browser history) must not be enough on its own to read or
 * modify an employee's documents.
 *
 * Wrong last4 counts against a per-link attempt budget; hitting the limit
 * expires the link outright so a script can't grind through the (small,
 * sequential) employee-code keyspace.
 */
async function verifyPortalIdentity(token: string, rawLast4: string): Promise<PortalGranted | PortalDenied> {
  const last4 = (rawLast4 ?? '').toString().trim();
  if (!/^\d{4}$/.test(last4)) {
    return { ok: false, status: 422, error: 'Enter exactly 4 digits from your Employee ID' };
  }

  const link = await db.query.uploadLinks.findFirst({
    where: eq(uploadLinks.token, token),
    with: { employee: { with: { documents: true } } }
  });
  if (!link) return { ok: false, status: 404, error: 'Link not found' };
  if (new Date() > new Date(link.expiresAt)) {
    return {
      ok: false,
      status: 410,
      error: 'This link has expired. Ask your HR officer to generate a new one.'
    };
  }

  const codeLast4 = link.employee.employeeCode.slice(-4);
  if (codeLast4 !== last4) {
    // Increment in SQL, not read-modify-write — parallel wrong guesses must
    // each consume an attempt instead of racing to write the same count.
    const [{ attempts }] = await db
      .update(uploadLinks)
      .set({ failedAttempts: sql`${uploadLinks.failedAttempts} + 1` })
      .where(eq(uploadLinks.id, link.id))
      .returning({ attempts: uploadLinks.failedAttempts });
    if (attempts >= MAX_ATTEMPTS) {
      // Lock the link out entirely rather than time-box it — a fresh link
      // from HR is the only way back in, closing off further guesses.
      await db
        .update(uploadLinks)
        .set({ expiresAt: new Date() })
        .where(eq(uploadLinks.id, link.id));
      return {
        ok: false,
        status: 410,
        error: 'Too many incorrect attempts. This link has expired — ask your HR officer for a new one.'
      };
    }
    const remaining = MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      status: 401,
      error: `Incorrect Employee ID digits. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
    };
  }

  if (link.failedAttempts > 0) {
    await db.update(uploadLinks).set({ failedAttempts: 0 }).where(eq(uploadLinks.id, link.id));
  }

  return { ok: true, employee: link.employee, expiresAt: link.expiresAt };
}

function docSummary(d: typeof documents.$inferSelect) {
  return {
    id: d.id,
    docType: d.docType,
    status: d.status,
    fileAttached: d.fileAttached,
    fileName: d.fileName,
    fileSize: d.fileSize,
    updatedAt: d.updatedAt
  };
}

/**
 * POST /api/upload-links/:token/verify
 * Body: { last4: string }
 * First identity check — also returns the document list so the portal can
 * render immediately without a second round trip.
 */
app.post('/:token/verify', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json().catch(() => null);
  const result = await verifyPortalIdentity(token, body?.last4);
  if (!result.ok) return c.json({ error: result.error }, result.status);

  return c.json({
    verified: true,
    employee: {
      id: result.employee.id,
      employeeCode: result.employee.employeeCode,
      fullNameLatin: result.employee.fullNameLatin,
      fullNameAmharic: result.employee.fullNameAmharic,
      department: result.employee.department,
      role: result.employee.role
    },
    documents: result.employee.documents.map(docSummary),
    expiresAt: result.expiresAt
  });
});

/**
 * POST /api/upload-links/:token/documents/:docId/file
 * Multipart body: file + last4. Employee uploads a file for one of their
 * documents — last4 is required again here, not just at /verify.
 */
app.post('/:token/documents/:docId/file', async (c) => {
  const token = c.req.param('token');
  const docId = Number(c.req.param('docId'));
  if (!Number.isInteger(docId)) return c.json({ error: 'Invalid document id' }, 400);

  const body = await c.req.parseBody();
  const result = await verifyPortalIdentity(token, body.last4 as string);
  if (!result.ok) return c.json({ error: result.error }, result.status);

  const doc = result.employee.documents.find((d) => d.id === docId);
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'Attach the file in a "file" form field' }, 400);
  }

  try {
    const stored = await saveDocumentFile(
      result.employee.employeeCode,
      result.employee.fullNameLatin,
      doc.docType,
      file
    );
    const [updated] = await db
      .update(documents)
      .set({
        ...stored,
        fileAttached: true,
        status: 'received', // auto-advance to received when employee uploads
        updatedAt: new Date()
      })
      .where(and(eq(documents.id, docId), eq(documents.employeeId, result.employee.id)))
      .returning();

    return c.json(docSummary(updated));
  } catch (err) {
    if (err instanceof StorageError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

/**
 * GET /api/upload-links/:token/status?last4=1234
 * Employee polls for updated document statuses. Query param since this is a
 * GET — last4 is required here too, for the same reason as upload.
 */
app.get('/:token/status', async (c) => {
  const token = c.req.param('token');
  const result = await verifyPortalIdentity(token, c.req.query('last4') ?? '');
  if (!result.ok) return c.json({ error: result.error }, result.status);

  return c.json({
    employee: {
      fullNameLatin: result.employee.fullNameLatin,
      onboardingStatus: result.employee.onboardingStatus
    },
    documents: result.employee.documents.map(docSummary),
    expiresAt: result.expiresAt
  });
});

export default app;
