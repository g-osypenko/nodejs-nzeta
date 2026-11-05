import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
 * Minimal forward-only migrator: applies migrations/NNN_*.sql in name order, each in its own
 * transaction, and records it in schema_migrations. Returns the names applied in this run.
 * Used by the CLI (`npm run db:migrate`) and by the integration/e2e test setup.
 */
export async function runMigrations(url: string): Promise<string[]> {
  // One connection: the advisory lock is session-scoped and guards against parallel migrators.
  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    await sql`SELECT pg_advisory_lock(727001)`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const done: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const ddl = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      done.push(file);
    }
    return done;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
