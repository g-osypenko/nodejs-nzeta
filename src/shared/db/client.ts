import postgres, { type Sql } from 'postgres';
import { getContext } from '../context.js';
import { logger } from '../logger.js';

export type Db = Sql;

export interface DbOptions {
  url: string;
  max: number;
  statementTimeoutMs: number;
}

/**
 * Creates the connection pool. postgres.js connects lazily, so callers must run
 * `assertDbReachable` at startup to fail fast instead of on the first request.
 */
export function createDb({ url, max, statementTimeoutMs }: DbOptions): Db {
  return postgres(url, {
    max,
    connect_timeout: 5, // seconds
    idle_timeout: 30,
    connection: { application_name: 'license-config-hub', statement_timeout: statementTimeoutMs },
    // snake_case columns → camelCase fields, so rows match src/shared/db/rows.ts
    transform: { column: { from: postgres.toCamel } },
    onnotice: () => undefined,
    // Counts SQL statements per request: the N+1 detector behind `dbQueries` (spec.md §4.8).
    debug: () => {
      const ctx = getContext();
      if (ctx) ctx.dbQueries += 1;
    },
  });
}

export async function assertDbReachable(db: Db): Promise<void> {
  const [row] = await db<{ now: Date }[]>`SELECT now() AS now`;
  logger.info({ dbTime: row?.now }, 'database reachable');
}
