import { describe, expect, it } from 'vitest';
import {
  adoptProcessId,
  createContext,
  currentProcessId,
  getContext,
  requireRole,
  requireUser,
  runWithContext,
  setCurrentUser,
} from '../../../src/shared/context.js';
import { AppError, notFound, type ErrorCode } from '../../../src/shared/errors.js';
import { contextFields } from '../../../src/shared/logger.js';

const USER = { id: 'u-1', email: 'u@test.local', role: 'USER' as const };
const ADMIN = { id: 'a-1', email: 'a@test.local', role: 'ADMIN' as const };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function codeOf(fn: () => unknown): ErrorCode | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.code : null;
  }
}

describe('AppError', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['INVALID_CREDENTIALS', 401],
    ['INVALID_WEBHOOK_SECRET', 401],
    ['FORBIDDEN', 403],
    ['KEY_BANNED', 403],
    ['KEY_EXPIRED', 403],
    ['HWID_MISMATCH', 403],
    ['NOT_FOUND', 404],
    ['KEY_NOT_FOUND', 404],
    ['ROUTE_NOT_FOUND', 404],
    ['EMAIL_TAKEN', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['ORDER_NOT_PAYABLE', 409],
    ['DB_UNAVAILABLE', 503],
    ['INTERNAL', 500],
  ] as const)('%s maps to HTTP %i (spec §3)', (code, status) => {
    const error = new AppError(code, 'msg', { extra: 1 });
    expect(error.statusCode).toBe(status);
    expect(error).toMatchObject({ code, message: 'msg', details: { extra: 1 }, name: 'AppError' });
  });

  it('notFound() builds a NOT_FOUND with the resource name', () => {
    expect(notFound('Order')).toMatchObject({ code: 'NOT_FOUND', message: 'Order not found' });
    expect(notFound('Order').details).toBeUndefined();
  });
});

describe('request context (AsyncLocalStorage)', () => {
  it('createContext generates ids unless given, starts anonymous with 0 queries', () => {
    const ctx = createContext();
    expect(ctx.requestId).toMatch(UUID);
    expect(ctx.processId).toMatch(UUID);
    expect(ctx.requestId).not.toBe(ctx.processId);
    expect(ctx).toMatchObject({ user: null, dbQueries: 0 });
    expect(createContext({ requestId: 'r', processId: 'p' })).toMatchObject({
      requestId: 'r',
      processId: 'p',
    });
  });

  it('context is visible across awaits inside run and absent outside', async () => {
    const ctx = createContext({ requestId: 'r-1' });
    const seen = await runWithContext(ctx, async () => {
      await new Promise((r) => setImmediate(r));
      return getContext()?.requestId;
    });
    expect(seen).toBe('r-1');
    expect(getContext()).toBeUndefined();
  });

  it('requireUser: UNAUTHENTICATED outside a request and for anonymous; user inside', () => {
    expect(codeOf(() => requireUser())).toBe('UNAUTHENTICATED');
    runWithContext(createContext(), () => {
      expect(codeOf(() => requireUser())).toBe('UNAUTHENTICATED');
      setCurrentUser(USER);
      expect(requireUser()).toEqual(USER);
    });
  });

  it('requireRole: FORBIDDEN for a USER, passes for ADMIN, UNAUTHENTICATED for anonymous', () => {
    runWithContext(createContext(), () => {
      expect(codeOf(() => requireRole('ADMIN'))).toBe('UNAUTHENTICATED');
      setCurrentUser(USER);
      expect(codeOf(() => requireRole('ADMIN'))).toBe('FORBIDDEN');
      setCurrentUser(ADMIN);
      expect(requireRole('ADMIN')).toEqual(ADMIN);
    });
  });

  it('adoptProcessId joins the current request to an existing business process', () => {
    const ctx = createContext({ processId: 'p-own' });
    runWithContext(ctx, () => {
      expect(currentProcessId()).toBe('p-own');
      adoptProcessId('p-checkout');
      expect(currentProcessId()).toBe('p-checkout');
    });
    expect(ctx.processId).toBe('p-checkout');
  });

  it('setters are no-ops outside a request; currentProcessId falls back to a fresh uuid', () => {
    setCurrentUser(USER);
    adoptProcessId('ignored');
    expect(getContext()).toBeUndefined();
    const a = currentProcessId();
    expect(a).toMatch(UUID);
    expect(currentProcessId()).not.toBe(a);
  });
});

describe('logger correlation fields (pino mixin)', () => {
  it('empty outside a request', () => {
    expect(contextFields()).toEqual({});
  });

  it('reqId + processId for anonymous, plus userId once authenticated', () => {
    runWithContext(createContext({ requestId: 'r', processId: 'p' }), () => {
      expect(contextFields()).toEqual({ reqId: 'r', processId: 'p', userId: undefined });
      setCurrentUser(USER);
      expect(contextFields()).toEqual({ reqId: 'r', processId: 'p', userId: 'u-1' });
    });
  });
});
