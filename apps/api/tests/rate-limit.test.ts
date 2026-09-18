import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { rateLimit } from '../src/rate-limit';

function appWithLimit(max: number, keyFn?: (c: any) => string) {
  const app = new Hono();
  app.use('*', rateLimit({ windowMs: 60_000, max, keyFn }));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit', () => {
  test('allows requests under the limit', async () => {
    const app = appWithLimit(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/');
      expect(res.status).toBe(200);
    }
  });

  test('blocks the request that exceeds the limit with 429', async () => {
    const app = appWithLimit(2);
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(429);
  });

  test('separate keys (e.g. different officers) get independent budgets', async () => {
    let currentKey = 'officer-1';
    const app = appWithLimit(1, () => currentKey);

    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(429); // officer-1 exhausted

    currentKey = 'officer-2';
    expect((await app.request('/')).status).toBe(200); // untouched budget
  });
});
