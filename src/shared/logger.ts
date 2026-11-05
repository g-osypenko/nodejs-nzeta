import { pino, type Logger } from 'pino';
import { getContext } from './context.js';

/**
 * Single application logger. `mixin` runs on every log call and pulls
 * reqId / processId / userId from AsyncLocalStorage, so services and
 * repositories log with full correlation without receiving any parameters.
 */
export const logger: Logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  mixin() {
    const ctx = getContext();
    if (!ctx) return {};
    return { reqId: ctx.requestId, processId: ctx.processId, userId: ctx.user?.id };
  },
});
