import type { Db } from '../../shared/db/client.js';
import { withRetry } from '../../shared/db/retry.js';
import type { LoaderLicense, LoaderRepository } from './loader.repository.js';

export function createPostgresLoaderRepository(sql: Db): LoaderRepository {
  const repository: LoaderRepository = {
    async findByKey(key) {
      // Served by the unique index licenses_key_key: one index lookup, no joins (SLA path).
      const [row] = await sql<LoaderLicense[]>`
        SELECT key, hwid, status, expires_at FROM licenses WHERE key = ${key}`;
      return row ?? null;
    },

    bindHwid(key, hwid, now) {
      // Compare-and-set in one statement: under READ COMMITTED a concurrent UPDATE waits for the
      // row lock, then re-checks `hwid IS NULL` on the new row version and matches 0 rows.
      // Idempotent for the same hwid, so it is safe to retry.
      return withRetry('bindHwid', async () => {
        const [row] = await sql<LoaderLicense[]>`
          UPDATE licenses
          SET hwid = ${hwid},
              status = 'ACTIVE',
              activated_at = COALESCE(activated_at, ${now}),
              expires_at = COALESCE(expires_at, ${now}::timestamptz + make_interval(days => duration_days))
          WHERE key = ${key} AND hwid IS NULL AND status <> 'BANNED'
          RETURNING key, hwid, status, expires_at`;
        return row ?? null;
      });
    },
  };
  return repository;
}
