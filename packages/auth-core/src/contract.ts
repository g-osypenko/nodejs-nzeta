/**
 * Public contract of @lch/auth-core: domain types, ports (what the host application must provide)
 * and the service interface. The package knows no implementation: no database driver, no HTTP
 * framework, no crypto primitive — every resource comes in through `AuthDeps` (spec.md §9.4).
 */

export type UserRole = 'USER' | 'ADMIN';

/** The authenticated principal, as resolved from a session. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface UserRecord extends AuthUser {
  /** `null` for users created by a sign-in code (ADR 0011): they have no password at all. */
  passwordHash: string | null;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface SessionRecord {
  /** Digest of the session token; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface Credentials {
  email: string;
  password: string;
}

/** One emailed sign-in attempt (ADR 0011): a 6-digit code and a link token, stored as digests. */
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
  /** Must reject when the email is taken (the host decides the error type). */
  createUser(user: NewUser): Promise<UserRecord>;
  /** Inserts the user only if the email is free (idempotent bootstrap of the admin). */
  ensureUser(user: NewUser): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
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
  /** The user with this email, created with `role` and no password if there is none yet. */
  ensureUserByEmail(email: string, role: UserRole): Promise<UserRecord>;
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

/** Key-derivation function for passwords (scrypt, argon2, …): self-describing encoded hashes. */
export interface PasswordKdf {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

/** Opaque session tokens: generation and the one-way digest that is stored instead. */
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
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'AUTH_BUSY'
  | 'INVALID_CODE'
  | 'TOO_MANY_REQUESTS';

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

// --- password hashing with admission control -------------------------------------------------

export interface HashingLimits {
  /** KDF calls running at the same time (each one occupies a CPU core for its duration). */
  maxConcurrent: number;
  /** Calls allowed to wait for a slot; beyond that a call fails fast with AUTH_BUSY. */
  maxQueued: number;
}

export interface HasherStats {
  running: number;
  queued: number;
  rejected: number;
}

export interface PasswordHasher extends PasswordKdf {
  stats(): HasherStats;
}

// --- service ---------------------------------------------------------------------------------

export interface AuthDeps {
  store: AuthStore;
  hasher: PasswordKdf;
  clock: Clock;
  tokens: SessionTokens;
  currentUser: CurrentUser;
  logger: AuthLogger;
  sessionTtlMs: number;
}

export interface AuthService {
  register(input: Credentials): Promise<UserRecord>;
  /** Password sign-in (kept next to codes until passwords are dropped, ADR 0011). */
  login(input: Credentials): Promise<{ token: string; expiresAt: Date }>;
  logout(token: string): Promise<void>;
  me(): Promise<UserRecord>;
  /** Resolves a token to a user; `null` for unknown or expired tokens. */
  authenticate(token: string): Promise<AuthUser | null>;
  ensureAdmin(email: string, password: string): Promise<void>;
}

// --- passwordless sign-in (ADR 0011) ---------------------------------------------------------

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

export interface CodeLoginDeps {
  users: AuthStore;
  codes: LoginCodeStore;
  mailer: Mailer;
  codeGenerator: CodeGenerator;
  clock: Clock;
  tokens: SessionTokens;
  logger: AuthLogger;
  sessionTtlMs: number;
  policy: LoginCodePolicy;
  /** Emails that get the ADMIN role when their account is created by a code. */
  adminEmails: readonly string[];
}

export interface CodeLoginService {
  /** Creates a challenge and emails it; the same answer whether or not the account exists. */
  requestCode(email: string): Promise<{ expiresAt: Date }>;
  verifyCode(email: string, code: string): Promise<IssuedSession>;
  verifyLink(token: string): Promise<IssuedSession>;
}
