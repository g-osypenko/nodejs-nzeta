/**
 * CLI: applies pending migrations to DATABASE_URL.
 *   npm run db:migrate                      → all phases: schema → data → indexes
 *   npm run db:migrate -- --phase=schema    → one phase (CD runs each phase as its own step)
 * The application itself never migrates on startup (spec.md §8).
 */
import dotenv from 'dotenv';
import { parsePhases, runMigrations } from './migrations.js';

dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const phases = parsePhases(process.argv.slice(2));
  const applied = await runMigrations(url, { phases });
  for (const name of applied) process.stdout.write(`applied ${name}\n`);
  process.stdout.write(
    `migrations [${phases.join(', ')}] up to date (${applied.length} applied now)\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
