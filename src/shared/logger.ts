import { pino, type DestinationStream, type Logger } from 'pino';
import { getContext } from './context.js';

/** Correlation fields of the current request (empty outside a request). Used as the pino mixin. */
export function contextFields(): Record<string, string | undefined> {
  const ctx = getContext();
  if (!ctx) return {};
  return { reqId: ctx.requestId, processId: ctx.processId, userId: ctx.user?.id };
}

/**
 * Errors of the `postgres` driver carry the bound values of the failed query (`parameters`,
 * `args`): emails, password hashes, license keys. pino's error serializer copies every own field,
 * so they would reach the log. The query text stays — it has placeholders only and helps debugging.
 * Wrapped errors (`new Error(msg, { cause })`) are covered one level deep.
 */
export const REDACT = {
  paths: ['err.parameters', 'err.args', 'err.cause.parameters', 'err.cause.args'],
  censor: '[redacted]',
};

/**
 * Builds a logger whose `mixin` pulls reqId / processId / userId from AsyncLocalStorage on every
 * call, so services and repositories log with full correlation without receiving any parameters.
 * `destination` exists for tests (default: stdout).
 */
export function createLogger(
  destination?: DestinationStream,
  level: string = process.env['LOG_LEVEL'] ?? 'info',
): Logger {
  const options = { level, mixin: contextFields, redact: REDACT };
  return destination ? pino(options, destination) : pino(options);
}

/** Single application logger. */
export const logger: Logger = createLogger();
