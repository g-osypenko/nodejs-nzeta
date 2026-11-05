/** CLI: `npm run db:migrate` — applies pending migrations to DATABASE_URL. */
import dotenv from 'dotenv';
import { runMigrations } from './migrations.js';

dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const applied = await runMigrations(url);
  for (const name of applied) process.stdout.write(`applied ${name}\n`);
  process.stdout.write(`migrations up to date (${applied.length} applied now)\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
