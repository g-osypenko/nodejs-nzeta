import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ADMIN, TEST_WEBHOOK_SECRET, type TestApp } from './app.js';

type Json = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

const PAYLOAD = {
  sensitivity: 0.7,
  resolution: { width: 1920, height: 1080 },
  smoothing: { algorithm: 'ema', strength: 0.3 },
};

/**
 * The HTTP contract of spec.md §1/§3, run against BOTH data sources (spec §4.1):
 * test/unit/api.memory.test.ts and test/integration/api.postgres.test.ts.
 */
export function describeApiContract(label: string, start: () => Promise<TestApp>): void {
  describe(`HTTP API contract — ${label}`, () => {
    let t: TestApp;
    let token = '';
    let adminToken = '';
    let userId = '';
    const email = `contract-${randomUUID()}@test.local`;
    const password = 'contract-password-1';

    const call = (
      method: Method,
      url: string,
      opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<LightMyRequestResponse> =>
      t.app.inject({
        method,
        url,
        headers: {
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...opts.headers,
        },
        ...(opts.body === undefined ? {} : { payload: opts.body as Json }),
      });
    const body = (res: LightMyRequestResponse): Json => res.json<Json>();
    const code = (res: LightMyRequestResponse): unknown =>
      (body(res)['error'] as Json | undefined)?.['code'];
    const handshake = (key: string, hwid: string): Promise<LightMyRequestResponse> =>
      call('POST', '/api/v1/loader/handshake', { body: { license_key: key, hwid } });

    async function buyLicense(planId = 'monthly'): Promise<{ orderId: string; key: string }> {
      const res = await call('POST', '/api/v1/orders', {
        token,
        body: { planId },
        headers: { 'idempotency-key': randomUUID() },
      });
      const orderId = String(body(res)['id']);
      await call('POST', '/api/v1/payments/webhook', {
        body: { eventId: `evt_${randomUUID()}`, orderId, result: 'SUCCEEDED' },
        headers: { 'x-webhook-secret': TEST_WEBHOOK_SECRET },
      });
      const order = await call('GET', `/api/v1/orders/${orderId}`, { token });
      return { orderId, key: String(body(order)['licenseKey']) };
    }

    beforeAll(async () => {
      t = await start();
      const reg = await call('POST', '/api/v1/auth/register', { body: { email, password } });
      userId = String(body(reg)['id']);
      token = String(
        body(await call('POST', '/api/v1/auth/login', { body: { email, password } }))['token'],
      );
      adminToken = String(
        body(await call('POST', '/api/v1/auth/login', { body: TEST_ADMIN }))['token'],
      );
    });
    afterAll(async () => {
      await t.close();
    });

    describe('system', () => {
      it('GET /version and /health answer 200', async () => {
        expect((await call('GET', '/version')).json()).toMatchObject({ status: 'OK' });
        expect((await call('GET', '/health')).statusCode).toBe(200);
      });

      it('unknown route → 404 ROUTE_NOT_FOUND with correlation ids in body and headers', async () => {
        const res = await call('GET', '/api/v1/nope');
        expect(res.statusCode).toBe(404);
        expect(code(res)).toBe('ROUTE_NOT_FOUND');
        expect(body(res)['requestId']).toBe(res.headers['x-request-id']);
      });

      it('a valid X-Process-Id is adopted; garbage is replaced by a fresh one', async () => {
        const pid = randomUUID();
        const own = await call('GET', '/version', { headers: { 'x-process-id': pid } });
        expect(own.headers['x-process-id']).toBe(pid);
        const bad = await call('GET', '/version', { headers: { 'x-process-id': 'not-a-uuid' } });
        expect(bad.headers['x-process-id']).not.toBe('not-a-uuid');
      });
    });

    describe('auth', () => {
      it('register: 201 without password hash; duplicate → 409; bad email → 400', async () => {
        const e = `x-${randomUUID()}@test.local`;
        const res = await call('POST', '/api/v1/auth/register', { body: { email: e, password } });
        expect(res.statusCode).toBe(201);
        expect(body(res)).not.toHaveProperty('passwordHash');
        expect(
          code(await call('POST', '/api/v1/auth/register', { body: { email: e, password } })),
        ).toBe('EMAIL_TAKEN');
        expect(
          code(await call('POST', '/api/v1/auth/register', { body: { email: 'bad', password } })),
        ).toBe('VALIDATION_ERROR');
      });

      it('email is case-insensitive (stored lower-case)', async () => {
        const res = await call('POST', '/api/v1/auth/login', {
          body: { email: email.toUpperCase(), password },
        });
        expect(res.statusCode).toBe(200);
      });

      it('me with token → 200; without / with a bogus token → 401', async () => {
        expect(body(await call('GET', '/api/v1/auth/me', { token }))['id']).toBe(userId);
        expect(code(await call('GET', '/api/v1/auth/me'))).toBe('UNAUTHENTICATED');
        expect(code(await call('GET', '/api/v1/auth/me', { token: 'bogus' }))).toBe(
          'UNAUTHENTICATED',
        );
        const malformed = await call('GET', '/api/v1/auth/me', {
          headers: { authorization: 'Bearer   ' },
        });
        expect(code(malformed)).toBe('UNAUTHENTICATED');
      });

      it('logout kills only that session', async () => {
        const other = String(
          body(await call('POST', '/api/v1/auth/login', { body: { email, password } }))['token'],
        );
        expect((await call('POST', '/api/v1/auth/logout', { token: other })).statusCode).toBe(204);
        expect(code(await call('GET', '/api/v1/auth/me', { token: other }))).toBe(
          'UNAUTHENTICATED',
        );
        expect((await call('GET', '/api/v1/auth/me', { token })).statusCode).toBe(200);
      });
    });

    describe('checkout (spec §4.5)', () => {
      it('order needs Idempotency-Key; replay returns the same order; other plan → 409', async () => {
        expect(
          code(await call('POST', '/api/v1/orders', { token, body: { planId: 'monthly' } })),
        ).toBe('VALIDATION_ERROR');
        const headers = { 'idempotency-key': randomUUID() };
        const first = await call('POST', '/api/v1/orders', {
          token,
          body: { planId: 'monthly' },
          headers,
        });
        const replay = await call('POST', '/api/v1/orders', {
          token,
          body: { planId: 'monthly' },
          headers,
        });
        expect([first.statusCode, replay.statusCode]).toEqual([201, 200]);
        expect(body(replay)['id']).toBe(body(first)['id']);
        expect(replay.headers['x-process-id']).toBe(body(first)['processId']);
        const other = await call('POST', '/api/v1/orders', {
          token,
          body: { planId: 'yearly' },
          headers,
        });
        expect(code(other)).toBe('IDEMPOTENCY_CONFLICT');
      });

      it('webhook: PAID once, DUPLICATE on replay, ORDER_NOT_PAYABLE for a new event; one license', async () => {
        const headers = { 'idempotency-key': randomUUID() };
        const created = await call('POST', '/api/v1/orders', {
          token,
          body: { planId: 'quarterly' },
          headers,
        });
        const orderId = String(body(created)['id']);
        const event = { eventId: `evt_${randomUUID()}`, orderId, result: 'SUCCEEDED' };
        const secret = { 'x-webhook-secret': TEST_WEBHOOK_SECRET };
        const before = (await call('GET', '/api/v1/licenses', { token })).json<unknown[]>().length;

        expect(code(await call('POST', '/api/v1/payments/webhook', { body: event }))).toBe(
          'INVALID_WEBHOOK_SECRET',
        );
        const paid = await call('POST', '/api/v1/payments/webhook', {
          body: event,
          headers: secret,
        });
        expect(body(paid)).toEqual({ received: true, outcome: 'PAID' });
        expect(paid.headers['x-process-id']).toBe(body(created)['processId']);
        const dup = await call('POST', '/api/v1/payments/webhook', {
          body: event,
          headers: secret,
        });
        expect(body(dup)['outcome']).toBe('DUPLICATE');
        const again = await call('POST', '/api/v1/payments/webhook', {
          body: { ...event, eventId: `evt_${randomUUID()}` },
          headers: secret,
        });
        expect(code(again)).toBe('ORDER_NOT_PAYABLE');

        const after = (await call('GET', '/api/v1/licenses', { token })).json<Json[]>();
        expect(after.length).toBe(before + 1);
        const order = body(await call('GET', `/api/v1/orders/${orderId}`, { token }));
        expect(order).toMatchObject({ status: 'PAID', planId: 'quarterly' });
        expect(
          after.some((l) => l['key'] === order['licenseKey'] && l['durationDays'] === 90),
        ).toBe(true);
      });

      it('failed payment: order FAILED, no license key', async () => {
        const headers = { 'idempotency-key': randomUUID() };
        const orderId = String(
          body(
            await call('POST', '/api/v1/orders', { token, body: { planId: 'monthly' }, headers }),
          )['id'],
        );
        const res = await call('POST', '/api/v1/payments/webhook', {
          body: { eventId: `evt_${randomUUID()}`, orderId, result: 'FAILED' },
          headers: { 'x-webhook-secret': TEST_WEBHOOK_SECRET },
        });
        expect(body(res)['outcome']).toBe('FAILED');
        expect(body(await call('GET', `/api/v1/orders/${orderId}`, { token }))).toMatchObject({
          status: 'FAILED',
          licenseKey: null,
        });
      });

      it('another user cannot see my order (404, not 403); malformed id → 400', async () => {
        const { orderId } = await buyLicense();
        const e = `y-${randomUUID()}@test.local`;
        await call('POST', '/api/v1/auth/register', { body: { email: e, password } });
        const stranger = String(
          body(await call('POST', '/api/v1/auth/login', { body: { email: e, password } }))['token'],
        );
        expect(code(await call('GET', `/api/v1/orders/${orderId}`, { token: stranger }))).toBe(
          'NOT_FOUND',
        );
        expect(code(await call('GET', '/api/v1/orders/not-a-uuid', { token }))).toBe(
          'VALIDATION_ERROR',
        );
      });
    });

    describe('loader handshake (spec §4.6)', () => {
      it('BOUND → AUTHENTICATED → HWID_MISMATCH; expiry starts at activation', async () => {
        const { key } = await buyLicense();
        const bound = body(await handshake(key, 'HWID-CONTRACT-A'));
        expect(bound).toMatchObject({ status: 'OK', action: 'BOUND' });
        const expires = Date.parse(String(bound['expires_at']));
        expect(expires - Date.now()).toBeGreaterThan(29 * 86_400_000);
        expect(body(await handshake(key, 'HWID-CONTRACT-A'))['action']).toBe('AUTHENTICATED');
        expect(code(await handshake(key, 'HWID-CONTRACT-B'))).toBe('HWID_MISMATCH');
      });

      it('concurrent first handshakes from 5 devices: exactly one BOUND', async () => {
        const { key } = await buyLicense();
        const results = await Promise.all(
          ['1', '2', '3', '4', '5'].map((n) => handshake(key, `HWID-PARALLEL-${n}`)),
        );
        const actions = results.map((r) => body(r)['action'] ?? code(r));
        expect(actions.filter((a) => a === 'BOUND')).toHaveLength(1);
        expect(actions.filter((a) => a === 'HWID_MISMATCH')).toHaveLength(4);
      });

      it('unknown key → 404; malformed → 400', async () => {
        expect(code(await handshake('APP-0000-0000-0000', 'HWID-XXXX-0000'))).toBe('KEY_NOT_FOUND');
        expect(code(await handshake('nope', 'HWID-XXXX-0000'))).toBe('VALIDATION_ERROR');
      });
    });

    describe('configs', () => {
      it('PUT 201 then 200, GET, list, DELETE 204, then 404', async () => {
        const url = '/api/v1/configs/contract';
        expect((await call('PUT', url, { token, body: { payload: PAYLOAD } })).statusCode).toBe(
          201,
        );
        const replaced = await call('PUT', url, {
          token,
          body: { payload: { ...PAYLOAD, sensitivity: 0.1 } },
        });
        expect(replaced.statusCode).toBe(200);
        expect(body(await call('GET', url, { token }))['payload']).toMatchObject({
          sensitivity: 0.1,
          fpsLimit: null,
        });
        expect(
          (await call('GET', '/api/v1/configs', { token })).json<Json[]>().map((c) => c['name']),
        ).toContain('contract');
        expect((await call('DELETE', url, { token })).statusCode).toBe(204);
        expect(code(await call('GET', url, { token }))).toBe('NOT_FOUND');
      });

      it('invalid name → 400; invalid payload → 400; > 64 KiB → 413 PAYLOAD_TOO_LARGE', async () => {
        expect(code(await call('GET', '/api/v1/configs/bad name', { token }))).toBe(
          'VALIDATION_ERROR',
        );
        expect(
          code(
            await call('PUT', '/api/v1/configs/x', {
              token,
              body: { payload: { sensitivity: 2 } },
            }),
          ),
        ).toBe('VALIDATION_ERROR');
        const huge = await call('PUT', '/api/v1/configs/x', {
          token,
          body: { payload: { ...PAYLOAD, pad: 'x'.repeat(70_000) } },
        });
        expect([huge.statusCode, code(huge)]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
      });

      it('wrong content type → 415 UNSUPPORTED_MEDIA_TYPE (no framework codes leak, spec §3)', async () => {
        const res = await call('PUT', '/api/v1/configs/x', {
          token,
          body: 'plain',
          headers: { 'content-type': 'application/xml' },
        });
        expect([res.statusCode, code(res)]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
      });
    });

    describe('admin', () => {
      it('user → 403; anonymous → 401', async () => {
        expect(code(await call('GET', '/api/v1/admin/licenses', { token }))).toBe('FORBIDDEN');
        expect(code(await call('GET', '/api/v1/admin/licenses'))).toBe('UNAUTHENTICATED');
      });

      it('registry shows owner email; status filter; query validation', async () => {
        const { key } = await buyLicense();
        const list = (
          await call('GET', '/api/v1/admin/licenses?limit=100', { token: adminToken })
        ).json<Json[]>();
        expect(list.find((l) => l['key'] === key)?.['ownerEmail']).toBe(email);
        const banned = (
          await call('GET', '/api/v1/admin/licenses?status=BANNED&limit=100', { token: adminToken })
        ).json<Json[]>();
        expect(banned.every((l) => l['status'] === 'BANNED')).toBe(true);
        expect(
          code(await call('GET', '/api/v1/admin/licenses?limit=0', { token: adminToken })),
        ).toBe('VALIDATION_ERROR');
      });

      it('issue → ban → handshake KEY_BANNED; reset-hwid → new device BOUND with the same expiry', async () => {
        const issued = body(
          await call('POST', '/api/v1/admin/licenses', {
            token: adminToken,
            body: { durationDays: 3, userId },
          }),
        );
        expect(issued).toMatchObject({ status: 'UNACTIVATED', durationDays: 3 });
        const first = body(await handshake(String(issued['key']), 'HWID-ADMIN-0001'));

        const reset = await call(
          'POST',
          `/api/v1/admin/licenses/${String(issued['id'])}/reset-hwid`,
          {
            token: adminToken,
          },
        );
        expect(body(reset)['hwid']).toBeNull();
        const rebound = body(await handshake(String(issued['key']), 'HWID-ADMIN-0002'));
        expect(rebound).toMatchObject({ action: 'BOUND', expires_at: first['expires_at'] });

        await call('POST', `/api/v1/admin/licenses/${String(issued['id'])}/ban`, {
          token: adminToken,
        });
        expect(code(await handshake(String(issued['key']), 'HWID-ADMIN-0002'))).toBe('KEY_BANNED');
      });

      it('issue to a missing user → 404 on every data source (spec §4.10); unknown id → 404', async () => {
        const res = await call('POST', '/api/v1/admin/licenses', {
          token: adminToken,
          body: { durationDays: 3, userId: randomUUID() },
        });
        expect(code(res)).toBe('NOT_FOUND');
        expect(
          code(
            await call('POST', `/api/v1/admin/licenses/${randomUUID()}/ban`, { token: adminToken }),
          ),
        ).toBe('NOT_FOUND');
      });
    });
  });
}
