import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCodeLoginService,
  type AuthStore,
  type CodeLoginDeps,
  type CodeLoginService,
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

/** Fakes with the same semantics the real stores promise (atomic consume, supersede on create). */
function fakes(): {
  deps: CodeLoginDeps;
  challenges: Challenge[];
  users: Map<string, UserRecord>;
  sessions: SessionRecord[];
  sent: Sent[];
  logs: { msg: string; fields: Record<string, unknown> }[];
  setNow: (d: Date) => void;
} {
  let now = T0;
  let seq = 0;
  const challenges: Challenge[] = [];
  const users = new Map<string, UserRecord>();
  const sessions: SessionRecord[] = [];
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
      for (const old of challenges)
        if (old.email === c.email && old.consumedAt === null) old.consumedAt = at;
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
    async ensureUserByEmail(email, role) {
      const existing = [...users.values()].find((u) => u.email === email);
      if (existing) return existing;
      seq += 1;
      const user: UserRecord = { id: `u-${seq}`, email, role, passwordHash: null, createdAt: now };
      users.set(user.id, user);
      return user;
    },
  };

  const unused = async (): Promise<never> => {
    throw new Error('not used by code sign-in');
  };
  const store: AuthStore = {
    createUser: unused,
    ensureUser: unused,
    findUserByEmail: unused,
    findUserById: unused,
    findSessionUser: unused,
    deleteSession: unused,
    async createSession(s) {
      sessions.push(s);
    },
  };

  let codeSeq = 0;
  let tokenSeq = 0;
  const deps: CodeLoginDeps = {
    users: store,
    codes,
    mailer: {
      async sendLoginCode(m) {
        sent.push(m);
      },
    },
    codeGenerator: { generate: () => String(123456 + codeSeq++) },
    clock: { now: () => now },
    tokens: { generate: () => `tok-${tokenSeq++}`, digest: (t) => `sha(${t})` },
    logger: {
      info: (fields, msg): void => void logs.push({ msg, fields }),
      warn: (fields, msg): void => void logs.push({ msg, fields }),
    },
    sessionTtlMs: 3_600_000,
    policy: POLICY,
    adminEmails: ['admin@test.local'],
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
  };
}

const later = (ms: number): Date => new Date(T0.getTime() + ms);
const EMAIL = 'alice@test.local';

describe('@lch/auth-core code sign-in (ADR 0011)', () => {
  let f: ReturnType<typeof fakes>;
  let login: CodeLoginService;

  beforeEach(() => {
    f = fakes();
    login = createCodeLoginService(f.deps);
  });

  it('requestCode stores only digests, emails the code and the link token, expiry = now + TTL', async () => {
    const { expiresAt } = await login.requestCode(EMAIL);
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

  it('verifyCode creates the account on first sign-in and issues a session (token digest stored)', async () => {
    await login.requestCode(EMAIL);
    const session = await login.verifyCode(EMAIL, '123456');
    expect(session.user).toMatchObject({ email: EMAIL, role: 'USER', passwordHash: null });
    expect(session.expiresAt).toEqual(later(3_600_000));
    expect(f.sessions).toEqual([
      { tokenHash: `sha(${session.token})`, userId: session.user.id, expiresAt: session.expiresAt },
    ]);
    expect(f.logs).toContainEqual({
      msg: 'session created by sign-in code',
      fields: { loginUserId: session.user.id },
    });
    // The second sign-in reuses the same account.
    f.setNow(later(120_000));
    await login.requestCode(EMAIL);
    expect((await login.verifyCode(EMAIL, '123457')).user.id).toBe(session.user.id);
  });

  it('ADMIN_EMAIL gets the ADMIN role when its account is created by a code', async () => {
    await login.requestCode('admin@test.local');
    expect((await login.verifyCode('admin@test.local', '123456')).user.role).toBe('ADMIN');
  });

  it('a code works once', async () => {
    await login.requestCode(EMAIL);
    await login.verifyCode(EMAIL, '123456');
    await expect(login.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
      code: 'INVALID_CODE',
      message: 'The code is wrong or expired, request a new one',
      name: 'AuthError',
    });
  });

  it('wrong codes burn the challenge after maxAttempts — even the right code fails then', async () => {
    await login.requestCode(EMAIL);
    for (let i = 0; i < POLICY.maxAttempts; i += 1) {
      await expect(login.verifyCode(EMAIL, '000000')).rejects.toMatchObject({
        code: 'INVALID_CODE',
      });
    }
    await expect(login.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    expect(f.sessions).toHaveLength(0);
  });

  it('an expired code is rejected', async () => {
    await login.requestCode(EMAIL);
    f.setNow(later(POLICY.ttlMs));
    await expect(login.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
  });

  it('a new code supersedes the previous one', async () => {
    await login.requestCode(EMAIL);
    f.setNow(later(POLICY.resendCooldownMs));
    await login.requestCode(EMAIL);
    await expect(login.verifyCode(EMAIL, '123456')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    await expect(login.verifyCode(EMAIL, '123457')).resolves.toMatchObject({
      user: { email: EMAIL },
    });
  });

  it('verifyLink signs in by the emailed token once; unknown token → INVALID_CODE', async () => {
    await login.requestCode(EMAIL);
    const [mail] = f.sent;
    const session = await login.verifyLink(mail?.linkToken ?? '');
    expect(session.user.email).toBe(EMAIL);
    await expect(login.verifyLink(mail?.linkToken ?? '')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    await expect(login.verifyLink('forged')).rejects.toMatchObject({ code: 'INVALID_CODE' });
  });

  it('resend cooldown: TOO_MANY_REQUESTS with the seconds left, then allowed again', async () => {
    await login.requestCode(EMAIL);
    f.setNow(later(POLICY.resendCooldownMs - 1_500));
    await expect(login.requestCode(EMAIL)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'A code was sent a moment ago',
      retryAfterSeconds: 2,
    });
    f.setNow(later(POLICY.resendCooldownMs));
    await expect(login.requestCode(EMAIL)).resolves.toBeDefined();
    expect(f.sent).toHaveLength(2);
  });

  it('the cooldown never answers Retry-After 0', async () => {
    await login.requestCode(EMAIL);
    f.setNow(later(POLICY.resendCooldownMs - 1));
    await expect(login.requestCode(EMAIL)).rejects.toMatchObject({ retryAfterSeconds: 1 });
  });

  it('hourly limit counts emails of the last hour; Retry-After = until the oldest leaves it', async () => {
    for (let i = 0; i < POLICY.maxPerHour; i += 1) {
      f.setNow(later(i * POLICY.resendCooldownMs));
      await login.requestCode(EMAIL);
    }
    f.setNow(later(POLICY.maxPerHour * POLICY.resendCooldownMs));
    await expect(login.requestCode(EMAIL)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many codes for this email',
      retryAfterSeconds: (3_600_000 - POLICY.maxPerHour * POLICY.resendCooldownMs) / 1000,
    });
    // The window slides: an hour after the first email one more is allowed.
    f.setNow(later(3_600_000));
    await expect(login.requestCode(EMAIL)).resolves.toBeDefined();
    // Other addresses are not affected.
    await expect(login.requestCode('bob@test.local')).resolves.toBeDefined();
  });
});
