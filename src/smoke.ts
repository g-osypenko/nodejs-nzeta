/**
 * End-to-end smoke scenario over HTTP (app.inject): every scenario from spec.md §1.
 *   npm run smoke      → DATA_SOURCE=memory (static prototype, used by the pre-push hook)
 *   npm run smoke:db   → DATA_SOURCE=postgres (needs `npm run db:up && npm run db:migrate`)
 * The same script must pass on both data sources (spec.md §4.1).
 */
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp, type App } from './app.js';
import { createContainer } from './container.js';
import { loadConfig } from './shared/config.js';
import { logger } from './shared/logger.js';

dotenv.config({ quiet: true });
logger.level = process.env['LOG_LEVEL'] ?? 'warn';

const useDb = process.argv.includes('--db');
const config = loadConfig({
  ...process.env,
  DATA_SOURCE: useDb ? 'postgres' : 'memory',
  WEBHOOK_SECRET: process.env['WEBHOOK_SECRET'] ?? 'smoke-webhook-secret-0001',
  ADMIN_EMAIL: process.env['ADMIN_EMAIL'] ?? 'admin@lch.local',
  ADMIN_PASSWORD: process.env['ADMIN_PASSWORD'] ?? 'admin-password-01',
});

let passed = 0;
function check(condition: boolean, label: string, res?: LightMyRequestResponse): void {
  if (!condition) {
    const detail = res ? ` → ${res.statusCode} ${res.body}` : '';
    throw new Error(`✖ ${label}${detail}`);
  }
  passed += 1;
  process.stdout.write(`  ✔ ${label}\n`);
}

type Json = Record<string, unknown>;
const json = (res: LightMyRequestResponse): Json => res.json<Json>();
const errorCode = (res: LightMyRequestResponse): unknown =>
  (json(res)['error'] as Json | undefined)?.['code'];

async function scenario(app: App): Promise<void> {
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method,
      url,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { payload: opts.body as Json }),
    });

  process.stdout.write('system\n');
  check((await call('GET', '/version')).statusCode === 200, 'GET /version');
  check((await call('GET', '/health')).statusCode === 200, 'GET /health');
  check(
    errorCode(await call('GET', '/api/v1/nope')) === 'ROUTE_NOT_FOUND',
    'unknown route → 404 ROUTE_NOT_FOUND',
  );

  process.stdout.write('auth\n');
  const email = `smoke+${Date.now()}@lch.local`;
  const password = 'smoke-password-1';
  let res = await call('POST', '/api/v1/auth/register', { body: { email, password } });
  check(res.statusCode === 201, 'register → 201', res);
  res = await call('POST', '/api/v1/auth/register', { body: { email, password } });
  check(errorCode(res) === 'EMAIL_TAKEN', 'register same email → 409 EMAIL_TAKEN', res);
  res = await call('POST', '/api/v1/auth/register', { body: { email: 'not-an-email', password } });
  check(
    errorCode(res) === 'VALIDATION_ERROR',
    'register invalid email → 400 VALIDATION_ERROR',
    res,
  );
  res = await call('POST', '/api/v1/auth/login', { body: { email, password: 'wrong-password' } });
  check(errorCode(res) === 'INVALID_CREDENTIALS', 'login wrong password → 401', res);
  res = await call('POST', '/api/v1/auth/login', { body: { email, password } });
  check(res.statusCode === 200, 'login → 200', res);
  const token = String(json(res)['token']);
  check(
    (await call('GET', '/api/v1/auth/me', { token })).statusCode === 200,
    'GET /auth/me with token',
  );
  check(
    errorCode(await call('GET', '/api/v1/auth/me')) === 'UNAUTHENTICATED',
    'GET /auth/me without token → 401',
  );

  process.stdout.write('licenses: checkout\n');
  res = await call('GET', '/api/v1/plans');
  check(res.statusCode === 200 && res.json<unknown[]>().length === 3, 'GET /plans → 3 plans', res);
  res = await call('POST', '/api/v1/orders', { token, body: { planId: 'monthly' } });
  check(errorCode(res) === 'VALIDATION_ERROR', 'order without Idempotency-Key → 400', res);
  const idem = { 'idempotency-key': randomUUID() };
  res = await call('POST', '/api/v1/orders', { token, body: { planId: 'monthly' }, headers: idem });
  check(
    res.statusCode === 201 && json(res)['status'] === 'PENDING',
    'create order → 201 PENDING',
    res,
  );
  const orderId = String(json(res)['id']);
  const processId = String(json(res)['processId']);
  check(res.headers['x-process-id'] === processId, 'response carries business-process id');
  res = await call('POST', '/api/v1/orders', { token, body: { planId: 'monthly' }, headers: idem });
  check(
    res.statusCode === 200 && json(res)['id'] === orderId,
    'replay same key → 200 same order',
    res,
  );
  res = await call('POST', '/api/v1/orders', { token, body: { planId: 'yearly' }, headers: idem });
  check(errorCode(res) === 'IDEMPOTENCY_CONFLICT', 'same key, other plan → 409', res);

  const secret = { 'x-webhook-secret': config.webhookSecret };
  const event = { eventId: `evt_${randomUUID()}`, orderId, result: 'SUCCEEDED' };
  res = await call('POST', '/api/v1/payments/webhook', {
    body: event,
    headers: { 'x-webhook-secret': 'x' },
  });
  check(errorCode(res) === 'INVALID_WEBHOOK_SECRET', 'webhook wrong secret → 401', res);
  res = await call('POST', '/api/v1/payments/webhook', { body: event, headers: secret });
  check(json(res)['outcome'] === 'PAID', 'webhook → PAID', res);
  check(res.headers['x-process-id'] === processId, 'webhook joined the checkout business process');
  res = await call('POST', '/api/v1/payments/webhook', { body: event, headers: secret });
  check(
    json(res)['outcome'] === 'DUPLICATE',
    'same webhook again → DUPLICATE (no 2nd license)',
    res,
  );
  res = await call('POST', '/api/v1/payments/webhook', {
    body: { ...event, eventId: `evt_${randomUUID()}` },
    headers: secret,
  });
  check(errorCode(res) === 'ORDER_NOT_PAYABLE', 'new event on paid order → 409', res);
  res = await call('GET', `/api/v1/orders/${orderId}`, { token });
  const licenseKey = String(json(res)['licenseKey']);
  check(
    json(res)['status'] === 'PAID' && /^APP-/.test(licenseKey),
    'GET order → PAID with key',
    res,
  );
  res = await call('GET', '/api/v1/licenses', { token });
  check(res.json<unknown[]>().length === 1, 'GET /licenses → exactly one license', res);

  process.stdout.write('loader\n');
  const hs = (key: string, hwid: string): Promise<LightMyRequestResponse> =>
    call('POST', '/api/v1/loader/handshake', { body: { license_key: key, hwid } });
  check(
    errorCode(await hs('bad-key', 'HWID-0000-AAAA')) === 'VALIDATION_ERROR',
    'malformed key → 400',
  );
  check(
    errorCode(await hs('APP-0000-0000-0000', 'HWID-0000-AAAA')) === 'KEY_NOT_FOUND',
    'unknown key → 404',
  );
  const [a, b] = await Promise.all([
    hs(licenseKey, 'HWID-AAAA-1111'),
    hs(licenseKey, 'HWID-BBBB-2222'),
  ]);
  const actions = [a, b].map((r) => json(r)['action'] ?? errorCode(r)).sort();
  check(
    actions[0] === 'BOUND' && actions[1] === 'HWID_MISMATCH',
    `concurrent first handshakes → one BOUND, one HWID_MISMATCH (${actions.join(', ')})`,
  );
  const winner = json(a)['action'] === 'BOUND' ? 'HWID-AAAA-1111' : 'HWID-BBBB-2222';
  res = await hs(licenseKey, winner);
  check(
    json(res)['action'] === 'AUTHENTICATED' && json(res)['expires_at'] !== null,
    'same hwid → AUTHENTICATED',
    res,
  );

  process.stdout.write('configs\n');
  const payload = {
    sensitivity: 0.7,
    resolution: { width: 1920, height: 1080 },
    smoothing: { algorithm: 'ema', strength: 0.3 },
  };
  res = await call('PUT', '/api/v1/configs/default', { token, body: { payload } });
  check(res.statusCode === 201, 'PUT config → 201 created', res);
  res = await call('PUT', '/api/v1/configs/default', {
    token,
    body: { payload: { ...payload, sensitivity: 0.5 } },
  });
  check(res.statusCode === 200, 'PUT same name → 200 replaced', res);
  res = await call('GET', '/api/v1/configs/default', { token });
  check((json(res)['payload'] as Json)['sensitivity'] === 0.5, 'GET config → latest payload', res);
  res = await call('PUT', '/api/v1/configs/bad', {
    token,
    body: { payload: { ...payload, sensitivity: 3 } },
  });
  check(errorCode(res) === 'VALIDATION_ERROR', 'invalid payload → 400', res);
  check(
    (await call('GET', '/api/v1/configs', { token })).json<unknown[]>().length === 1,
    'GET /configs → 1',
  );
  check(
    (await call('DELETE', '/api/v1/configs/default', { token })).statusCode === 204,
    'DELETE config → 204',
  );
  check(
    errorCode(await call('GET', '/api/v1/configs/default', { token })) === 'NOT_FOUND',
    'deleted → 404',
  );

  process.stdout.write('admin\n');
  check(
    errorCode(await call('GET', '/api/v1/admin/licenses', { token })) === 'FORBIDDEN',
    'user → admin 403',
  );
  res = await call('POST', '/api/v1/auth/login', { body: config.admin });
  const admin = String(json(res)['token']);
  res = await call('GET', '/api/v1/admin/licenses?limit=50', { token: admin });
  const row = res.json<Json[]>().find((l) => l['key'] === licenseKey);
  check(row?.['ownerEmail'] === email, 'admin registry shows owner email', res);
  if (useDb) {
    const q = Number(res.headers['x-db-queries']);
    check(
      q <= 3,
      `admin registry: ${q} SQL queries for ${res.json<unknown[]>().length} rows (no N+1)`,
    );
  }
  res = await call('POST', '/api/v1/admin/licenses', { token: admin, body: { durationDays: 7 } });
  check(res.statusCode === 201, 'admin issues license → 201', res);
  const issued = json(res);
  res = await call('POST', `/api/v1/admin/licenses/${String(issued['id'])}/ban`, { token: admin });
  check(json(res)['status'] === 'BANNED', 'admin bans license', res);
  check(
    errorCode(await hs(String(issued['key']), 'HWID-CCCC-3333')) === 'KEY_BANNED',
    'banned key → 403',
  );
  res = await call('POST', `/api/v1/admin/licenses/${String(row?.['id'])}/reset-hwid`, {
    token: admin,
  });
  check(res.statusCode === 200 && json(res)['hwid'] === null, 'admin resets hwid', res);
  res = await hs(licenseKey, 'HWID-DDDD-4444');
  check(json(res)['action'] === 'BOUND', 'after reset → new device BOUND', res);

  process.stdout.write('logout\n');
  check((await call('POST', '/api/v1/auth/logout', { token })).statusCode === 204, 'logout → 204');
  check(
    errorCode(await call('GET', '/api/v1/auth/me', { token })) === 'UNAUTHENTICATED',
    'old token → 401',
  );
}

async function main(): Promise<void> {
  process.stdout.write(`Smoke scenario on DATA_SOURCE=${config.dataSource}\n`);
  const container = await createContainer({ ...config, debugHeaders: true });
  const app = buildApp(container);
  try {
    await app.ready();
    await scenario(app);
    process.stdout.write(`Smoke test passed: ${passed} checks on ${config.dataSource}.\n`);
  } finally {
    await app.close();
    await container.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `${err instanceof Error ? err.message : String(err)}\nSmoke test FAILED after ${passed} checks.\n`,
  );
  process.exit(1);
});
