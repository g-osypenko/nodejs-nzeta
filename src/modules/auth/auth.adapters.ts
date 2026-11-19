import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  AuthError,
  createAuthService,
  createCodeLoginService,
  createPasswordHasher,
  type AuthService,
  type AuthStore,
  type CodeGenerator,
  type CodeLoginService,
  type LoginCodeStore,
  type Mailer,
  type HashingLimits,
  type PasswordHasher,
  type PasswordKdf,
  type SessionTokens,
} from '@lch/auth-core';
import { getContext } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { hashPassword, verifyPassword } from './password.js';

/**
 * The host side of @lch/auth-core (ADR 0010): concrete implementations of the package's ports and
 * the mapping of its errors to spec.md §3. The package itself knows none of this.
 */

/** scrypt (node:crypto) — see password.ts for the parameters and the encoded format. */
export const scryptKdf: PasswordKdf = { hash: hashPassword, verify: verifyPassword };

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

export function createAppCodeLogin(deps: {
  users: AuthStore;
  codes: LoginCodeStore;
  mailer: Mailer;
  sessionTtlHours: number;
  codeTtlMinutes: number;
  adminEmail: string;
}): CodeLoginService {
  return createCodeLoginService({
    users: deps.users,
    codes: deps.codes,
    mailer: deps.mailer,
    codeGenerator: sixDigitCodes,
    clock: { now: () => new Date() },
    tokens: sessionTokens,
    logger,
    sessionTtlMs: deps.sessionTtlHours * 3_600_000,
    policy: { ttlMs: deps.codeTtlMinutes * 60_000, ...LOGIN_CODE_LIMITS },
    adminEmails: [deps.adminEmail],
  });
}

export interface AppAuth {
  service: AuthService;
  hasher: PasswordHasher;
}

export function createAppAuth(deps: {
  store: AuthStore;
  sessionTtlHours: number;
  hashing: HashingLimits;
}): AppAuth {
  const hasher = createPasswordHasher(scryptKdf, deps.hashing);
  const service = createAuthService({
    store: deps.store,
    hasher,
    clock: { now: () => new Date() },
    tokens: sessionTokens,
    currentUser: { get: () => getContext()?.user ?? null },
    logger,
    sessionTtlMs: deps.sessionTtlHours * 3_600_000,
  });
  return { service, hasher };
}

/** AuthError (package) → AppError (spec.md §3); called by the single global error handler. */
export function toAppError(error: AuthError): AppError {
  switch (error.code) {
    case 'USER_NOT_FOUND':
      return new AppError('NOT_FOUND', 'User not found');
    case 'AUTH_BUSY':
      return new AppError('AUTH_BUSY', error.message);
    case 'TOO_MANY_REQUESTS':
      return new AppError('TOO_MANY_REQUESTS', error.message, undefined, error.retryAfterSeconds);
    default:
      return new AppError(error.code, error.message);
  }
}

export { AuthError };
