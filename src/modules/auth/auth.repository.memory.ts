import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../shared/context.js';
import type { MemoryStore } from '../../shared/db/memory-store.js';
import type { LoginChallengeRow, UserRow } from '../../shared/db/rows.js';
import { AppError } from '../../shared/errors.js';
import type { AuthRepository, LoginCodeRepository, NewUser } from './auth.repository.js';

export function createMemoryAuthRepository(store: MemoryStore): AuthRepository {
  const byEmail = (email: string): UserRow | undefined =>
    [...store.users.values()].find((u) => u.email === email);

  const insert = (user: NewUser): UserRow => {
    const row: UserRow = { id: randomUUID(), createdAt: new Date(), ...user };
    store.users.set(row.id, row);
    return row;
  };

  const repository: AuthRepository = {
    async createUser(user) {
      if (byEmail(user.email)) throw new AppError('EMAIL_TAKEN', 'Email is already registered');
      return insert(user);
    },
    async ensureUser(user) {
      if (!byEmail(user.email)) insert(user);
    },
    async findUserByEmail(email) {
      return byEmail(email) ?? null;
    },
    async findUserById(id) {
      return store.users.get(id) ?? null;
    },
    async createSession(session) {
      store.sessions.set(session.tokenHash, session);
    },
    async findSessionUser(tokenHash, now): Promise<AuthUser | null> {
      const session = store.sessions.get(tokenHash);
      if (!session || session.expiresAt <= now) return null;
      const user = store.users.get(session.userId);
      return user ? { id: user.id, email: user.email, role: user.role } : null;
    },
    async deleteSession(tokenHash) {
      store.sessions.delete(tokenHash);
    },
  };
  return repository;
}

/**
 * Same invariants as migrations/002: one open challenge per email (a new one closes the rest),
 * unique token digest, attempts counted on the newest open challenge only. No `await` between a
 * check and its write, so concurrent requests cannot interleave (see memory-store.ts).
 */
export function createMemoryLoginCodeRepository(store: MemoryStore): LoginCodeRepository {
  const isOpen = (c: LoginChallengeRow, now: Date): boolean =>
    c.consumedAt === null && c.expiresAt > now;

  const repository: LoginCodeRepository = {
    async recentChallenges(email, since) {
      let count = 0;
      let oldestAt: Date | null = null;
      let newestAt: Date | null = null;
      for (const c of store.loginChallenges.values()) {
        if (c.email !== email || c.createdAt <= since) continue;
        count += 1;
        if (!oldestAt || c.createdAt < oldestAt) oldestAt = c.createdAt;
        if (!newestAt || c.createdAt > newestAt) newestAt = c.createdAt;
      }
      return { count, oldestAt, newestAt };
    },

    async createChallenge(challenge, now) {
      for (const c of store.loginChallenges.values()) {
        if (c.tokenHash === challenge.tokenHash) {
          throw new Error('login_challenges_token_hash_key: duplicate token digest');
        }
      }
      for (const c of store.loginChallenges.values()) {
        if (c.email === challenge.email && c.consumedAt === null) c.consumedAt = now;
      }
      const row: LoginChallengeRow = {
        id: randomUUID(),
        ...challenge,
        attempts: 0,
        consumedAt: null,
        createdAt: now,
      };
      store.loginChallenges.set(row.id, row);
    },

    async consumeByCode(email, codeHash, now, maxAttempts) {
      let newest: LoginChallengeRow | undefined;
      for (const c of store.loginChallenges.values()) {
        if (c.email !== email || !isOpen(c, now) || c.attempts >= maxAttempts) continue;
        if (!newest || c.createdAt >= newest.createdAt) newest = c;
      }
      if (!newest) return false;
      if (newest.codeHash !== codeHash) {
        newest.attempts += 1;
        return false;
      }
      newest.consumedAt = now;
      return true;
    },

    async consumeByToken(tokenHash, now) {
      for (const c of store.loginChallenges.values()) {
        if (c.tokenHash === tokenHash && isOpen(c, now)) {
          c.consumedAt = now;
          return c.email;
        }
      }
      return null;
    },

    async ensureUserByEmail(email, role) {
      const existing = [...store.users.values()].find((u) => u.email === email);
      if (existing) return existing;
      const row: UserRow = {
        id: randomUUID(),
        email,
        passwordHash: null,
        role,
        createdAt: new Date(),
      };
      store.users.set(row.id, row);
      return row;
    },
  };
  return repository;
}
