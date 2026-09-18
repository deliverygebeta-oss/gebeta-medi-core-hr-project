import { sign, verify } from 'hono/jwt';
import { randomBytes, createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from './db';
import { hrOfficers, sessions } from './db/schema';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set in .env and be at least 32 characters');
}
const SECRET: string = JWT_SECRET;

/** "8h" | "30m" | "7d" | plain seconds → seconds. */
function parseExpiry(raw: string | undefined, fallbackSeconds: number): number {
  if (!raw) return fallbackSeconds;
  const m = raw.trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === 'd' ? n * 86400 : unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
}

// Two lifetimes: the access token is short-lived so a token leaked via XSS
// (unavoidable once it lives in localStorage/JS memory instead of an
// httpOnly cookie) has a small window of use. The refresh token is the
// actual session — it never leaves the app as a JWT, only as an opaque
// random value the server can look up and revoke.
const ACCESS_EXPIRES_IN = parseExpiry(process.env.JWT_ACCESS_EXPIRES_IN, 15 * 60);
const REFRESH_EXPIRES_IN = parseExpiry(process.env.JWT_REFRESH_EXPIRES_IN, 8 * 3600);

export interface OfficerClaims {
  sub: number;
  sid: number;
  username: string;
  fullName: string;
  role: 'hr_officer' | 'admin' | 'viewer';
  exp: number;
  [key: string]: unknown; // hono/jwt JWTPayload compatibility
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

async function signAccessToken(session: {
  id: number;
  officerId: number;
  username: string;
  fullName: string;
  role: 'hr_officer' | 'admin' | 'viewer';
}): Promise<string> {
  const claims: OfficerClaims = {
    sub: session.officerId,
    sid: session.id,
    username: session.username,
    fullName: session.fullName,
    role: session.role,
    exp: Math.floor(Date.now() / 1000) + ACCESS_EXPIRES_IN
  };
  return sign(claims, SECRET);
}

/**
 * Creates the DB-backed session row (the refresh token's home) and returns
 * both tokens. The session row is what makes logout and revocation real —
 * a JWT alone would stay valid until it naturally expired.
 */
export async function createSession(
  officer: { id: number; username: string; fullName: string; role: 'hr_officer' | 'admin' | 'viewer' },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<TokenPair> {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_IN * 1000);
  const [session] = await db
    .insert(sessions)
    .values({
      officerId: officer.id,
      expiresAt,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent?.slice(0, 255),
      refreshTokenHash: hashToken(refreshToken)
    })
    .returning();

  const accessToken = await signAccessToken({
    id: session.id,
    officerId: officer.id,
    username: officer.username,
    fullName: officer.fullName,
    role: officer.role
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES_IN };
}

/**
 * Exchanges a still-valid refresh token for a new access token, rotating the
 * refresh token in the same step (single-use — the old value stops working
 * immediately, so a stolen-but-unused refresh token is only good once).
 * expiresAt (the hard session cap) is NOT extended here — a refresh token
 * lets you stay logged in until the original session's cap, not forever.
 */
export async function refreshSession(refreshToken: string): Promise<TokenPair | null> {
  const tokenHash = hashToken(refreshToken);
  const [row] = await db
    .select({
      session: sessions,
      isActive: hrOfficers.isActive,
      role: hrOfficers.role,
      username: hrOfficers.username,
      fullName: hrOfficers.fullName
    })
    .from(sessions)
    .innerJoin(hrOfficers, eq(hrOfficers.id, sessions.officerId))
    .where(
      and(eq(sessions.refreshTokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))
    );

  if (!row || !row.isActive) return null;

  const newRefresh = newRefreshToken();
  await db
    .update(sessions)
    .set({ refreshTokenHash: hashToken(newRefresh), lastSeenAt: new Date() })
    .where(eq(sessions.id, row.session.id));

  const accessToken = await signAccessToken({
    id: row.session.id,
    officerId: row.session.officerId,
    username: row.username,
    fullName: row.fullName,
    role: row.role
  });
  return { accessToken, refreshToken: newRefresh, expiresIn: ACCESS_EXPIRES_IN };
}

/** Marks the session revoked so both the access and refresh token stop working immediately. */
export async function revokeSession(sessionId: number) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/** Only rewrite lastSeenAt when the previous stamp is at least this stale. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

function bearerToken(c: Context): string | null {
  const header = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/**
 * Hand-rolled (not hono's `jwt()` factory) because we need a DB round trip
 * after signature verification: a valid, unexpired JWT whose session has
 * been revoked (logged out, forced sign-out) must still be rejected.
 *
 * The officer row is joined in the same query so that deactivating an
 * account (is_active = false) or changing its role takes effect on the very
 * next request — the JWT's own claims would otherwise stay live for up to
 * the token's full lifetime.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = bearerToken(c);
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  let payload: OfficerClaims;
  try {
    payload = (await verify(token, SECRET, 'HS256')) as OfficerClaims;
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const [row] = await db
    .select({
      session: sessions,
      isActive: hrOfficers.isActive,
      role: hrOfficers.role
    })
    .from(sessions)
    .innerJoin(hrOfficers, eq(hrOfficers.id, sessions.officerId))
    .where(eq(sessions.id, payload.sid));

  const session = row?.session;
  if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) {
    return c.json({ error: 'Session expired or signed out — please sign in again' }, 401);
  }
  if (!row.isActive) {
    return c.json({ error: 'This account has been deactivated' }, 401);
  }

  // Best-effort activity timestamp; never block the request on it, and skip
  // the write entirely when the stamp is fresh — otherwise every request
  // pays a row UPDATE just to move lastSeenAt by a few seconds.
  const now = new Date();
  if (!session.lastSeenAt || now.getTime() - new Date(session.lastSeenAt).getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
    db.update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, session.id))
      .catch(() => {});
  }

  // The DB role wins over the (possibly stale) JWT claim.
  c.set('jwtPayload', { ...payload, role: row.role });
  await next();
};

/** Read the verified officer claims inside a protected handler. */
export function officer(c: Context): OfficerClaims {
  return c.get('jwtPayload') as OfficerClaims;
}
