import { beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthService,
  type AuthDeps,
  type AuthService,
  type AuthUser,
  type AuthStore,
  type SessionRecord,
  type UserRecord,
} from '../src/index.js';

/** Fakes of every port: the package is tested without a database, crypto or a web framework. */
function fakes(): {
  deps: AuthDeps;
  users: Map<string, UserRecord>;
  sessions: Map<string, SessionRecord>;
  setUser: (u: AuthUser | null) => void;
  logs: string[];
  fields: Record<string, unknown>[];
} {
  const users = new Map<string, UserRecord>();
  const sessions = new Map<string, SessionRecord>();
  let current: AuthUser | null = null;
  let seq = 0;
  const logs: string[] = [];
  const fields: Record<string, unknown>[] = [];
  const store: AuthStore = {
    async createUser(u) {
      if ([...users.values()].some((x) => x.email === u.email)) throw new Error('EMAIL_TAKEN');
      seq += 1;
      const row: UserRecord = { ...u, id: `u-${seq}`, createdAt: new Date(0) };
      users.set(row.id, row);
      return row;
    },
    async ensureUser(u) {
      if (![...users.values()].some((x) => x.email === u.email)) await store.createUser(u);
    },
    async findUserByEmail(email) {
      return [...users.values()].find((x) => x.email === email) ?? null;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async createSession(s) {
      sessions.set(s.tokenHash, s);
    },
    async findSessionUser(tokenHash, now) {
      const s = sessions.get(tokenHash);
      const u = s && s.expiresAt > now ? users.get(s.userId) : undefined;
      return u ? { id: u.id, email: u.email, role: u.role } : null;
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
  const deps: AuthDeps = {
    store,
    hasher: {
      hash: async (p) => `kdf(${p})`,
      verify: async (p, encoded) => encoded === `kdf(${p})`,
    },
    clock: { now: () => new Date('2026-11-09T12:00:00.000Z') },
    tokens: { generate: () => `token-${seq}`, digest: (t) => `digest(${t})` },
    currentUser: { get: () => current },
    logger: {
      info: (f, msg): void => {
        logs.push(msg);
        fields.push(f);
      },
      warn: (f, msg): void => {
        logs.push(msg);
        fields.push(f);
      },
    },
    sessionTtlMs: 2 * 3_600_000,
  };
  return { deps, users, sessions, setUser: (u) => (current = u), logs, fields };
}

const creds = { email: 'alice@test.local', password: 'alice-password' };

describe('@lch/auth-core service', () => {
  let f: ReturnType<typeof fakes>;
  let auth: AuthService;

  beforeEach(() => {
    f = fakes();
    auth = createAuthService(f.deps);
  });

  it('register stores the KDF output, never the plain password', async () => {
    const user = await auth.register(creds);
    expect(user).toMatchObject({
      email: creds.email,
      role: 'USER',
      passwordHash: 'kdf(alice-password)',
    });
    expect(f.logs).toContain('user registered');
    expect(f.fields).toContainEqual({ newUserId: user.id });
  });

  it('login: token is returned, only its digest is stored; expiry = injected clock + TTL', async () => {
    const user = await auth.register(creds);
    const { token, expiresAt } = await auth.login(creds);
    const [session] = [...f.sessions.values()];
    expect(session).toEqual({
      tokenHash: `digest(${token})`,
      userId: user.id,
      expiresAt: new Date('2026-11-09T14:00:00.000Z'),
    });
    expect(expiresAt).toEqual(session?.expiresAt);
    expect(f.logs).toContain('session created');
    expect(f.fields).toContainEqual({ loginUserId: user.id });
  });

  it('unknown email and wrong password give the same INVALID_CREDENTIALS', async () => {
    await auth.register(creds);
    // The message reaches the API client (host maps AuthError → AppError keeping it): contract.
    await expect(auth.login({ ...creds, password: 'wrong-password' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      name: 'AuthError',
    });
    await expect(auth.login({ ...creds, email: 'bob@test.local' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(f.sessions.size).toBe(0);
  });

  it('authenticate resolves the digest at the injected time; unknown token → null', async () => {
    await auth.register(creds);
    const { token } = await auth.login(creds);
    expect(await auth.authenticate(token)).toMatchObject({ email: creds.email });
    expect(await auth.authenticate('nope')).toBeNull();
  });

  it('me and logout need a current user (UNAUTHENTICATED, as a rejected promise)', async () => {
    const me = auth.me();
    await expect(me).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    await expect(auth.logout('t')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('me of a deleted user → USER_NOT_FOUND; logout deletes exactly this session', async () => {
    const user = await auth.register(creds);
    const { token } = await auth.login(creds);
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

  it('ensureAdmin is idempotent and stores an ADMIN with a KDF hash', async () => {
    await auth.ensureAdmin('admin@test.local', 'admin-password');
    await auth.ensureAdmin('admin@test.local', 'admin-password');
    const admins = [...f.users.values()].filter((u) => u.role === 'ADMIN');
    expect(admins).toHaveLength(1);
    expect(admins[0]?.passwordHash).toBe('kdf(admin-password)');
  });
});
