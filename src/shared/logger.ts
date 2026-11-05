import { pino, type Logger } from 'pino';
import { getContext } from './context.js';

/** Correlation fields of the current request (empty outside a request). Used as the pino mixin. */
export function contextFields(): Record<string, string | undefined> {
  const ctx = getContext();
  if (!ctx) return {};
  return { reqId: ctx.requestId, processId: ctx.processId, userId: ctx.user?.id };
}

/**
 * Single application logger. `mixin` runs on every log call and pulls
 * reqId / processId / userId from AsyncLocalStorage, so services and
 * repositories log with full correlation without receiving any parameters.
 */
export const logger: Logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  mixin: contextFields,
});
