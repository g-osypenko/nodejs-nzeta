import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/shared/db/migrations.js';
import { createScratchDb } from '../support/scratch-db.js';

/**
 * Zero-downtime migration phases (spec.md §8, criterion 4). Each test gets its own empty database
 * in the run's Testcontainers Postgres and its own migrations directory with fixture files.
 */

interface Fixture {
  url: string;
  dir: string;
  db: Sql;
  write: (path: string, body: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const scratch = await createScratchDb('mig');
  const dir = await mkdtemp(join(tmpdir(), 'lch-mig-'));
  return {
    url: scratch.url,
    dir,
    db: scratch.db,
    write: async (path, body): Promise<void> => {
      const full = join(dir, path);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, body);
    },
    cleanup: async (): Promise<void> => {
      await rm(dir, { recursive: true, force: true });
      await scratch.drop();
    },
  };
}

describe('phased migrator (spec §8, ADR 0007)', () => {
  it('schema phase applies files in name order once; data and indexes wait for their own step', async () => {
    const f = await fixture();
    try {
      await f.write('002_add_col.sql', 'ALTER TABLE items ADD COLUMN label text;');
      await f.write('001_items.sql', 'CREATE TABLE items (id int PRIMARY KEY);');
      await f.write('data/001_fill.sql', 'UPDATE items SET label = $$x$$ WHERE false;');
      await f.write(
        'indexes/001_label.sql',
        'CREATE INDEX CONCURRENTLY items_label_idx ON items (label);',
      );

      expect(await runMigrations(f.url, { dir: f.dir, phases: ['schema'] })).toEqual([
        '001_items.sql',
        '002_add_col.sql',
      ]);
      expect(await runMigrations(f.url, { dir: f.dir, phases: ['schema'] })).toEqual([]);
      const [idx] =
        await f.db`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'items_label_idx'`;
      expect(idx?.['n']).toBe(0);

      expect(await runMigrations(f.url, { dir: f.dir })).toEqual([
        'data/001_fill.sql',
        'indexes/001_label.sql',
      ]);
      expect(await runMigrations(f.url, { dir: f.dir })).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });

  it('data phase re-runs one batched statement in short transactions until it changes no rows', async () => {
    const f = await fixture();
    try {
      await f.write('001_items.sql', 'CREATE TABLE items (id int PRIMARY KEY, label text);');
      await runMigrations(f.url, { dir: f.dir, phases: ['schema'] });
      await f.db`INSERT INTO items (id) SELECT g FROM generate_series(1, 2500) g`;
      // Batch of 1000: 1000 + 1000 + 500, then a 4th run that changes 0 rows ends the loop.
      await f.write(
        'data/001_backfill_label.sql',
        `UPDATE items SET label = 'item-' || id
         WHERE id IN (SELECT id FROM items WHERE label IS NULL ORDER BY id LIMIT 1000);`,
      );
      // Statement trigger records the transaction id of every batch.
      await f.db.unsafe(`
        CREATE TABLE tx_log (txid bigint NOT NULL);
        CREATE FUNCTION log_tx() RETURNS trigger LANGUAGE plpgsql AS
          $$BEGIN INSERT INTO tx_log VALUES (txid_current()); RETURN NULL; END$$;
        CREATE TRIGGER items_tx AFTER UPDATE ON items FOR EACH STATEMENT EXECUTE FUNCTION log_tx();`);

      expect(await runMigrations(f.url, { dir: f.dir, phases: ['data'] })).toEqual([
        'data/001_backfill_label.sql',
      ]);

      const [left] = await f.db`SELECT count(*)::int AS n FROM items WHERE label IS NULL`;
      expect(left?.['n']).toBe(0);
      // 4 separate transactions (3 batches + the empty one), not one long lock.
      const [tx] = await f.db`SELECT count(DISTINCT txid)::int AS n FROM tx_log`;
      expect(tx?.['n']).toBe(4);
    } finally {
      await f.cleanup();
    }
  });

  it('a data migration that never converges is stopped by the batch guard and not recorded', async () => {
    const f = await fixture();
    try {
      await f.write(
        '001_items.sql',
        'CREATE TABLE items (id int PRIMARY KEY, n int NOT NULL DEFAULT 0);',
      );
      await f.write('data/001_bad.sql', 'UPDATE items SET n = n + 1;');
      await runMigrations(f.url, { dir: f.dir, phases: ['schema'] });
      await f.db`INSERT INTO items (id) VALUES (1)`;

      await expect(runMigrations(f.url, { dir: f.dir, maxBatches: 5 })).rejects.toThrow(
        'did not converge after 5 batches',
      );
      const recorded = await f.db`SELECT name FROM schema_migrations WHERE name LIKE 'data/%'`;
      expect(recorded).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it('indexes phase builds CONCURRENTLY; an INVALID index from a failed build is dropped and rebuilt', async () => {
    const f = await fixture();
    try {
      await f.write('001_items.sql', 'CREATE TABLE items (id int PRIMARY KEY, code text);');
      await runMigrations(f.url, { dir: f.dir, phases: ['schema'] });
      await f.db`INSERT INTO items VALUES (1, 'A'), (2, 'A')`; // duplicate → unique build fails
      await f.write(
        'indexes/001_code_unique.sql',
        'CREATE UNIQUE INDEX CONCURRENTLY items_code_key ON items (code);',
      );

      await expect(runMigrations(f.url, { dir: f.dir, phases: ['indexes'] })).rejects.toMatchObject(
        {
          code: '23505',
        },
      );
      expect(await indexValid(f.db, 'items_code_key')).toBe(false); // left behind as INVALID

      await f.db`UPDATE items SET code = 'B' WHERE id = 2`;
      expect(await runMigrations(f.url, { dir: f.dir, phases: ['indexes'] })).toEqual([
        'indexes/001_code_unique.sql',
      ]);
      expect(await indexValid(f.db, 'items_code_key')).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it('schema phase gives up on a busy table after lock_timeout + retries instead of queueing behind traffic', async () => {
    const f = await fixture();
    const blocker = postgres(f.url, { max: 1, onnotice: () => undefined });
    try {
      await f.write('001_items.sql', 'CREATE TABLE items (id int PRIMARY KEY);');
      await runMigrations(f.url, { dir: f.dir });
      await f.write('002_add_col.sql', 'ALTER TABLE items ADD COLUMN label text;');

      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // A long transaction holding a lock that conflicts with ALTER TABLE (like live traffic).
      const holding = blocker.begin(async (tx) => {
        await tx`LOCK TABLE items IN ACCESS SHARE MODE`;
        locked();
        await released;
      });
      await isLocked;

      const opts = { dir: f.dir, lockTimeoutMs: 100, lockRetries: 2, retryDelayMs: 0 };
      await expect(runMigrations(f.url, opts)).rejects.toMatchObject({ code: '55P03' });
      const [col] = await f.db`
        SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'items' AND column_name = 'label'`;
      expect(col?.['n']).toBe(0);

      release();
      await holding;
      expect(await runMigrations(f.url, opts)).toEqual(['002_add_col.sql']);
    } finally {
      await blocker.end({ timeout: 5 });
      await f.cleanup();
    }
  });
});

async function indexValid(db: Sql, name: string): Promise<boolean | null> {
  const [row] = await db`
    SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ${name}`;
  return row === undefined ? null : Boolean(row['valid']);
}
