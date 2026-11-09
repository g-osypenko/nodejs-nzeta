import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';

export type UserRole = 'USER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Per-request context. Lives in AsyncLocalStorage, so any layer (route, service,
 * repository, logger) can read it without passing parameters (ADR 0005).
 */
export interface RequestContext {
  requestId: string;
  /** Business-process ID: shared by all requests of one business flow (e.g. checkout → webhook). */
  processId: string;
  user: AuthUser | null;
  /** Number of SQL queries sent during this request (N+1 detector, spec.md §4.8). */
  dbQueries: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createContext(
  init: { requestId?: string; processId?: string } = {},
): RequestContext {
  return {
    requestId: init.requestId ?? randomUUID(),
    processId: init.processId ?? randomUUID(),
    user: null,
    dbQueries: 0,
  };
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setCurrentUser(user: AuthUser): void {
  const ctx = storage.getStore();
  if (ctx) ctx.user = user;
}

/** Joins the current request to an existing business process (e.g. webhook adopts the order's process). */
export function adoptProcessId(processId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.processId = processId;
}

export function currentProcessId(): string {
  return storage.getStore()?.processId ?? randomUUID();
}

export function requireUser(): AuthUser {
  const user = storage.getStore()?.user ?? null;
  if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return user;
}

export function requireRole(role: UserRole): AuthUser {
  const user = requireUser();
  if (user.role !== role) throw new AppError('FORBIDDEN', `Role ${role} required`);
  return user;
}
