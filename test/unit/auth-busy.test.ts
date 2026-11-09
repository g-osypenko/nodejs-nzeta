import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/app.js';

/**
 * Admission control of password hashing through the whole app (spec §3, §9; ADR 0010): config →
 * container → @lch/auth-core hasher → global error handler → HTTP. Not just the hasher function.
 */
describe('login under a burst: fast 503 AUTH_BUSY instead of a growing queue', () => {
  it('one hashing slot and no queue: concurrent logins beyond it are rejected with Retry-After: 1', async () => {
    const t = await createTestApp({ AUTH_HASH_CONCURRENCY: '1', AUTH_HASH_QUEUE: '0' });
    try {
      const creds = { email: 'burst@test.local', password: 'burst-password' };
      expect(
        (await t.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: creds }))
          .statusCode,
      ).toBe(201);

      const burst = await Promise.all(
        Array.from({ length: 6 }, () =>
          t.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: creds }),
        ),
      );
      const ok = burst.filter((r) => r.statusCode === 200);
      const busy = burst.filter((r) => r.statusCode === 503);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(busy.length).toBeGreaterThanOrEqual(1);
      expect(ok.length + busy.length).toBe(6);
      for (const r of busy) {
        expect(r.headers['retry-after']).toBe('1');
        expect(r.json()).toMatchObject({ error: { code: 'AUTH_BUSY' } });
      }

      // The slot is free again once the burst is over.
      const after = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: creds,
      });
      expect(after.statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('defaults: one hash at a time with a queue of 8 (spec §9)', async () => {
    const t = await createTestApp();
    try {
      expect(t.container.config.authHashing).toEqual({ maxConcurrent: 1, maxQueued: 8 });
    } finally {
      await t.close();
    }
  });
});
