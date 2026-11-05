import type { AuthUser } from '../../shared/context.js';
import type { Db } from '../../shared/db/client.js';
import type { UserRow } from '../../shared/db/rows.js';
import { AppError } from '../../shared/errors.js';
import type { AuthRepository } from './auth.repository.js';

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
