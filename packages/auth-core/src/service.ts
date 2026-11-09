import { AuthError, type AuthDeps, type AuthService, type AuthUser } from './contract.js';

/**
 * Registration, sign-in and sessions. Every dependency arrives in one `deps` object (ADR 0005,
 * ADR 0010): the service never reaches for a global — not the database, not the clock, not the
 * request context — so it runs unchanged on Postgres, in memory and in its own unit tests.
 */
export function createAuthService(deps: AuthDeps): AuthService {
  const { store, hasher, clock, tokens, currentUser, logger, sessionTtlMs } = deps;

  const requireUser = (): AuthUser => {
    const user = currentUser.get();
    if (!user) throw new AuthError('UNAUTHENTICATED', 'Authentication required');
    return user;
  };

  const service: AuthService = {
    async register({ email, password }) {
      const user = await store.createUser({
        email,
        passwordHash: await hasher.hash(password),
        role: 'USER',
      });
      logger.info({ newUserId: user.id }, 'user registered');
      return user;
    },

    async login({ email, password }) {
      const user = await store.findUserByEmail(email);
      // Same error for an unknown email and a wrong password: do not reveal which emails exist.
      if (!user || !(await hasher.verify(password, user.passwordHash))) {
        throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
      }
      const token = tokens.generate();
      const expiresAt = new Date(clock.now().getTime() + sessionTtlMs);
      await store.createSession({ tokenHash: tokens.digest(token), userId: user.id, expiresAt });
      logger.info({ loginUserId: user.id }, 'session created');
      return { token, expiresAt };
    },

    async logout(token) {
      requireUser();
      await store.deleteSession(tokens.digest(token));
    },

    async me() {
      const { id } = requireUser();
      const user = await store.findUserById(id);
      if (!user) throw new AuthError('USER_NOT_FOUND', 'User not found');
      return user;
    },

    async authenticate(token) {
      return store.findSessionUser(tokens.digest(token), clock.now());
    },

    async ensureAdmin(email, password) {
      await store.ensureUser({ email, passwordHash: await hasher.hash(password), role: 'ADMIN' });
    },
  };
  return service;
}
