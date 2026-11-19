import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthService } from '@lch/auth-core';
import { AuthError, createAppAuth, toAppError } from '../../../src/modules/auth/auth.adapters.js';
import { createMemoryMailer, type SentMail } from '../../../src/modules/auth/auth.mailer.js';
import {
  createMemoryAuthRepository,
  createMemoryLoginCodeRepository,
} from '../../../src/modules/auth/auth.repository.memory.js';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { AppError } from '../../../src/shared/errors.js';
import { runAs } from '../../support/fixtures.js';

const EMAIL = 'alice@test.local';
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    // The global error handler maps library errors the same way (src/app.ts mapError).
    (e: unknown) => {
      const mapped = e instanceof AuthError ? toAppError(e) : e;
      return mapped instanceof AppError ? mapped.code : `non-AppError: ${String(e)}`;
    },
  );
}

/**
 * Wiring of @lch/auth-core in the app (ADR 0010, ADR 0011): CSPRNG 6-digit codes, SHA-256 tokens,
 * the in-memory repositories and the AsyncLocalStorage current user. The package itself is tested
 * on fakes in packages/auth-core/test.
 */
describe('auth (app wiring of @lch/auth-core)', () => {
  let store: MemoryStore;
  let outbox: SentMail[];
  let auth: AuthService;

  beforeEach(() => {
    store = createMemoryStore();
    const mail = createMemoryMailer('https://lch.test');
    outbox = mail.outbox;
    auth = createAppAuth({
      store: createMemoryAuthRepository(store),
      codes: createMemoryLoginCodeRepository(store),
      mailer: mail.mailer,
      sessionTtlHours: 2,
      codeTtlMinutes: 10,
    });
  });

  const signIn = async (email = EMAIL): Promise<{ token: string; userId: string }> => {
    await auth.requestCode(email);
    const letter = outbox.filter((m) => m.to === email).at(-1);
    const session = await auth.verifyCode(email, letter?.code ?? '');
    return { token: session.token, userId: session.user.id };
  };

  it('the letter has a 6-digit code and a link; only SHA-256 digests are stored', async () => {
    await auth.requestCode(EMAIL);
    const [letter] = outbox;
    expect(letter?.code).toMatch(/^\d{6}$/);
    const linkToken = decodeURIComponent(letter?.link.split('#token=')[1] ?? '');
    expect(letter?.link).toMatch(/^https:\/\/lch\.test\/login\/verify#token=[\w-]{43}$/);
    const [challenge] = [...store.loginChallenges.values()];
    expect(challenge?.codeHash).toBe(sha256(letter?.code ?? ''));
    expect(challenge?.tokenHash).toBe(sha256(linkToken));
  });

  it('codes are uniform random 6 digits (leading zeros kept)', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      await auth.requestCode(`u${i}@test.local`);
    }
    for (const m of outbox) {
      expect(m.code).toMatch(/^\d{6}$/);
      codes.add(m.code);
    }
    expect(codes.size).toBeGreaterThan(190);
  });

  it('verify issues an opaque token; only its sha256 is stored; expiry = now + TTL', async () => {
    const before = Date.now();
    const { token, userId } = await signIn();
    expect(token).toMatch(/^[\w-]{43}$/);
    const [session] = [...store.sessions.values()];
    expect(session?.tokenHash).toBe(sha256(token));
    expect(session?.userId).toBe(userId);
    const ttl = (session?.expiresAt.getTime() ?? 0) - before;
    expect(ttl).toBeGreaterThanOrEqual(2 * 3_600_000);
    expect(ttl).toBeLessThan(2 * 3_600_000 + 5_000);
    expect(store.users.get(userId)).toMatchObject({
      email: EMAIL,
      role: 'USER',
      passwordHash: null,
    });
  });

  it('5 wrong codes burn the challenge (ADR 0011 limit); errors map to INVALID_CODE', async () => {
    await auth.requestCode(EMAIL);
    const right = outbox[0]?.code ?? '';
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i += 1) {
      expect(await codeOf(auth.verifyCode(EMAIL, wrong))).toBe('INVALID_CODE');
    }
    expect(await codeOf(auth.verifyCode(EMAIL, right))).toBe('INVALID_CODE');
  });

  it('a second code within a minute → TOO_MANY_REQUESTS with Retry-After ≤ 60 s', async () => {
    await auth.requestCode(EMAIL);
    const error: unknown = await auth.requestCode(EMAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    const mapped = toAppError(error as AuthError);
    expect(mapped).toMatchObject({ code: 'TOO_MANY_REQUESTS', statusCode: 429 });
    expect(mapped.retryAfterSeconds).toBeGreaterThan(0);
    expect(mapped.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('authenticate: unknown or expired token → null', async () => {
    const { token } = await signIn();
    expect(await auth.authenticate(token)).toMatchObject({ email: EMAIL });
    expect(await auth.authenticate('nope')).toBeNull();
    const [session] = [...store.sessions.values()];
    if (session) session.expiresAt = new Date();
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('logout requires a user and deletes only that session', async () => {
    const a = await signIn();
    const b = await signIn('bob@test.local');
    const user = { id: a.userId, email: EMAIL, role: 'USER' as const };
    expect(await codeOf(runAs(null, () => auth.logout(a.token)))).toBe('UNAUTHENTICATED');
    await runAs(user, () => auth.logout(a.token));
    expect(await auth.authenticate(a.token)).toBeNull();
    expect(await auth.authenticate(b.token)).not.toBeNull();
  });

  it('me returns the current user; NOT_FOUND if the account vanished; 401 when anonymous', async () => {
    const { userId } = await signIn();
    const user = { id: userId, email: EMAIL, role: 'USER' as const };
    expect(await runAs(user, () => auth.me())).toMatchObject({ id: userId, email: EMAIL });
    expect(await codeOf(runAs(null, () => auth.me()))).toBe('UNAUTHENTICATED');
    store.users.delete(userId);
    expect(await codeOf(runAs(user, () => auth.me()))).toBe('NOT_FOUND');
  });

  it('ensureAdmin is idempotent; the admin signs in by code as ADMIN', async () => {
    await auth.ensureAdmin('root@test.local');
    await auth.ensureAdmin('root@test.local');
    expect([...store.users.values()]).toEqual([
      expect.objectContaining({ email: 'root@test.local', role: 'ADMIN', passwordHash: null }),
    ]);
    const { userId } = await signIn('root@test.local');
    expect(store.users.get(userId)?.role).toBe('ADMIN');
  });
});
