import {
  AuthError,
  type AuthDeps,
  type AuthService,
  type AuthUser,
  type IssuedSession,
} from './contract.js';

const HOUR_MS = 3_600_000;

/** Whole seconds until `at`, never less than 1 (a Retry-After of 0 invites a busy loop). */
function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

/**
 * Passwordless sign-in and sessions (ADR 0011). Every dependency arrives in one `deps` object
 * (ADR 0005, ADR 0010): the service never reaches for a global — not the database, not the clock,
 * not the request context — so it runs unchanged on Postgres, in memory and in its own unit tests.
 *
 * There is no separate registration: the first successful sign-in creates the account. No KDF is
 * involved — a code lives minutes and has an attempt limit, so a digest is enough.
 */
export function createAuthService(deps: AuthDeps): AuthService {
  const { store, codes, mailer, codeGenerator, clock, tokens, currentUser, logger } = deps;
  const { sessionTtlMs, policy } = deps;

  const requireUser = (): AuthUser => {
    const user = currentUser.get();
    if (!user) throw new AuthError('UNAUTHENTICATED', 'Authentication required');
    return user;
  };

  const issueSession = async (email: string): Promise<IssuedSession> => {
    const user = await store.ensureUserByEmail(email, 'USER');
    const token = tokens.generate();
    const expiresAt = new Date(clock.now().getTime() + sessionTtlMs);
    await store.createSession({ tokenHash: tokens.digest(token), userId: user.id, expiresAt });
    logger.info({ loginUserId: user.id }, 'session created');
    return { token, expiresAt, user };
  };

  const invalidCode = (): AuthError =>
    new AuthError('INVALID_CODE', 'The code is wrong or expired, request a new one');

  const service: AuthService = {
    async requestCode(email) {
      const now = clock.now().getTime();
      const recent = await codes.recentChallenges(email, new Date(now - HOUR_MS));
      if (recent.newestAt && now - recent.newestAt.getTime() < policy.resendCooldownMs) {
        const retry = secondsUntil(recent.newestAt.getTime() + policy.resendCooldownMs, now);
        throw new AuthError('TOO_MANY_REQUESTS', 'A code was sent a moment ago', retry);
      }
      if (recent.oldestAt && recent.count >= policy.maxPerHour) {
        const retry = secondsUntil(recent.oldestAt.getTime() + HOUR_MS, now);
        throw new AuthError('TOO_MANY_REQUESTS', 'Too many codes for this email', retry);
      }

      const code = codeGenerator.generate();
      const linkToken = tokens.generate();
      const expiresAt = new Date(now + policy.ttlMs);
      await codes.createChallenge(
        { email, codeHash: tokens.digest(code), tokenHash: tokens.digest(linkToken), expiresAt },
        new Date(now),
      );
      await mailer.sendLoginCode({ email, code, linkToken, expiresAt });
      logger.info({ codeExpiresAt: expiresAt.toISOString() }, 'sign-in code sent');
      return { expiresAt };
    },

    async verifyCode(email, code) {
      const ok = await codes.consumeByCode(
        email,
        tokens.digest(code),
        clock.now(),
        policy.maxAttempts,
      );
      if (!ok) throw invalidCode();
      return issueSession(email);
    },

    async verifyLink(token) {
      const email = await codes.consumeByToken(tokens.digest(token), clock.now());
      if (email === null) throw invalidCode();
      return issueSession(email);
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

    async ensureAdmin(email) {
      await store.ensureUserByEmail(email, 'ADMIN');
    },
  };
  return service;
}
