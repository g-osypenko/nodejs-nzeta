import { randomUUID } from 'node:crypto';
import {
  createContext,
  runWithContext,
  type AuthUser,
  type RequestContext,
} from '../../src/shared/context.js';
import type { MemoryStore } from '../../src/shared/db/memory-store.js';
import type { LicenseRow, UserRow } from '../../src/shared/db/rows.js';
import { generateLicenseKey } from '../../src/shared/license-key.js';

export const DAY_MS = 86_400_000;

/** Runs `fn` inside a request context, optionally as a signed-in user. */
export function runAs<T>(user: AuthUser | null, fn: () => T, ctx?: RequestContext): T {
  const context = ctx ?? createContext();
  context.user = user;
  return runWithContext(context, fn);
}

export function seedUser(store: MemoryStore, patch: Partial<UserRow> = {}): UserRow {
  const row: UserRow = {
    id: randomUUID(),
    email: `user-${randomUUID()}@test.local`,
    passwordHash: 'scrypt$unused',
    role: 'USER',
    createdAt: new Date(),
    ...patch,
  };
  store.users.set(row.id, row);
  return row;
}

export function seedLicense(store: MemoryStore, patch: Partial<LicenseRow> = {}): LicenseRow {
  const row: LicenseRow = {
    id: randomUUID(),
    key: generateLicenseKey(),
    hwid: null,
    status: 'UNACTIVATED',
    userId: null,
    orderId: null,
    durationDays: 30,
    activatedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    ...patch,
  };
  store.licenses.set(row.id, row);
  return row;
}

export function asUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, role: row.role };
}
