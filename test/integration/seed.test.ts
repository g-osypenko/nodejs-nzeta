import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/shared/db/migrations.js';
import { seedDemoData, seededLicenseKey } from '../../src/shared/db/seed.js';
import { LICENSE_KEY_PATTERN } from '../../src/shared/license-key.js';
import { createScratchDb } from '../support/scratch-db.js';

describe('seed is separate from migrations and idempotent (spec §8)', () => {
  it('migrations create no demo data; seed inserts deterministic users/licenses once', async () => {
    const s = await createScratchDb('seed');
    try {
      await runMigrations(s.url);
      const [before] = await s.db`SELECT count(*)::int AS n FROM licenses`;
      expect(before?.['n']).toBe(0);

      const opts = { users: 3, licenses: 40, passwordHash: 'scrypt$x' };
      expect(await seedDemoData(s.db, opts)).toEqual({ usersInserted: 3, licensesInserted: 40 });
      expect(await seedDemoData(s.db, opts)).toEqual({ usersInserted: 0, licensesInserted: 0 });

      const rows = await s.db<{ key: string; status: string; hwid: string | null }[]>`
        SELECT key, status, hwid FROM licenses ORDER BY key`;
      expect(rows.every((r) => LICENSE_KEY_PATTERN.test(r.key))).toBe(true);
      expect(rows[0]?.key).toBe(seededLicenseKey(1));
      expect(seededLicenseKey(26)).toBe('APP-0000-0000-001A');

      const byStatus = Object.fromEntries(
        (
          await s.db<{ status: string; n: number }[]>`
            SELECT status, count(*)::int AS n FROM licenses GROUP BY status`
        ).map((r) => [r.status, r.n]),
      );
      expect(byStatus).toEqual({ UNACTIVATED: 4, BANNED: 2, ACTIVE: 34 });
      expect(rows.filter((r) => r.status === 'UNACTIVATED').every((r) => r.hwid === null)).toBe(
        true,
      );

      const [owners] = await s.db`SELECT count(DISTINCT user_id)::int AS n FROM licenses`;
      expect(owners?.['n']).toBe(3);
    } finally {
      await s.drop();
    }
  });

  it('refuses licenses without users instead of inserting nothing silently', async () => {
    const s = await createScratchDb('seed');
    try {
      await runMigrations(s.url);
      await expect(
        seedDemoData(s.db, { users: 0, licenses: 5, passwordHash: 'x' }),
      ).rejects.toThrow('at least one user');
    } finally {
      await s.drop();
    }
  });
});
