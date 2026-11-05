/** Classification of database failures (spec.md §4.7). */

// postgres.js connection errors + Node socket errors.
const CONNECTION_CODES = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

// SQLSTATE: 57P01 admin_shutdown, 57P03 cannot_connect_now, 53300 too_many_connections.
const SERVER_UNAVAILABLE = new Set(['57P01', '57P02', '57P03', '53300']);

// SQLSTATE: 40001 serialization_failure, 40P01 deadlock_detected — safe to retry the whole transaction.
const RETRYABLE_TX = new Set(['40001', '40P01']);

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** The database cannot serve requests right now → HTTP 503. */
export function isDbUnavailable(error: unknown): boolean {
  const code = codeOf(error);
  if (code === undefined) return false;
  return (
    CONNECTION_CODES.has(code) ||
    SERVER_UNAVAILABLE.has(code) ||
    code.startsWith('08') || // connection_exception class
    code === '57014' // query_canceled by statement_timeout
  );
}

/** Worth retrying: transient conflict or a dropped connection (statement timeouts are NOT retried). */
export function isTransientDbError(error: unknown): boolean {
  const code = codeOf(error);
  if (code === undefined || code === '57014') return false;
  return RETRYABLE_TX.has(code) || isDbUnavailable(error);
}
