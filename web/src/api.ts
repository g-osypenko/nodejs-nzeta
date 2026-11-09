/**
 * Typed client of the License & Config Hub HTTP API (spec.md §1, prefix /api/v1).
 * Same origin as the page (ADR 0008): relative URLs, no CORS.
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

export interface Session {
  token: string;
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
}

function isErrorBody(
  value: unknown,
): value is { error: { code: string; message: string }; requestId?: string } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error: unknown = value.error;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorBody(data)) {
      throw new ApiError(res.status, data.error.code, data.error.message, data.requestId ?? null);
    }
    throw new ApiError(res.status, 'INTERNAL', `HTTP ${res.status}`, null);
  }
  return data as T;
}

export const api = {
  plans: (): Promise<Plan[]> => request('/plans'),
  register: (email: string, password: string): Promise<User> =>
    request('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string): Promise<Session> =>
    request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: (token: string): Promise<void> => request('/auth/logout', { method: 'POST', token }),
  me: (token: string): Promise<User> => request('/auth/me', { token }),
  createOrder: (token: string, planId: string, idempotencyKey: string): Promise<Order> =>
    request('/orders', {
      method: 'POST',
      token,
      body: { planId },
      headers: { 'idempotency-key': idempotencyKey },
    }),
  order: (token: string, id: string): Promise<Order> => request(`/orders/${id}`, { token }),
  licenses: (token: string): Promise<License[]> => request('/licenses', { token }),
};

/** Message for the user: Ukrainian text for known codes, the server message otherwise. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Немає зв’язку із сервером. Спробуйте ще раз.';
  const known: Record<string, string> = {
    INVALID_CREDENTIALS: 'Невірний email або пароль.',
    EMAIL_TAKEN: 'Цей email уже зареєстровано.',
    VALIDATION_ERROR: 'Перевірте поля: email і пароль щонайменше 8 символів.',
    UNAUTHENTICATED: 'Сесія завершилась — увійдіть знову.',
    DB_UNAVAILABLE: 'Сервіс тимчасово недоступний. Спробуйте за хвилину.',
    NOT_FOUND: 'Не знайдено.',
  };
  return known[error.code] ?? error.message;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function formatDate(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleDateString('uk-UA');
}
