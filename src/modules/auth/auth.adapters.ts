import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  AuthError,
  createAuthService,
  type AuthService,
  type AuthStore,
  type CodeGenerator,
  type LoginCodeStore,
  type Mailer,
  type SessionTokens,
} from '@lch/auth-core';
import { getContext } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

/**
 * The host side of @lch/auth-core (ADR 0010, ADR 0011): concrete implementations of the package's
 * ports and the mapping of its errors to the API error codes. The package itself knows none of this.
 */

/** 32 random bytes as base64url; only the SHA-256 is stored, so a DB leak leaks no live session. */
export const sessionTokens: SessionTokens = {
  generate: () => randomBytes(32).toString('base64url'),
  digest: (token) => createHash('sha256').update(token).digest('hex'),
};

/** Uniform 000000–999999 from the CSPRNG (randomInt has no modulo bias). */
export const sixDigitCodes: CodeGenerator = {
  generate: () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
};

/** Limits of ADR 0011: ≤ 5 guesses per code, ≤ 5 codes per hour, one email a minute. */
export const LOGIN_CODE_LIMITS = {
  maxAttempts: 5,
  resendCooldownMs: 60_000,
  maxPerHour: 5,
} as const;

export function createAppAuth(deps: {
  store: AuthStore;
  codes: LoginCodeStore;
  mailer: Mailer;
  sessionTtlHours: number;
  codeTtlMinutes: number;
  /** DEV_LOGIN_CODE: every code is this value (development only, refused in production). */
  fixedCode?: string | null;
}): AuthService {
  const fixed = deps.fixedCode ?? null;
  return createAuthService({
    store: deps.store,
    codes: deps.codes,
    mailer: deps.mailer,
    codeGenerator: fixed === null ? sixDigitCodes : { generate: () => fixed },
    clock: { now: () => new Date() },
    tokens: sessionTokens,
    currentUser: { get: () => getContext()?.user ?? null },
    logger,
    sessionTtlMs: deps.sessionTtlHours * 3_600_000,
    policy: { ttlMs: deps.codeTtlMinutes * 60_000, ...LOGIN_CODE_LIMITS },
  });
}

/** AuthError (package) → AppError (API codes); called by the single global error handler. */
export function toAppError(error: AuthError): AppError {
  switch (error.code) {
    case 'USER_NOT_FOUND':
      return new AppError('NOT_FOUND', 'User not found');
    case 'TOO_MANY_REQUESTS':
      return new AppError('TOO_MANY_REQUESTS', error.message, undefined, error.retryAfterSeconds);
    default:
      return new AppError(error.code, error.message);
  }
}

export { AuthError };
