import type { Context } from 'hono';
import { db } from './db';
import { auditLogs } from './db/schema';

/** Keep this list in sync with every call site — it's the vocabulary of the trail. */
export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'login_locked'
  | 'logout'
  | 'employee_created'
  | 'employee_updated'
  | 'employee_deleted'
  | 'employee_reassigned'
  | 'document_status_changed'
  | 'document_uploaded'
  | 'document_downloaded'
  | 'pii_revealed'
  | 'upload_link_generated'
  | 'csv_exported';

/**
 * Last X-Forwarded-For entry, not the first: the reverse proxy appends the
 * address it actually saw, while earlier entries are client-supplied and
 * spoofable — an attacker must not be able to plant a fake IP in the audit
 * trail (or dodge rate limiting, see rate-limit.ts).
 */
export function clientIp(c: Context): string | undefined {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  return c.req.header('x-real-ip') ?? undefined;
}

/**
 * Fire-and-forget audit write. Never throws into the caller — a broken audit
 * insert must not block the real request, but we do log the failure so a
 * silent audit gap doesn't go unnoticed forever.
 */
export async function logAudit(entry: {
  actorOfficerId?: number | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string | number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      actorOfficerId: entry.actorOfficerId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId !== undefined ? String(entry.entityId) : null,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress ?? null
    });
  } catch (err) {
    console.error('audit log write failed:', err);
  }
}
