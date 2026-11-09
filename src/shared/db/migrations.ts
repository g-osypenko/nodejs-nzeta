import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import postgres, { type Sql } from 'postgres';

/**
 * Zero-downtime migration phases (spec.md §8, ADR 0007). Each phase is a separate CD step:
 *   schema  — migrations/NNN_*.sql: blocking DDL, one transaction per file, short lock_timeout;
 *             expand-only changes that the previous code version still works with.
 *   data    — migrations/data/NNN_*.sql: ONE idempotent DML statement that processes a batch;
 *             re-run in short transactions until it changes no rows (never one long lock).
 *   indexes — migrations/indexes/NNN_*.sql: ONE `CREATE INDEX CONCURRENTLY` per file, outside a
 *             transaction and without statement_timeout (may take long on a big table).
 * Seed data is never a migration: `npm run db:seed`.
 */
export type MigrationPhase = 'schema' | 'data' | 'indexes';
export const MIGRATION_PHASES: readonly MigrationPhase[] = ['schema', 'data', 'indexes'];

export interface MigrateOptions {
  /** Phases to run, always in the canonical order. Default: all. */
  phases?: readonly MigrationPhase[];
  /** Root migrations directory. Default: <cwd>/migrations. */
  dir?: string;
  /** lock_timeout for each schema migration: fail fast instead of queueing behind traffic. */
  lockTimeoutMs?: number;
  /** Extra attempts of a schema migration after lock_timeout (SQLSTATE 55P03). */
  lockRetries?: number;
  retryDelayMs?: number;
  /** Guard against a data migration that never converges to 0 changed rows. */
  maxBatches?: number;
}

const ADVISORY_LOCK_ID = 727001;
const LOCK_NOT_AVAILABLE = '55P03';

const SUBDIR: Record<MigrationPhase, string> = { schema: '', data: 'data', indexes: 'indexes' };

/** Recorded name: schema files keep their bare name (backwards compatible with 001_init.sql). */
function recordName(phase: MigrationPhase, file: string): string {
  return phase === 'schema' ? file : `${phase}/${file}`;
}

async function listSql(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === LOCK_NOT_AVAILABLE
  );
}

interface PhaseContext {
  sql: Sql;
  name: string;
  body: string;
  opts: Required<Omit<MigrateOptions, 'phases' | 'dir'>>;
}

async function applySchema({ sql, name, body, opts }: PhaseContext): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('lock_timeout', ${`${opts.lockTimeoutMs}ms`}, true)`;
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      });
      return;
    } catch (error) {
      if (!isLockTimeout(error) || attempt >= opts.lockRetries) throw error;
      await sleep(opts.retryDelayMs * 2 ** attempt);
    }
  }
}

async function applyData({ sql, name, body, opts }: PhaseContext): Promise<void> {
  for (let batch = 1; ; batch += 1) {
    if (batch > opts.maxBatches) {
      throw new Error(`data migration ${name} did not converge after ${opts.maxBatches} batches`);
    }
    const result = await sql.begin((tx) => tx.unsafe(body));
    if (result.count === 0) break;
  }
  await sql`INSERT INTO schema_migrations (name) VALUES (${name})`;
}

async function applyIndex({ sql, name, body }: PhaseContext): Promise<void> {
  await sql.unsafe(body); // CONCURRENTLY: must not run inside a transaction block
  await sql`INSERT INTO schema_migrations (name) VALUES (${name})`;
}

/** A failed CREATE INDEX CONCURRENTLY leaves an INVALID index behind; it is dropped before a retry. */
async function dropInvalidIndexes(sql: Sql): Promise<void> {
  const invalid = await sql<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT i.indisvalid AND n.nspname = current_schema()`;
  for (const { name } of invalid) {
    await sql`DROP INDEX CONCURRENTLY IF EXISTS ${sql(name)}`;
  }
}

const APPLY: Record<MigrationPhase, (ctx: PhaseContext) => Promise<void>> = {
  schema: applySchema,
  data: applyData,
  indexes: applyIndex,
};

/**
 * Forward-only migrator. Applies pending files of the requested phases in name order and records
 * them in schema_migrations. Returns the recorded names applied in this run (empty = no-op).
 * Used by the CLI (`npm run db:migrate [-- --phase=…]`), by CD and by the test setup.
 */
export async function runMigrations(url: string, options: MigrateOptions = {}): Promise<string[]> {
  const root = options.dir ?? join(process.cwd(), 'migrations');
  const wanted = new Set(options.phases ?? MIGRATION_PHASES);
  const opts = {
    lockTimeoutMs: options.lockTimeoutMs ?? 5000,
    lockRetries: options.lockRetries ?? 3,
    retryDelayMs: options.retryDelayMs ?? 1000,
    maxBatches: options.maxBatches ?? 100_000,
  };
  // One session: the advisory lock is session-scoped and guards against parallel migrators.
  // statement_timeout 0: an index build on a big table may legitimately take long.
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
    connection: { application_name: 'license-config-hub-migrator', statement_timeout: 0 },
  });
  try {
    await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );
    const done: string[] = [];

    for (const phase of MIGRATION_PHASES) {
      if (!wanted.has(phase)) continue;
      const dir = join(root, SUBDIR[phase]);
      const pending = (await listSql(dir)).filter((f) => !applied.has(recordName(phase, f)));
      if (pending.length === 0) continue;
      if (phase === 'indexes') await dropInvalidIndexes(sql);
      for (const file of pending) {
        const name = recordName(phase, file);
        const body = await readFile(join(dir, file), 'utf8');
        await APPLY[phase]({ sql, name, body, opts });
        done.push(name);
      }
    }
    return done;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Parses `--phase=schema` (repeatable) from CLI args; no flag = all phases. */
export function parsePhases(argv: readonly string[]): MigrationPhase[] {
  const requested = argv
    .filter((a) => a.startsWith('--phase='))
    .map((a) => a.slice('--phase='.length));
  if (requested.length === 0) return [...MIGRATION_PHASES];
  for (const p of requested) {
    if (!(MIGRATION_PHASES as readonly string[]).includes(p)) {
      throw new Error(`unknown migration phase "${p}" (expected: ${MIGRATION_PHASES.join(', ')})`);
    }
  }
  return MIGRATION_PHASES.filter((p) => requested.includes(p));
}
