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
  passwordHash: string;
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
  'INVALID_CREDENTIALS' | 'UNAUTHENTICATED' | 'USER_NOT_FOUND' | 'AUTH_BUSY';

/** The only error type the package throws itself; the host maps codes to its transport. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
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
  login(input: Credentials): Promise<{ token: string; expiresAt: Date }>;
  logout(token: string): Promise<void>;
  me(): Promise<UserRecord>;
  /** Resolves a token to a user; `null` for unknown or expired tokens. */
  authenticate(token: string): Promise<AuthUser | null>;
  ensureAdmin(email: string, password: string): Promise<void>;
}
