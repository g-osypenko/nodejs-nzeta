import { pino, type DestinationStream, type Logger } from 'pino';
import { getContext } from './context.js';

/** Correlation fields of the current request (empty outside a request). Used as the pino mixin. */
export function contextFields(): Record<string, string | undefined> {
  const ctx = getContext();
  if (!ctx) return {};
  return { reqId: ctx.requestId, processId: ctx.processId, userId: ctx.user?.id };
}

/**
 * Builds a logger whose `mixin` pulls reqId / processId / userId from AsyncLocalStorage on every
 * call, so services and repositories log with full correlation without receiving any parameters.
 * `destination` exists for tests (default: stdout).
 */
export function createLogger(
  destination?: DestinationStream,
  level: string = process.env['LOG_LEVEL'] ?? 'info',
): Logger {
  const options = { level, mixin: contextFields };
  return destination ? pino(options, destination) : pino(options);
}

/** Single application logger. */
export const logger: Logger = createLogger();
