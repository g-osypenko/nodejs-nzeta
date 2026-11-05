import type { AuthUser, UserRole } from '../../shared/context.js';
import type { SessionRow, UserRow } from '../../shared/db/rows.js';

export interface NewUser {
  email: string;
  passwordHash: string;
  role: UserRole;
}

/** Port of the auth module; implemented by *.memory.ts (prototype) and *.postgres.ts. */
export interface AuthRepository {
  /** @throws AppError EMAIL_TAKEN */
  createUser(user: NewUser): Promise<UserRow>;
  /** Inserts the user only if the email is free (idempotent bootstrap of the admin). */
  ensureUser(user: NewUser): Promise<void>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  createSession(session: SessionRow): Promise<void>;
  /** Returns the session owner if the session exists and is not expired at `now`. */
  findSessionUser(tokenHash: string, now: Date): Promise<AuthUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}
