import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../shared/context.js';
import type { MemoryStore } from '../../shared/db/memory-store.js';
import type { UserRow } from '../../shared/db/rows.js';
import { AppError } from '../../shared/errors.js';
import type { AuthRepository, NewUser } from './auth.repository.js';

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
