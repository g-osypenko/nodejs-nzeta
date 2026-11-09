import { createHash, randomBytes } from 'node:crypto';
import { requireUser, type AuthUser } from '../../shared/context.js';
import type { UserRow } from '../../shared/db/rows.js';
import { AppError, notFound } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import type { AuthRepository } from './auth.repository.js';
import type { Credentials } from './auth.schemas.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthService {
  register(input: Credentials): Promise<UserRow>;
  login(input: Credentials): Promise<{ token: string; expiresAt: Date }>;
  logout(token: string): Promise<void>;
  me(): Promise<UserRow>;
  /** Resolves a bearer token to a user; `null` for unknown/expired tokens. */
  authenticate(token: string): Promise<AuthUser | null>;
  ensureAdmin(email: string, password: string): Promise<void>;
}

export interface AuthServiceDeps {
  repo: AuthRepository;
  sessionTtlHours: number;
}

/** Only the SHA-256 of a session token is stored, so a DB leak does not leak live sessions. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createAuthService({ repo, sessionTtlHours }: AuthServiceDeps): AuthService {
  const service: AuthService = {
    async register({ email, password }) {
      const user = await repo.createUser({
        email,
        passwordHash: await hashPassword(password),
        role: 'USER',
      });
      logger.info({ newUserId: user.id }, 'user registered');
      return user;
    },

    async login({ email, password }) {
      const user = await repo.findUserByEmail(email);
      // Same error for unknown email and wrong password: do not reveal which emails exist.
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + sessionTtlHours * 3_600_000);
      await repo.createSession({ tokenHash: hashToken(token), userId: user.id, expiresAt });
      logger.info({ loginUserId: user.id }, 'session created');
      return { token, expiresAt };
    },

    async logout(token) {
      requireUser();
      await repo.deleteSession(hashToken(token));
    },

    async me() {
      const { id } = requireUser();
      const user = await repo.findUserById(id);
      if (!user) throw notFound('User');
      return user;
    },

    authenticate(token) {
      return repo.findSessionUser(hashToken(token), new Date());
    },

    async ensureAdmin(email, password) {
      await repo.ensureUser({ email, passwordHash: await hashPassword(password), role: 'ADMIN' });
    },
  };
  return service;
}
