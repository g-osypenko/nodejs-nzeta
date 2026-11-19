import {
  AuthError,
  type CodeLoginDeps,
  type CodeLoginService,
  type IssuedSession,
  type UserRecord,
} from './contract.js';

const HOUR_MS = 3_600_000;

/** Whole seconds until `at`, never less than 1 (a Retry-After of 0 invites a busy loop). */
function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

/**
 * Passwordless sign-in (ADR 0011): an emailed 6-digit code or a one-click link opens a session.
 * There is no separate registration — the first successful sign-in creates the account.
 * No KDF is involved: a code lives minutes and has an attempt limit, so a digest is enough.
 */
export function createCodeLoginService(deps: CodeLoginDeps): CodeLoginService {
  const { users, codes, mailer, codeGenerator, clock, tokens, logger, sessionTtlMs, policy } = deps;
  const admins = new Set(deps.adminEmails);

  const issueSession = async (email: string): Promise<IssuedSession> => {
    const user: UserRecord = await codes.ensureUserByEmail(
      email,
      admins.has(email) ? 'ADMIN' : 'USER',
    );
    const token = tokens.generate();
    const expiresAt = new Date(clock.now().getTime() + sessionTtlMs);
    await users.createSession({ tokenHash: tokens.digest(token), userId: user.id, expiresAt });
    logger.info({ loginUserId: user.id }, 'session created by sign-in code');
    return { token, expiresAt, user };
  };

  const invalid = (): AuthError =>
    new AuthError('INVALID_CODE', 'The code is wrong or expired, request a new one');

  const service: CodeLoginService = {
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
      if (!ok) throw invalid();
      return issueSession(email);
    },

    async verifyLink(token) {
      const email = await codes.consumeByToken(tokens.digest(token), clock.now());
      if (email === null) throw invalid();
      return issueSession(email);
    },
  };
  return service;
}
