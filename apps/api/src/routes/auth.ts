import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { hrOfficers } from '../db/schema';
import { createSession, officer, refreshSession, requireAuth, revokeSession } from '../auth';
import { clientIp, logAudit } from '../audit';
import { rateLimit } from '../rate-limit';

const app = new Hono();

// Per-IP throttle on top of the per-account lockout below: the lockout only
// slows attacks on one username — a spray across many usernames (or someone
// deliberately locking a colleague out) needs a cap keyed by source instead.
app.use('/login', rateLimit({ windowMs: 60_000, max: 10 }));

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200)
});

// Verified once at boot so an unknown-username login still pays the same
// argon2 cost as a real one — otherwise response time leaks which usernames
// exist (fast rejection vs. slow hash verify).
const DUMMY_HASH = Bun.password.hash('not-a-real-password-just-for-timing');

app.post('/login', async (c) => {
  const ip = clientIp(c);
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Username and password are required' }, 422);

  const { username, password } = parsed.data;
  const normalizedUsername = username.toLowerCase();
  const [account] = await db.select().from(hrOfficers).where(eq(hrOfficers.username, normalizedUsername));

  const invalid = () => c.json({ error: 'Invalid username or password' }, 401);

  if (!account || !account.isActive) {
    await Bun.password.verify(password, await DUMMY_HASH);
    await logAudit({ action: 'login_failed', metadata: { username: normalizedUsername, reason: 'unknown_or_inactive' }, ipAddress: ip });
    return invalid();
  }

  const now = new Date();
  const stillLocked = account.lockedUntil && new Date(account.lockedUntil) > now;
  if (stillLocked) {
    await logAudit({ actorOfficerId: account.id, action: 'login_locked', metadata: { reason: 'already_locked' }, ipAddress: ip });
    const minutesLeft = Math.ceil((new Date(account.lockedUntil!).getTime() - now.getTime()) / 60000);
    return c.json(
      { error: `Account locked after repeated failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` },
      423
    );
  }

  const ok = await Bun.password.verify(password, account.passwordHash);
  if (!ok) {
    const attempts = account.failedLoginAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
      await db
        .update(hrOfficers)
        .set({ failedLoginAttempts: 0, lockedUntil })
        .where(eq(hrOfficers.id, account.id));
      await logAudit({ actorOfficerId: account.id, action: 'login_locked', metadata: { attempts }, ipAddress: ip });
      return c.json(
        { error: `Too many incorrect attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` },
        423
      );
    }
    await db.update(hrOfficers).set({ failedLoginAttempts: attempts }).where(eq(hrOfficers.id, account.id));
    await logAudit({ actorOfficerId: account.id, action: 'login_failed', metadata: { attempts }, ipAddress: ip });
    return invalid();
  }

  if (account.failedLoginAttempts > 0 || account.lockedUntil) {
    await db.update(hrOfficers).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(hrOfficers.id, account.id));
  }

  const tokens = await createSession(account, { ipAddress: ip, userAgent: c.req.header('user-agent') });
  await logAudit({ actorOfficerId: account.id, action: 'login_success', ipAddress: ip });

  return c.json({
    officer: {
      id: account.id,
      username: account.username,
      fullName: account.fullName,
      role: account.role
    },
    ...tokens
  });
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

// Deliberately unauthenticated (requireAuth would reject the very expired
// access token this endpoint exists to replace) — trust is anchored in the
// opaque, DB-checked refresh token instead. No rate limit here beyond the
// global one: a valid refresh token is already a bearer-equivalent secret,
// and brute-forcing a 32-byte random value isn't a practical attack.
app.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'refreshToken is required' }, 422);

  const tokens = await refreshSession(parsed.data.refreshToken);
  if (!tokens) return c.json({ error: 'Session expired or signed out — please sign in again' }, 401);

  return c.json(tokens);
});

app.get('/me', requireAuth, async (c) => {
  const claims = officer(c);
  return c.json({
    id: claims.sub,
    username: claims.username,
    fullName: claims.fullName,
    role: claims.role
  });
});

app.post('/logout', requireAuth, async (c) => {
  const claims = officer(c);
  await revokeSession(claims.sid);
  await logAudit({ actorOfficerId: claims.sub, action: 'logout', ipAddress: clientIp(c) });
  return c.json({ ok: true });
});

export default app;
