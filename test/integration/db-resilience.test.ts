import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { describe, expect, inject, it } from 'vitest';
import { createPostgresConfigsRepository } from '../../src/modules/configs/configs.repository.postgres.js';
import { createContext, runWithContext } from '../../src/shared/context.js';
import { assertDbReachable, createDb } from '../../src/shared/db/client.js';
import { isDbUnavailable, isTransientDbError } from '../../src/shared/db/errors.js';
import { runMigrations } from '../../src/shared/db/migrations.js';
import { createTestApp } from '../support/app.js';

describe('database failure behaviour (spec §4.7)', () => {
  it('startup fails fast with a clear error when the DB is unreachable', async () => {
    const started = Date.now();
    await expect(
      createTestApp({ DATA_SOURCE: 'postgres', DATABASE_URL: 'postgres://x:y@127.0.0.1:1/none' }),
    ).rejects.toThrow('Database is unreachable at startup');
    expect(Date.now() - started).toBeLessThan(6000); // connect_timeout = 5 s, refused is immediate
  });

  it('DB lost at runtime → 503 DB_UNAVAILABLE + Retry-After; /health reports it; version still works', async () => {
    const pg = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    await runMigrations(pg.getConnectionUri());
    const t = await createTestApp({ DATA_SOURCE: 'postgres', DATABASE_URL: pg.getConnectionUri() });
    try {
      expect((await t.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);

      await pg.stop();

      const health = await t.app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(503);
      expect(health.headers['retry-after']).toBe('5');
      expect(health.json()).toMatchObject({ error: { code: 'DB_UNAVAILABLE' } });
      const plans = await t.app.inject({ method: 'GET', url: '/api/v1/plans' });
      expect(plans.json()).toMatchObject({ error: { code: 'DB_UNAVAILABLE' } });
      expect((await t.app.inject({ method: 'GET', url: '/version' })).statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('recovers without restart after all its connections are killed server-side', async () => {
    const t = await createTestApp({ DATA_SOURCE: 'postgres', DATABASE_URL: inject('databaseUrl') });
    const admin = createDb({ url: inject('databaseUrl'), max: 1, statementTimeoutMs: 5000 });
    try {
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode).toBe(200);
      const killed = await admin`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name = 'license-config-hub' AND pid <> pg_backend_pid()`;
      expect(killed.length).toBeGreaterThan(0);

      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await t.app.inject({ method: 'GET', url: '/api/v1/plans' })).statusCode);
      }
      // At most the first request may see the dead socket; the pool must reconnect by itself.
      expect(statuses.at(-1)).toBe(200);
      expect(statuses.filter((s) => s !== 200 && s !== 503)).toEqual([]);
    } finally {
      await admin.end({ timeout: 5 });
      await t.close();
    }
  });

  it('dbQueries counts every statement of the request (N+1 detector) and runMigrations is idempotent', async () => {
    const sql = createDb({ url: inject('databaseUrl'), max: 2, statementTimeoutMs: 5000 });
    try {
      const ctx = createContext();
      await runWithContext(ctx, async () => {
        await assertDbReachable(sql);
        await createPostgresConfigsRepository(sql).listNames(
          '00000000-0000-4000-8000-000000000000',
        );
      });
      expect(ctx.dbQueries).toBe(2);
      expect(await runMigrations(inject('databaseUrl'))).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('statement_timeout from config cancels a runaway query with 57014, classified as 503', async () => {
    const sql = createDb({ url: inject('databaseUrl'), max: 1, statementTimeoutMs: 200 });
    try {
      const error: unknown = await sql`SELECT pg_sleep(1)`.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: '57014' });
      expect(isDbUnavailable(error)).toBe(true); // → 503 in the global handler
      expect(isTransientDbError(error)).toBe(false); // → never retried (would amplify load)
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
