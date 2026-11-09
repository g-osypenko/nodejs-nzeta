import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * E2E: the BUILT server (`node dist/index.js`, as in production) against a real Postgres,
 * driven over real TCP with fetch. Run via `npm run test:e2e` (builds first).
 */
const SECRET = 'e2e-webhook-secret-000001';
const ADMIN = { email: 'admin@e2e.local', password: 'admin-password-e2e' };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

interface Server {
  proc: ChildProcess;
  logs: Record<string, unknown>[];
  exited: Promise<number | null>;
}

function startServer(env: Record<string, string>): Server {
  const proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: Record<string, unknown>[] = [];
  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        logs.push({ raw: line });
      }
    }
  });
  const exited = new Promise<number | null>((resolve) =>
    proc.once('exit', (code) => resolve(code)),
  );
  return { proc, logs, exited };
}

async function waitForHealth(base: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(`${base}/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${base} did not become healthy in ${timeoutMs} ms`);
}

describe('e2e: built server process + Postgres over HTTP', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    if (!existsSync('dist/index.js'))
      throw new Error('dist/ missing — run `npm run test:e2e` (it builds first)');
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = startServer({
      DATA_SOURCE: 'postgres',
      DATABASE_URL: inject('databaseUrl'),
      PORT: String(port),
      HOST: '127.0.0.1',
      WEBHOOK_SECRET: SECRET,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      GIT_COMMIT: 'e2e-sha',
    });
    await waitForHealth(base);
  });

  afterAll(async () => {
    server.proc.kill();
    await server.exited;
  });

  const api = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      headers: res.headers,
    };
  };

  it('GET /version reports the deployed commit', async () => {
    expect((await api('GET', '/version')).body).toEqual({ status: 'OK', commit: 'e2e-sha' });
  });

  it('customer journey: register → buy → pay → get key → loader BOUND/AUTHENTICATED → sync config', async () => {
    const email = `e2e-${randomUUID()}@test.local`;
    const password = 'e2e-password-01';
    expect((await api('POST', '/api/v1/auth/register', { body: { email, password } })).status).toBe(
      201,
    );
    const { token } = (await api('POST', '/api/v1/auth/login', { body: { email, password } }))
      .body as {
      token: string;
    };

    const plans = await fetch(`${base}/api/v1/plans`).then(
      (r) => r.json() as Promise<{ id: string }[]>,
    );
    expect(plans.map((p) => p.id)).toEqual(['monthly', 'quarterly', 'yearly']);

    const order = await api('POST', '/api/v1/orders', {
      token,
      body: { planId: 'yearly' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(order.status).toBe(201);
    const orderId = String(order.body['id']);
    const paid = await api('POST', '/api/v1/payments/webhook', {
      body: { eventId: `evt_${randomUUID()}`, orderId, result: 'SUCCEEDED' },
      headers: { 'x-webhook-secret': SECRET },
    });
    expect(paid.body['outcome']).toBe('PAID');
    const key = String(
      (await api('GET', `/api/v1/orders/${orderId}`, { token })).body['licenseKey'],
    );

    const bound = await api('POST', '/api/v1/loader/handshake', {
      body: { license_key: key, hwid: 'HWID-E2E-0001' },
    });
    expect(bound.body).toMatchObject({ status: 'OK', action: 'BOUND' });
    const again = await api('POST', '/api/v1/loader/handshake', {
      body: { license_key: key, hwid: 'HWID-E2E-0001' },
    });
    expect(again.body['action']).toBe('AUTHENTICATED');

    const payload = {
      sensitivity: 0.4,
      resolution: { width: 1280, height: 720 },
      smoothing: { algorithm: 'kalman', strength: 0.5 },
    };
    expect((await api('PUT', '/api/v1/configs/e2e', { token, body: { payload } })).status).toBe(
      201,
    );
    expect((await api('GET', '/api/v1/configs/e2e', { token })).body['payload']).toMatchObject(
      payload,
    );
  });

  it('every log line of the checkout process carries its processId, across requests and layers (spec §4.3)', async () => {
    const email = `e2e-log-${randomUUID()}@test.local`;
    const password = 'e2e-password-02';
    await api('POST', '/api/v1/auth/register', { body: { email, password } });
    const { token } = (await api('POST', '/api/v1/auth/login', { body: { email, password } }))
      .body as {
      token: string;
    };
    const order = await api('POST', '/api/v1/orders', {
      token,
      body: { planId: 'monthly' },
      headers: { 'idempotency-key': randomUUID() },
    });
    const processId = String(order.body['processId']);
    const webhook = await api('POST', '/api/v1/payments/webhook', {
      body: {
        eventId: `evt_${randomUUID()}`,
        orderId: String(order.body['id']),
        result: 'SUCCEEDED',
      },
      headers: { 'x-webhook-secret': SECRET },
    });
    expect(webhook.headers.get('x-process-id')).toBe(processId);

    await new Promise((r) => setTimeout(r, 300)); // let stdout flush
    const lines = server.logs.filter((l) => l['processId'] === processId);
    const messages = lines.map((l) => l['msg']);
    // service-level lines from two different requests, plus both access-log lines
    expect(messages).toEqual(
      expect.arrayContaining(['order placed', 'payment event applied', 'request completed']),
    );
    expect(new Set(lines.map((l) => l['reqId'])).size).toBe(2);
    // the order request was made by the user: userId is in its lines without being passed around
    expect(lines.find((l) => l['msg'] === 'order placed')?.['userId']).toEqual(expect.any(String));
  });
});

describe('e2e: process-level failure behaviour', () => {
  it('without a reachable DB the process exits with code 1 and logs why (fail fast)', async () => {
    const port = await freePort();
    const started = Date.now();
    const server = startServer({
      DATA_SOURCE: 'postgres',
      DATABASE_URL: 'postgres://x:y@127.0.0.1:1/none',
      PORT: String(port),
      WEBHOOK_SECRET: SECRET,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
    });
    expect(await server.exited).toBe(1);
    expect(Date.now() - started).toBeLessThan(10_000);
    const fatal = server.logs.find((l) => l['msg'] === 'startup failed');
    expect(JSON.stringify(fatal)).toContain('Database is unreachable at startup');
  });

  it('invalid environment → exit 1 before touching the DB', async () => {
    const server = startServer({
      DATA_SOURCE: 'postgres',
      DATABASE_URL: 'postgres://x',
      WEBHOOK_SECRET: 'short',
      ADMIN_EMAIL: 'bad',
      ADMIN_PASSWORD: 'p',
    });
    expect(await server.exited).toBe(1);
    expect(JSON.stringify(server.logs)).toContain('Invalid environment configuration');
  });
});
