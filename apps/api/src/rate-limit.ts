import type { Context, MiddlewareHandler } from 'hono';

/**
 * Reverse proxies (Coolify's Traefik, or your own) *append* the socket's
 * real remote address to whatever X-Forwarded-For the client sent — so the
 * LAST entry is the only one the proxy vouches for. Taking the first entry
 * would let a client mint a fresh rate-limit bucket per request with a
 * forged header.
 */
function defaultKey(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    return parts[parts.length - 1].trim();
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Minimal in-memory sliding-window limiter. Good enough for a single-instance
 * Bun process guarding a low-traffic internal portal — not meant to survive a
 * restart or a multi-instance deployment, both of which would need a shared
 * store (Redis) instead.
 *
 * `keyFn` defaults to per-IP; pass one keyed by officer id on authenticated
 * routes so office-shared IPs (NAT) don't throttle each other.
 */
export function rateLimit(opts: { windowMs: number; max: number; keyFn?: (c: Context) => string }): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  const keyFn = opts.keyFn ?? defaultKey;

  return async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= opts.max) {
      return c.json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
    }
    timestamps.push(now);
    hits.set(key, timestamps);

    // Bound memory: drop keys with no recent activity once the map gets large.
    if (hits.size > 5000) {
      for (const [k, times] of hits) {
        if (times.every((t) => t <= windowStart)) hits.delete(k);
      }
    }

    await next();
  };
}
