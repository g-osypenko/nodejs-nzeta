/**
 * Port of the auth module. Since Lab 5 it is defined by @lch/auth-core (`AuthStore`); the host keeps
 * the implementations (*.memory.ts, *.postgres.ts) and this alias for the rest of the app.
 */
export type { AuthStore as AuthRepository } from '@lch/auth-core';
/** Sign-in challenges of passwordless login (ADR 0011). */
export type { LoginCodeStore as LoginCodeRepository } from '@lch/auth-core';
