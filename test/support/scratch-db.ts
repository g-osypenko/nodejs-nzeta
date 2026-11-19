import postgres, { type Sql } from 'postgres';
import { inject } from 'vitest';

export interface ScratchDb {
  url: string;
  db: Sql;
  drop: () => Promise<void>;
}

let seq = 0;

/**
 * An empty database inside the run's Testcontainers Postgres — for tests that need a clean
 * schema (migrator, seed) without touching the shared, already migrated test database.
 */
export async function createScratchDb(prefix: string): Promise<ScratchDb> {
  seq += 1;
  const name = `${prefix}_${process.pid}_${seq}`;
  const admin = postgres(inject('databaseUrl'), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const u = new URL(inject('databaseUrl'));
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = postgres(url, { max: 2, onnotice: () => undefined });
  return {
    url,
    db,
    drop: async (): Promise<void> => {
      await db.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    },
  };
}
