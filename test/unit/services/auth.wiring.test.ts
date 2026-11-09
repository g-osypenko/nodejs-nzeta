import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAuthRepository } from '../../../src/modules/auth/auth.repository.memory.js';
import type { AuthService } from '@lch/auth-core';
import { AuthError, createAppAuth, toAppError } from '../../../src/modules/auth/auth.adapters.js';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { AppError } from '../../../src/shared/errors.js';
import { asUser, runAs } from '../../support/fixtures.js';

const creds = { email: 'alice@test.local', password: 'alice-password' };

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
 * Wiring of @lch/auth-core in the app (ADR 0010): real scrypt, SHA-256 tokens, the in-memory
 * repository and the AsyncLocalStorage current user — the package itself is tested on fakes in
 * packages/auth-core/test.
 */
describe('auth (app wiring of @lch/auth-core)', () => {
  let store: MemoryStore;
  let auth: AuthService;

  beforeEach(() => {
    store = createMemoryStore();
    auth = createAppAuth({
      store: createMemoryAuthRepository(store),
      sessionTtlHours: 2,
      hashing: { maxConcurrent: 1, maxQueued: 8 },
    }).service;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('register stores a USER with a scrypt hash, never the plain password', async () => {
    const user = await auth.register(creds);
    expect(user).toMatchObject({ email: creds.email, role: 'USER' });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(creds.password);
  });

  it('register with a taken email → EMAIL_TAKEN, no second user', async () => {
    await auth.register(creds);
    expect(await codeOf(auth.register({ ...creds, password: 'other-password' }))).toBe(
      'EMAIL_TAKEN',
    );
    expect(store.users.size).toBe(1);
  });

  it('login returns an opaque token; only its sha256 is stored; expiry = now + TTL', async () => {
    const user = await auth.register(creds);
    // Frozen clock (only Date; scrypt timers stay real): the expiry is exact, not "±50 ms",
    // which flaked on a slower CI runner (+56 ms).
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2026-11-09T12:00:00.000Z');
    vi.setSystemTime(now);
    const { token, expiresAt } = await auth.login(creds);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    const [session] = [...store.sessions.values()];
    expect(session?.userId).toBe(user.id);
    expect(session?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session?.tokenHash).not.toBe(token);
    expect(expiresAt.getTime() - now.getTime()).toBe(2 * 3_600_000);
  });

  it('login: unknown email and wrong password give the SAME error (no user enumeration)', async () => {
    await auth.register(creds);
    expect(await codeOf(auth.login({ ...creds, password: 'wrong-password' }))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(await codeOf(auth.login({ ...creds, email: 'bob@test.local' }))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(store.sessions.size).toBe(0);
  });

  it('authenticate resolves a live token to the user; unknown/expired → null', async () => {
    const user = await auth.register(creds);
    const { token } = await auth.login(creds);
    expect(await auth.authenticate(token)).toEqual(asUser(user));
    expect(await auth.authenticate('not-a-token')).toBeNull();

    const [session] = [...store.sessions.values()];
    if (session) session.expiresAt = new Date(Date.now() - 1);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('authenticate: session at exactly its expiry instant is already dead (boundary)', async () => {
    await auth.register(creds);
    const { token } = await auth.login(creds);
    const [session] = [...store.sessions.values()];
    if (session) session.expiresAt = new Date();
    expect(await auth.authenticate(token)).toBeNull();
  });

  it('logout requires a user and deletes only that session', async () => {
    const user = await auth.register(creds);
    const a = await auth.login(creds);
    const b = await auth.login(creds);

    expect(await codeOf(runAs(null, () => auth.logout(a.token)))).toBe('UNAUTHENTICATED');
    await runAs(asUser(user), () => auth.logout(a.token));

    expect(await auth.authenticate(a.token)).toBeNull();
    expect(await auth.authenticate(b.token)).not.toBeNull();
  });

  it('me returns the current user; NOT_FOUND if the account vanished; 401 when anonymous', async () => {
    const user = await auth.register(creds);
    expect(await runAs(asUser(user), () => auth.me())).toEqual(user);
    expect(await codeOf(runAs(null, () => auth.me()))).toBe('UNAUTHENTICATED');
    store.users.delete(user.id);
    expect(await codeOf(runAs(asUser(user), () => auth.me()))).toBe('NOT_FOUND');
  });

  it('ensureAdmin is idempotent and never changes an existing account', async () => {
    await auth.ensureAdmin('root@test.local', 'root-password');
    await auth.ensureAdmin('root@test.local', 'another-password');
    const admins = [...store.users.values()];
    expect(admins).toHaveLength(1);
    expect(admins[0]?.role).toBe('ADMIN');
    await expect(
      auth.login({ email: 'root@test.local', password: 'root-password' }),
    ).resolves.toBeTruthy();
  });
});
