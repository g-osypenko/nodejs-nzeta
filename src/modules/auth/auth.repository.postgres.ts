import type { AuthUser } from '../../shared/context.js';
import type { Db } from '../../shared/db/client.js';
import type { UserRow } from '../../shared/db/rows.js';
import { AppError } from '../../shared/errors.js';
import type { AuthRepository, LoginCodeRepository } from './auth.repository.js';

export function createPostgresAuthRepository(sql: Db): AuthRepository {
  const repository: AuthRepository = {
    async createUser({ email, passwordHash, role }) {
      // ON CONFLICT instead of catching 23505: no row back == email taken.
      const [row] = await sql<UserRow[]>`
        INSERT INTO users (email, password_hash, role)
        VALUES (${email}, ${passwordHash}, ${role})
        ON CONFLICT (email) DO NOTHING
        RETURNING *`;
      if (!row) throw new AppError('EMAIL_TAKEN', 'Email is already registered');
      return row;
    },

    async ensureUser({ email, passwordHash, role }) {
      await sql`
        INSERT INTO users (email, password_hash, role)
        VALUES (${email}, ${passwordHash}, ${role})
        ON CONFLICT (email) DO NOTHING`;
    },

    async findUserByEmail(email) {
      const [row] = await sql<UserRow[]>`SELECT * FROM users WHERE email = ${email}`;
      return row ?? null;
    },

    async findUserById(id) {
      const [row] = await sql<UserRow[]>`SELECT * FROM users WHERE id = ${id}`;
      return row ?? null;
    },

    async createSession({ tokenHash, userId, expiresAt }) {
      await sql`
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (${tokenHash}, ${userId}, ${expiresAt})`;
    },

    async findSessionUser(tokenHash, now) {
      const [row] = await sql<AuthUser[]>`
        SELECT u.id, u.email, u.role
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash} AND s.expires_at > ${now}`;
      return row ?? null;
    },

    async deleteSession(tokenHash) {
      await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
    },
  };
  return repository;
}

export function createPostgresLoginCodeRepository(sql: Db): LoginCodeRepository {
  const repository: LoginCodeRepository = {
    async recentChallenges(email, since) {
      const [row] = await sql<{ count: number; oldestAt: Date | null; newestAt: Date | null }[]>`
        SELECT count(*)::int AS count, min(created_at) AS oldest_at, max(created_at) AS newest_at
        FROM login_challenges
        WHERE email = ${email} AND created_at > ${since}`;
      return row ?? { count: 0, oldestAt: null, newestAt: null };
    },

    async createChallenge({ email, codeHash, tokenHash, expiresAt }, now) {
      // One transaction: closing the previous challenges and opening the new one is atomic.
      await sql.begin(async (tx) => {
        await tx`
          UPDATE login_challenges SET consumed_at = ${now}
          WHERE email = ${email} AND consumed_at IS NULL`;
        await tx`
          INSERT INTO login_challenges (email, code_hash, token_hash, expires_at, created_at)
          VALUES (${email}, ${codeHash}, ${tokenHash}, ${expiresAt}, ${now})`;
      });
    },

    async consumeByCode(email, codeHash, now, maxAttempts) {
      // One statement: the row lock of FOR UPDATE serialises concurrent guesses, so the attempt
      // limit cannot be bypassed by sending many codes at once.
      const [row] = await sql<{ matched: boolean }[]>`
        WITH target AS (
          SELECT id, code_hash = ${codeHash} AS matched
          FROM login_challenges
          WHERE email = ${email} AND consumed_at IS NULL AND expires_at > ${now}
            AND attempts < ${maxAttempts}
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        )
        UPDATE login_challenges c
        SET consumed_at = CASE WHEN target.matched THEN ${now}::timestamptz END,
            attempts = c.attempts + CASE WHEN target.matched THEN 0 ELSE 1 END
        FROM target
        WHERE c.id = target.id
        RETURNING target.matched`;
      return row?.matched ?? false;
    },

    async consumeByToken(tokenHash, now) {
      const [row] = await sql<{ email: string }[]>`
        UPDATE login_challenges SET consumed_at = ${now}
        WHERE token_hash = ${tokenHash} AND consumed_at IS NULL AND expires_at > ${now}
        RETURNING email`;
      return row?.email ?? null;
    },

    async ensureUserByEmail(email, role) {
      // ON CONFLICT DO NOTHING returns no row for an existing user, hence the UNION fallback:
      // one round trip in the common cases. The statement snapshot cannot see a row that a
      // concurrent first sign-in committed while this INSERT waited on the unique index —
      // then neither branch returns it and one plain SELECT (a new snapshot) does.
      const [row] = await sql<UserRow[]>`
        WITH inserted AS (
          INSERT INTO users (email, password_hash, role)
          VALUES (${email}, NULL, ${role})
          ON CONFLICT (email) DO NOTHING
          RETURNING *
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT * FROM users WHERE email = ${email}
        LIMIT 1`;
      if (row) return row;
      const [raced] = await sql<UserRow[]>`SELECT * FROM users WHERE email = ${email}`;
      if (!raced) throw new Error('user vanished during sign-in');
      return raced;
    },
  };
  return repository;
}
