import type { Sql } from 'postgres';

export interface SeedOptions {
  users: number;
  licenses: number;
  /** One scrypt hash shared by all demo users (hashing per user would dominate a big seed). */
  passwordHash: string;
}

export interface SeedResult {
  usersInserted: number;
  licensesInserted: number;
}

/**
 * Demo/load data — NOT a migration (spec.md §8): run explicitly with `npm run db:seed`.
 * Deterministic and idempotent: user N is seed-N@lch.local, license N has key APP-0000-0000-000N
 * (hex), so a re-run inserts nothing and load scripts know valid keys without querying the DB.
 * Mix per 20 licenses: every 10th UNACTIVATED, every 20th (+1) BANNED, the rest ACTIVE with a
 * HWID; activation dates spread over 40 days with a 30-day term, so some ACTIVE keys are expired.
 */
export async function seedDemoData(sql: Sql, opts: SeedOptions): Promise<SeedResult> {
  if (opts.licenses > 0 && opts.users < 1) throw new Error('licenses need at least one user');
  return sql.begin(async (tx) => {
    const users = await tx`
      INSERT INTO users (email, password_hash, role)
      SELECT 'seed-' || g || '@lch.local', ${opts.passwordHash}, 'USER'
      FROM generate_series(1, ${opts.users}::int) AS g
      ON CONFLICT (email) DO NOTHING`;
    const licenses = await tx`
      INSERT INTO licenses (key, hwid, status, user_id, duration_days, activated_at, expires_at, created_at)
      SELECT
        'APP-' || substr(k.h, 1, 4) || '-' || substr(k.h, 5, 4) || '-' || substr(k.h, 9, 4),
        CASE WHEN g % 10 = 0 THEN NULL ELSE 'seed-hwid-' || g END,
        CASE WHEN g % 10 = 0 THEN 'UNACTIVATED' WHEN g % 20 = 1 THEN 'BANNED' ELSE 'ACTIVE' END,
        u.id,
        30,
        CASE WHEN g % 10 = 0 THEN NULL ELSE now() - make_interval(days => g % 40) END,
        CASE WHEN g % 10 = 0 THEN NULL ELSE now() - make_interval(days => g % 40) + interval '30 days' END,
        now() - make_interval(mins => g)
      FROM generate_series(1, ${opts.licenses}::int) AS g
      CROSS JOIN LATERAL (SELECT lpad(upper(to_hex(g)), 12, '0') AS h) AS k
      JOIN users u ON u.email = 'seed-' || (1 + (g - 1) % ${Math.max(opts.users, 1)}::int) || '@lch.local'
      ON CONFLICT (key) DO NOTHING`;
    return { usersInserted: users.count, licensesInserted: licenses.count };
  });
}

/** Key of the N-th seeded license (same formula as the SQL above) — for load scripts and tests. */
export function seededLicenseKey(n: number): string {
  const h = n.toString(16).toUpperCase().padStart(12, '0');
  return `APP-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}
