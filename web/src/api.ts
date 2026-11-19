/**
 * Typed client of the License & Config Hub HTTP API (spec.md §1, prefix /api/v1).
 * Same origin as the page (ADR 0008): relative URLs, no CORS. The session is an httpOnly cookie
 * the browser sends by itself (ADR 0011) — this code never sees a token.
 * Mutations carry `Origin` (browsers add it to every POST), which the server's CSRF guard checks.
 * Errors always have the shape of spec.md §3: { error: { code, message }, requestId, processId }.
 */

export interface Plan {
  id: string;
  name: string;
  durationDays: number;
  priceCents: number;
}

export interface User {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
}

export interface SignedIn {
  user: User;
  expiresAt: string;
}

export interface Order {
  id: string;
  planId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  amountCents: number;
  processId: string;
  createdAt: string;
  paidAt: string | null;
  licenseKey: string | null;
}

export interface License {
  id: string;
  key: string;
  status: 'UNACTIVATED' | 'ACTIVE' | 'BANNED' | 'EXPIRED';
  hwid: string | null;
  durationDays: number;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ConfigSummary {
  name: string;
  updatedAt: string;
}

export interface Config extends ConfigSummary {
  payload: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    /** Field-level problems of a 400 VALIDATION_ERROR: [{ path, message }]. */
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

function isErrorBody(
  value: unknown,
): value is { error: { code: string; message: string; details?: unknown }; requestId?: string } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorBody(data)) {
      const details = Array.isArray(data.error.details)
        ? (data.error.details as { path: string; message: string }[])
        : [];
      throw new ApiError(
        res.status,
        data.error.code,
        data.error.message,
        data.requestId ?? null,
        details,
      );
    }
    throw new ApiError(res.status, 'INTERNAL', `HTTP ${res.status}`, null);
  }
  return data as T;
}

export const api = {
  plans: (): Promise<Plan[]> => request('/plans'),
  /** Emails a 6-digit code and a sign-in link; the account is created on the first sign-in. */
  requestCode: (email: string): Promise<{ expiresAt: string }> =>
    request('/auth/code', { method: 'POST', body: { email } }),
  verifyCode: (email: string, code: string): Promise<SignedIn> =>
    request('/auth/code/verify', { method: 'POST', body: { email, code } }),
  verifyLink: (token: string): Promise<SignedIn> =>
    request('/auth/link/verify', { method: 'POST', body: { token } }),
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),
  me: (): Promise<User> => request('/auth/me'),
  createOrder: (planId: string, idempotencyKey: string): Promise<Order> =>
    request('/orders', {
      method: 'POST',
      body: { planId },
      headers: { 'idempotency-key': idempotencyKey },
    }),
  order: (id: string): Promise<Order> => request(`/orders/${id}`),
  licenses: (): Promise<License[]> => request('/licenses'),
  configs: (): Promise<ConfigSummary[]> => request('/configs'),
  config: (name: string): Promise<Config> => request(`/configs/${encodeURIComponent(name)}`),
  saveConfig: (name: string, payload: unknown): Promise<Config> =>
    request(`/configs/${encodeURIComponent(name)}`, { method: 'PUT', body: { payload } }),
  deleteConfig: (name: string): Promise<void> =>
    request(`/configs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};

/** Message for the user in the current language (i18n `t.errors`); the server message otherwise. */
export function describeError(error: unknown, messages: Record<string, string>): string {
  if (!(error instanceof ApiError)) return messages['offline'] ?? 'Network error';
  return messages[error.code] ?? error.message;
}
