/**
 * Public contract of @lch/auth-core: domain types, ports (what the host application must provide)
 * and the service interface. The package knows no implementation: no database driver, no HTTP
 * framework, no crypto primitive — every resource comes in through `AuthDeps` (spec.md §9.4).
 *
 * Sign-in is passwordless (ADR 0011): an emailed 6-digit code or a one-click link opens a session.
 */

export type UserRole = 'USER' | 'ADMIN';

/** The authenticated principal, as resolved from a session. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface UserRecord extends AuthUser {
  createdAt: Date;
}

export interface SessionRecord {
  /** Digest of the session token; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

/** One emailed sign-in attempt: a 6-digit code and a link token, stored as digests. */
export interface NewLoginChallenge {
  email: string;
  codeHash: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Challenges of one email created inside a time window — input of the send limits. */
export interface RecentChallenges {
  count: number;
  oldestAt: Date | null;
  newestAt: Date | null;
}

/** Issued session: the opaque token goes to the client once, only its digest is stored. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: UserRecord;
}

// --- ports -----------------------------------------------------------------------------------

/** Persistence of users and sessions (Postgres, in-memory, …) — owned by the host. */
export interface AuthStore {
  /** The user with this email, created with `role` if there is none yet (an existing one is kept as is). */
  ensureUserByEmail(email: string, role: UserRole): Promise<UserRecord>;
  findUserById(id: string): Promise<UserRecord | null>;
  createSession(session: SessionRecord): Promise<void>;
  /** The session owner if the session exists and is not expired at `now`. */
  findSessionUser(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

/** Persistence of sign-in challenges; every check-and-write below must be atomic. */
export interface LoginCodeStore {
  /** Challenges created for `email` strictly after `since`, whatever their state. */
  recentChallenges(email: string, since: Date): Promise<RecentChallenges>;
  /** Closes every open challenge of the email and stores the new one — only the last email works. */
  createChallenge(challenge: NewLoginChallenge, now: Date): Promise<void>;
  /**
   * The newest open challenge of the email (not consumed, not expired, attempts < maxAttempts):
   * consumed when `codeHash` matches, otherwise its attempt counter grows by one.
   * Returns whether the code matched.
   */
  consumeByCode(email: string, codeHash: string, now: Date, maxAttempts: number): Promise<boolean>;
  /** Consumes the open challenge with this link token; returns its email, or `null`. */
  consumeByToken(tokenHash: string, now: Date): Promise<string | null>;
}

/** Delivery of the sign-in email (console in development, Brevo later) — owned by the host. */
export interface Mailer {
  sendLoginCode(message: {
    email: string;
    code: string;
    linkToken: string;
    expiresAt: Date;
  }): Promise<void>;
}

/** Random 6-digit codes (crypto.randomInt in the host). */
export interface CodeGenerator {
  generate(): string;
}

export interface Clock {
  now(): Date;
}

/** Opaque tokens (sessions, sign-in links): generation and the one-way digest that is stored instead. */
export interface SessionTokens {
  generate(): string;
  digest(token: string): string;
}

/** Who is making the current call (request context of the host, e.g. AsyncLocalStorage). */
export interface CurrentUser {
  get(): AuthUser | null;
}

export interface AuthLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

// --- errors ----------------------------------------------------------------------------------

export type AuthErrorCode =
  'UNAUTHENTICATED' | 'USER_NOT_FOUND' | 'INVALID_CODE' | 'TOO_MANY_REQUESTS';

/** The only error type the package throws itself; the host maps codes to its transport. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    /** When the call may be repeated (TOO_MANY_REQUESTS); `null` when that is not known. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// --- service ---------------------------------------------------------------------------------

export interface LoginCodePolicy {
  /** Lifetime of a code and its link. */
  ttlMs: number;
  /** Wrong codes accepted per challenge before it is burnt. */
  maxAttempts: number;
  /** Minimum pause between two emails to the same address. */
  resendCooldownMs: number;
  /** Emails per address per hour. */
  maxPerHour: number;
}

export interface AuthDeps {
  store: AuthStore;
  codes: LoginCodeStore;
  mailer: Mailer;
  codeGenerator: CodeGenerator;
  clock: Clock;
  tokens: SessionTokens;
  currentUser: CurrentUser;
  logger: AuthLogger;
  sessionTtlMs: number;
  policy: LoginCodePolicy;
}

export interface AuthService {
  /** Creates a challenge and emails it; the same answer whether or not the account exists. */
  requestCode(email: string): Promise<{ expiresAt: Date }>;
  /** Opens a session; the first sign-in of an email creates its account (role USER). */
  verifyCode(email: string, code: string): Promise<IssuedSession>;
  verifyLink(token: string): Promise<IssuedSession>;
  logout(token: string): Promise<void>;
  me(): Promise<UserRecord>;
  /** Resolves a session token to a user; `null` for unknown or expired tokens. */
  authenticate(token: string): Promise<AuthUser | null>;
  /** Bootstrap: the account of this email exists with role ADMIN (an existing account is kept). */
  ensureAdmin(email: string): Promise<void>;
}
