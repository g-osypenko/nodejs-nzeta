import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthService,
  type AuthDeps,
  type AuthService,
  type AuthStore,
  type AuthUser,
  type LoginCodeStore,
  type SessionRecord,
  type UserRecord,
} from '../src/index.js';

interface Challenge {
  email: string;
  codeHash: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

interface Sent {
  email: string;
  code: string;
  linkToken: string;
  expiresAt: Date;
}

const T0 = new Date('2026-11-19T10:00:00.000Z');
const POLICY = { ttlMs: 600_000, maxAttempts: 3, resendCooldownMs: 60_000, maxPerHour: 4 };
const SESSION_TTL_MS = 3_600_000;

/**
 * Fakes of every port, with the semantics the real stores promise (atomic consume, supersede on
 * create): the package is tested without a database, crypto or a web framework.
 */
function fakes(): {
  deps: AuthDeps;
  challenges: Challenge[];
  users: Map<string, UserRecord>;
  sessions: Map<string, SessionRecord>;
  sent: Sent[];
  logs: { msg: string; fields: Record<string, unknown> }[];
  setNow: (d: Date) => void;
  setUser: (u: AuthUser | null) => void;
} {
  let now = T0;
  let current: AuthUser | null = null;
  let seq = 0;
  const challenges: Challenge[] = [];
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRecord>();
  const sent: Sent[] = [];
  const logs: { msg: string; fields: Record<string, unknown> }[] = [];

  const open = (c: Challenge, at: Date, maxAttempts = Infinity): boolean =>
    c.consumedAt === null && c.expiresAt > at && c.attempts < maxAttempts;

  const codes: LoginCodeStore = {
    async recentChallenges(email, since) {
      const mine = challenges.filter((c) => c.email === email && c.createdAt > since);
      const times = mine.map((c) => c.createdAt.getTime());
      return {
        count: mine.length,
        oldestAt: times.length ? new Date(Math.min(...times)) : null,
        newestAt: times.length ? new Date(Math.max(...times)) : null,
      };
    },
    async createChallenge(c, at) {
      for (const old of challenges) {
        if (old.email === c.email && old.consumedAt === null) old.consumedAt = at;
      }
      challenges.push({ ...c, attempts: 0, consumedAt: null, createdAt: at });
    },
    async consumeByCode(email, codeHash, at, maxAttempts) {
      const c = challenges.filter((x) => x.email === email && open(x, at, maxAttempts)).at(-1);
      if (!c) return false;
      if (c.codeHash === codeHash) {
        c.consumedAt = at;
        return true;
      }
      c.attempts += 1;
      return false;
    },
    async consumeByToken(tokenHash, at) {
      const c = challenges.find((x) => x.tokenHash === tokenHash && open(x, at));
      if (!c) return null;
      c.consumedAt = at;
      return c.email;
    },
  };

  const store: AuthStore = {
    async ensureUserByEmail(email, role) {
      const existing = [...users.values()].find((u) => u.email === email);
      if (existing) return existing;
      seq += 1;
      const user: UserRecord = { id: `u-${seq}`, email, role, createdAt: now };
      users.set(user.id, user);
      return user;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async createSession(s) {
      sessions.set(s.tokenHash, s);
    },
    async findSessionUser(tokenHash, at) {
      const s = sessions.get(tokenHash);
      const u = s && s.expiresAt > at ? users.get(s.userId) : undefined;
      return u ? { id: u.id, email: u.email, role: u.role } : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };

  let codeSeq = 0;
  let tokenSeq = 0;
  const deps: AuthDeps = {
    store,
    codes,
    mailer: {
      async sendLoginCode(m) {
        sent.push(m);
      },
    },
    codeGenerator: { generate: () => String(123456 + codeSeq++) },
    clock: { now: () => now },
    tokens: { generate: () => `tok-${tokenSeq++}`, digest: (t) => `sha(${t})` },
    currentUser: { get: () => current },
    logger: {
      info: (fields, msg): void => void logs.push({ msg, fields }),
      warn: (fields, msg): void => void logs.push({ msg, fields }),
    },
    sessionTtlMs: SESSION_TTL_MS,
    policy: POLICY,
  };
  return {
    deps,
    challenges,
    users,
    sessions,
    sent,
    logs,
    setNow: (d): void => {
      now = d;
    },
    setUser: (u): void => {
      current = u;
    },
  };
}

const later = (ms: number): Date => new Date(T0.getTime() + ms);
const EMAIL = 'alice@test.local';

describe('@lch/auth-core — passwordless sign-in and sessions (ADR 0011)', () => {
  let f: ReturnType<typeof fakes>;
  let auth: AuthService;

  beforeEach(() => {
    f = fakes();
    auth = createAuthService(f.deps);
  });

  describe('requestCode', () => {
    it('stores only digests, emails the code and the link token, expiry = now + TTL', async () => {
      const { expiresAt } = await auth.requestCode(EMAIL);
      expect(expiresAt).toEqual(later(POLICY.ttlMs));
      expect(f.sent).toEqual([{ email: EMAIL, code: '123456', linkToken: 'tok-0', expiresAt }]);
      expect(f.challenges).toEqual([
        {
          email: EMAIL,
          codeHash: 'sha(123456)',
          tokenHash: 'sha(tok-0)',
          expiresAt,
          attempts: 0,
          consumedAt: null,
          createdAt: T0,
        },
      ]);
      expect(f.logs).toContainEqual({
        msg: 'sign-in code sent',
        fields: { codeExpiresAt: expiresAt.toISOString() },
      });
    });

    it('resend cooldown: TOO_MANY_REQUESTS with the seconds left, then allowed again', async () => {
      await auth.requestCode(EMAIL);
      f.setNow(later(POLICY.resendCooldownMs - 1_500));
      await expect(auth.requestCode(EMAIL)).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'A code was sent a moment ago',
        retryAfterSeconds: 2,
        name: 'AuthError',
      });
      f.setNow(later(POLICY.resendCooldownMs));
      await expect(auth.requestCode(EMAIL)).resolves.toBeDefined();
      expect(f.sent).toHaveLength(2);
    });

    it('the cooldown never answers Retry-After 0', async () => {
      await auth.requestCode(EMAIL);
      f.setNow(later(POLICY.resendCooldownMs - 1));
      await expect(auth.requestCode(EMAIL)).rejects.toMatchObject({ retryAfterSeconds: 1 });
    });

    it('hourly limit counts emails of the last hour; Retry-After = until the oldest leaves it', async () => {
      for (let i = 0; i < POLICY.maxPerHour; i += 1) {
        f.setNow(later(i * POLICY.resendCooldownMs));
        await auth.requestCode(EMAIL);
      }
      f.setNow(later(POLICY.maxPerHour * POLICY.resendCooldownMs));
      await expect(auth.requestCode(EMAIL)).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many codes for this email',
        retryAfterSeconds: (3_600_000 - POLICY.maxPerHour * POLICY.resendCooldownMs) / 1000,
      });
      // The window slides: an hour after the first email one more is allowed.
      f.setNow(later(3_600_000));
      await expect(auth.requestCode(EMAIL)).resolves.toBeDefined();
      // Other addresses are not affected.
      await expect(auth.requestCode('bob@test.local')).resolves.toBeDefined();
    });
  });

  describe('verifyCode / verifyLink', () => {
    it('the first sign-in creates the account (USER) and issues a session; only the digest is stored', async () => {
      await auth.requestCode(EMAIL);
      const session = await auth.verifyCode(EMAIL, '123456');
      expect(session.user).toMatchObject({ email: EMAIL, role: 'USER' });
      expect(session.expiresAt).toEqual(later(SESSION_TTL_MS));
      expect([...f.sessions.values()]).toEqual([
        {
          tokenHash: `sha(${session.token})`,
          userId: session.user.id,
          expiresAt: session.expiresAt,
        },
      ]);
      expect(f.logs).toContainEqual({
        msg: 'session created',
        fields: { loginUserId: session.user.id },
      });
      // The second sign-in reuses the same account.
      f.setNow(later(120_000));
      await auth.requestCode(EMAIL);
      expect((await auth.verifyCode(EMAIL, '123457')).user.id).toBe(session.user.id);
    });

    it('a code works once', async () => {
      await auth.requestCode(EMAIL);
      await auth.verifyCode(EMAIL, '123456');
      await expect(auth.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
        code: 'INVALID_CODE',
        message: 'The code is wrong or expired, request a new one',
        name: 'AuthError',
      });
    });

    it('wrong codes burn the challenge after maxAttempts — even the right code fails then', async () => {
      await auth.requestCode(EMAIL);
      for (let i = 0; i < POLICY.maxAttempts; i += 1) {
        await expect(auth.verifyCode(EMAIL, '000000')).rejects.toMatchObject({
          code: 'INVALID_CODE',
        });
      }
      await expect(auth.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
      expect(f.sessions.size).toBe(0);
    });

    it('an expired code is rejected', async () => {
      await auth.requestCode(EMAIL);
      f.setNow(later(POLICY.ttlMs));
      await expect(auth.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
    });

    it('a new code supersedes the previous one', async () => {
      await auth.requestCode(EMAIL);
      f.setNow(later(POLICY.resendCooldownMs));
      await auth.requestCode(EMAIL);
      await expect(auth.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
      await expect(auth.verifyCode(EMAIL, '123457')).resolves.toMatchObject({
        user: { email: EMAIL },
      });
    });

    it('verifyLink signs in by the emailed token once; unknown token → INVALID_CODE', async () => {
      await auth.requestCode(EMAIL);
      const [mail] = f.sent;
      const session = await auth.verifyLink(mail?.linkToken ?? '');
      expect(session.user.email).toBe(EMAIL);
      await expect(auth.verifyLink(mail?.linkToken ?? '')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
      await expect(auth.verifyLink('forged')).rejects.toMatchObject({ code: 'INVALID_CODE' });
    });
  });

  describe('sessions', () => {
    const signIn = async (): Promise<{ token: string; user: UserRecord }> => {
      await auth.requestCode(EMAIL);
      return auth.verifyCode(EMAIL, '123456');
    };

    it('authenticate resolves the digest at the injected time; unknown or expired → null', async () => {
      const { token } = await signIn();
      expect(await auth.authenticate(token)).toMatchObject({ email: EMAIL });
      expect(await auth.authenticate('nope')).toBeNull();
      f.setNow(later(SESSION_TTL_MS));
      expect(await auth.authenticate(token)).toBeNull();
    });

    it('me and logout need a current user (UNAUTHENTICATED, as a rejected promise)', async () => {
      await expect(auth.me()).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
      await expect(auth.logout('t')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('me of a deleted user → USER_NOT_FOUND; logout deletes exactly this session', async () => {
      const { token, user } = await signIn();
      f.setUser({ id: user.id, email: user.email, role: 'USER' });
      expect(await auth.me()).toMatchObject({ id: user.id });
      await auth.logout(token);
      expect(f.sessions.size).toBe(0);

      f.users.clear();
      await expect(auth.me()).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    });

    it('ensureAdmin is idempotent; the admin then signs in by code as ADMIN', async () => {
      await auth.ensureAdmin('admin@test.local');
      await auth.ensureAdmin('admin@test.local');
      expect([...f.users.values()]).toEqual([
        { id: 'u-1', email: 'admin@test.local', role: 'ADMIN', createdAt: T0 },
      ]);
      await auth.requestCode('admin@test.local');
      expect((await auth.verifyCode('admin@test.local', '123456')).user.role).toBe('ADMIN');
    });
  });
});
