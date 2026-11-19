/**
 * `make explain` — EXPLAIN (ANALYZE, BUFFERS) of the hot queries on the seeded perf DB (spec §9.3).
 *
 * The SQL is not copied by hand: the real Postgres repositories are called and every statement
 * they send is captured via the postgres.js debug hook, then explained with the same parameters.
 * Writes run inside a transaction that is rolled back, so the data set stays unchanged.
 *
 *   npx tsx scripts/perf/explain.ts [--label=baseline]   (stand must be up: make load / perf:load)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { createPostgresAuthRepository } from '../../src/modules/auth/auth.repository.postgres.js';
import { createPostgresConfigsRepository } from '../../src/modules/configs/configs.repository.postgres.js';
import { createPostgresLicensesRepository } from '../../src/modules/licenses/licenses.repository.postgres.js';
import { createPostgresLoaderRepository } from '../../src/modules/loader/loader.repository.postgres.js';
import { seededLicenseKey } from '../../src/shared/db/seed.js';
import { DATA, ROOT, getJson, log } from './stand.js';

const DB_URL = 'postgres://lch:perf@127.0.0.1:55433/lch_perf';

interface Captured {
  query: string;
  params: unknown[];
}

const ROLLBACK = new Error('rollback');

async function capture(
  db: Sql,
  sink: Captured[],
  call: (sql: Sql) => Promise<unknown>,
  write = false,
): Promise<Captured[]> {
  const from = sink.length;
  if (write) {
    await db
      .begin(async (tx) => {
        await call(tx as unknown as Sql);
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
  } else {
    await call(db);
  }
  return sink.slice(from).filter((c) => !/^\s*(begin|commit|rollback)/i.test(c.query));
}

async function explain(db: Sql, c: Captured, write: boolean): Promise<string> {
  const run = async (sql: Sql): Promise<string> => {
    const rows = await sql.unsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS, TIMING) ${c.query}`,
      c.params as never[],
    );
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  };
  if (!write) return run(db);
  let plan = '';
  await db
    .begin(async (tx) => {
      plan = await run(tx as unknown as Sql);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return plan;
}

function execTime(plan: string): number {
  return Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? NaN);
}

async function main(): Promise<void> {
  const label = process.argv.find((a) => a.startsWith('--label='))?.slice(8) ?? 'baseline';
  const sink: Captured[] = [];
  const db = postgres(DB_URL, {
    max: 1,
    onnotice: () => undefined,
    fetch_types: false,
    transform: { column: { from: postgres.toCamel } },
    debug: (_conn, query, params) => sink.push({ query, params: [...params] }),
  });
  const raw = postgres(DB_URL, { max: 1, onnotice: () => undefined, fetch_types: false });
  try {
    const version = await getJson<{ commit: string }>('/version').catch(() => ({ commit: '?' }));
    const [someUser] = await raw<{ id: string }[]>`
      SELECT id FROM users WHERE email = 'seed-1@lch.local'`;
    const [someSession] = await raw<{ tokenHash: string }[]>`
      SELECT token_hash AS "tokenHash" FROM sessions ORDER BY created_at DESC LIMIT 1`;
    if (!someUser) throw new Error('perf DB is not seeded: run make load first');

    const mid = Math.floor(DATA.licenses / 2);
    const cases: { name: string; write?: boolean; call: (sql: Sql) => Promise<unknown> }[] = [
      {
        name: 'loader.findByKey (handshake, кожен запит)',
        call: (sql) => createPostgresLoaderRepository(sql).findByKey(seededLicenseKey(mid + 1)),
      },
      {
        name: 'loader.bindHwid (перший handshake ключа)',
        write: true,
        call: (sql) =>
          createPostgresLoaderRepository(sql).bindHwid(
            seededLicenseKey(mid),
            'explain-hwid-01',
            new Date(),
          ),
      },
      {
        name: 'auth.findSessionUser (кожен запит з токеном)',
        call: (sql) =>
          createPostgresAuthRepository(sql).findSessionUser(
            someSession?.tokenHash ?? 'x'.repeat(64),
            new Date(),
          ),
      },
      {
        name: 'auth.findUserByEmail (login)',
        call: (sql) => createPostgresAuthRepository(sql).findUserByEmail('seed-1500@lch.local'),
      },
      {
        name: 'licenses.listUserLicenses (мої ліцензії)',
        call: (sql) => createPostgresLicensesRepository(sql).listUserLicenses(someUser.id),
      },
      {
        name: 'configs.find (кабінет)',
        call: (sql) => createPostgresConfigsRepository(sql).find(someUser.id, 'perf-profile'),
      },
      {
        name: 'admin listLicenses offset 0',
        call: (sql) => createPostgresLicensesRepository(sql).listLicenses({ limit: 50, offset: 0 }),
      },
      {
        name: 'admin listLicenses offset 100 000',
        call: (sql) =>
          createPostgresLicensesRepository(sql).listLicenses({ limit: 50, offset: 100_000 }),
      },
      {
        name: 'admin listLicenses offset 199 950',
        call: (sql) =>
          createPostgresLicensesRepository(sql).listLicenses({ limit: 50, offset: 199_950 }),
      },
      {
        name: 'admin listLicenses status=ACTIVE offset 100 000',
        call: (sql) =>
          createPostgresLicensesRepository(sql).listLicenses({
            status: 'ACTIVE',
            limit: 50,
            offset: 100_000,
          }),
      },
    ];

    const counts = await raw<{ table: string; rows: number; size: string }[]>`
      SELECT c.relname AS table, c.reltuples::bigint AS rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.reltuples DESC`;

    const sections: string[] = [];
    const summary: string[] = [];
    for (const c of cases) {
      const statements = await capture(db, sink, c.call, c.write === true);
      for (const [i, st] of statements.entries()) {
        const plan = await explain(raw, st, c.write === true);
        const title = statements.length > 1 ? `${c.name} — запит ${i + 1}` : c.name;
        const firstNode = plan.split('\n')[0]?.trim() ?? '';
        summary.push(
          `| ${title} | ${execTime(plan).toFixed(3)} | \`${firstNode.replace(/\|/g, '\\|').slice(0, 90)}\` |`,
        );
        sections.push(
          `### ${title}\n\n\`\`\`sql\n${st.query.trim()}\n\`\`\`\n\n\`\`\`text\n${plan}\n\`\`\``,
        );
      }
    }

    const md = [
      `# EXPLAIN ANALYZE: ${label}`,
      '',
      `- Версія застосунку (\`/version\`): \`${version.commit}\` · дата ${new Date().toISOString()}`,
      `- Дані: ${DATA.users} користувачів, ${DATA.licenses} ліцензій (\`db:seed\`); SQL перехоплено з репозиторіїв, а не скопійовано`,
      '- Відтворити: `make explain` (стенд піднятий `make load`)',
      '',
      '## Таблиці',
      '',
      '| Таблиця | Рядків (оцінка) | Розмір з індексами |',
      '| :-- | --: | --: |',
      ...counts.map(
        (r) => `| ${r.table} | ${Number(r.rows).toLocaleString('uk-UA')} | ${r.size} |`,
      ),
      '',
      '## Підсумок',
      '',
      '| Запит | Execution Time, мс | Верхній вузол плану |',
      '| :-- | --: | :-- |',
      ...summary,
      '',
      '## Плани',
      '',
      ...sections,
      '',
    ].join('\n');
    const dir = join(ROOT, 'docs', 'perf');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `explain-${label}.md`), md);
    log(`report → docs/perf/explain-${label}.md`);
  } finally {
    await db.end({ timeout: 5 });
    await raw.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
