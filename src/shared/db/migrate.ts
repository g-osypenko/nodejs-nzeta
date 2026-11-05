/**
 * Minimal forward-only migrator: applies migrations/NNN_*.sql in name order, each in its own
 * transaction, and records it in schema_migrations. Usage: `npm run db:migrate`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

async function migrate(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');

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

    for (const file of files) {
      if (applied.has(file)) continue;
      const ddl = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(ddl);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      process.stdout.write(`applied ${file}\n`);
    }
    process.stdout.write(`migrations up to date (${files.length} total)\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

migrate().catch((err: unknown) => {
  process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
