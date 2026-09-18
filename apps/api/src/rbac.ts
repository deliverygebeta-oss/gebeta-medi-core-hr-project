import type { MiddlewareHandler } from 'hono';
import { officer } from './auth';

/** Gate a route to specific officer roles — 'viewer' is read-only by convention, so never include it on a mutating route. */
export function requireRole(...roles: Array<'hr_officer' | 'admin' | 'viewer'>): MiddlewareHandler {
  return async (c, next) => {
    const claims = officer(c);
    if (!roles.includes(claims.role)) {
      return c.json({ error: 'You do not have permission to perform this action' }, 403);
    }
    await next();
  };
}
