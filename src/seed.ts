/**
 * CLI: `npm run db:seed [-- --users=20 --licenses=200]` — demo/load data, separate from migrations.
 * Password of every seeded user: SEED_PASSWORD (default below) — demo data only.
 */
import dotenv from 'dotenv';
import postgres from 'postgres';
import { hashPassword } from './modules/auth/password.js';
import { seedDemoData } from './shared/db/seed.js';

dotenv.config({ quiet: true });

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const result = await seedDemoData(sql, {
      users: intArg('users', 20),
      licenses: intArg('licenses', 200),
      passwordHash: await hashPassword(process.env['SEED_PASSWORD'] ?? 'seed-password-01'),
    });
    process.stdout.write(
      `seed: +${result.usersInserted} users, +${result.licensesInserted} licenses\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
