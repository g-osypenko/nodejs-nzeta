/** Domain error codes and their HTTP mapping (spec.md §3). */
const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CODE: 401,
  INVALID_WEBHOOK_SECRET: 401,
  FORBIDDEN: 403,
  KEY_BANNED: 403,
  KEY_EXPIRED: 403,
  HWID_MISMATCH: 403,
  NOT_FOUND: 404,
  KEY_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  ORDER_NOT_PAYABLE: 409,
  TOO_MANY_REQUESTS: 429,
  DB_UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;
  /** Sent as Retry-After (429); `null` = the handler's default for the status, if any. */
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ErrorCode,
    message: string,
    details?: unknown,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `${what} not found`);
}
