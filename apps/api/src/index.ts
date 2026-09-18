import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { lt } from 'drizzle-orm';
import { bootstrapDatabase } from './db/bootstrap';
import { db } from './db';
import { sessions } from './db/schema';
import { rateLimit } from './rate-limit';
import authRoute from './routes/auth';
import employeesRoute from './routes/employees';
import uploadLinksRoute from './routes/upload-links';

// Migrate + seed before accepting traffic: existing tables/rows are skipped,
// missing ones are created — the server is always safe to start cold.
await bootstrapDatabase();

const app = new Hono();

// Portal URLs put a bearer-equivalent token in the path (and /status carries
// the last4 second factor as a query param) — request logs must not become a
// credential store, so both are scrubbed before the line is written.
const redactSensitive = (line: string) =>
  line
    .replace(/upload-links\/[A-Za-z0-9-]{16,}/g, 'upload-links/[token]')
    .replace(/([?&]last4=)\d+/g, '$1[redacted]');
app.use('*', logger((line, ...rest) => console.log(redactSensitive(line), ...rest)));

// Hard cap on request size — the only line of defense now that no bundled
// reverse proxy sits in front of this container (see docker-compose.yml).
// Without it, a multipart upload is buffered in full before storage.ts ever
// checks file.size — a free memory-exhaustion lever on the unauthenticated
// portal. 12 MB leaves headroom over the 10 MB file cap for multipart
// framing and other fields.
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 12 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Request body is too large (12 MB max)' }, 413)
  })
);
// Auth is a Bearer token in the Authorization header, not a cookie, so no
// credential ever travels automatically — credentials: false is correct and
// lets the origin allowlist stay a plain string match. web and api are
// deployed on separate domains (app.* / api.*), so this allowlist is what
// actually gates who may call the API from a browser; keep it to real
// frontend origins, not '*'. Comma-separate multiple origins in CORS_ORIGIN.
const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  '/api/*',
  cors({
    origin: corsOrigins,
    credentials: false,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  })
);

app.get('/api/health', (c) => c.json({ ok: true, service: 'medicore-hr-api' }));
app.route('/api/auth', authRoute);
app.route('/api/employees', employeesRoute);
// Public, unauthenticated portal — rate-limited per IP on top of the
// per-link attempt lockout enforced inside the route handlers.
app.use('/api/upload-links/*', rateLimit({ windowMs: 60_000, max: 30 }));
app.route('/api/upload-links', uploadLinksRoute);

// Sessions are useless once expired (requireAuth rejects them) but the rows
// pile up forever otherwise. Keep 30 days past expiry for incident forensics
// (the audit trail references who was signed in), then prune. Runs at boot
// and every 6 hours; failures are logged and retried on the next tick.
const SESSION_RETENTION_MS = 30 * 24 * 3600_000;
async function pruneExpiredSessions() {
  try {
    const cutoff = new Date(Date.now() - SESSION_RETENTION_MS);
    await db.delete(sessions).where(lt(sessions.expiresAt, cutoff));
  } catch (err) {
    console.error('session prune failed:', err);
  }
}
void pruneExpiredSessions();
setInterval(pruneExpiredSessions, 6 * 3600_000);

const port = Number(process.env.PORT ?? 3000);
// Explicit 0.0.0.0 so this is reachable from other containers / the host,
// not just from inside this one — the default can vary by environment.
const hostname = process.env.HOST ?? '0.0.0.0';
console.log(`MediCore HR API listening on http://${hostname}:${port}`);

export default { port, hostname, fetch: app.fetch };
