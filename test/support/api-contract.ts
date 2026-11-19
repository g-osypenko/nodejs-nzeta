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

    const call = (
      method: Method,
      url: string,
      opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
    ): Promise<LightMyRequestResponse> =>
      t.app.inject({
        method,
        url,
        headers: {
          // `token` = the session cookie, sent like a same-origin browser fetch (CSRF guard).
          ...(opts.token
            ? { cookie: `lch_session=${opts.token}`, 'sec-fetch-site': 'same-origin' }
            : {}),
          ...opts.headers,
        },
        ...(opts.body === undefined ? {} : { payload: opts.body as Json }),
      });
    const body = (res: LightMyRequestResponse): Json => res.json<Json>();
    const code = (res: LightMyRequestResponse): unknown =>
      (body(res)['error'] as Json | undefined)?.['code'];
    const handshake = (key: string, hwid: string): Promise<LightMyRequestResponse> =>
      call('POST', '/api/v1/loader/handshake', { body: { license_key: key, hwid } });

    /** Passwordless sign-in (ADR 0011): the code comes from the in-memory outbox. */
    async function signInToken(to: string): Promise<string> {
      await call('POST', '/api/v1/auth/code', { body: { email: to } });
      // The server stores emails lower-case, so the letter goes to the lower-case address.
      const letter = (t.container.outbox ?? []).filter((m) => m.to === to.toLowerCase()).at(-1);
      if (!letter) throw new Error(`no sign-in letter to ${to}`);
      const res = await call('POST', '/api/v1/auth/code/verify', {
        body: { email: to, code: letter.code },
      });
      const set = res.cookies.find((c) => c.name === 'lch_session');
      if (!set) throw new Error(`no session cookie: ${res.statusCode} ${res.body}`);
      return set.value;
    }

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
      token = await signInToken(email);
      userId = String(body(await call('GET', '/api/v1/auth/me', { token }))['id']);
      adminToken = await signInToken(TEST_ADMIN.email);
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
      // One code a minute per address (ADR 0011), so every test signs in with its own email.
      it('email is case-insensitive (stored lower-case); no password hash in the DTO', async () => {
        const e = `case-${randomUUID()}@test.local`;
        const me = body(
          await call('GET', '/api/v1/auth/me', { token: await signInToken(e.toUpperCase()) }),
        );
        expect(me['email']).toBe(e);
        expect(me).not.toHaveProperty('passwordHash');
      });

      it('the password endpoints are gone (ADR 0011)', async () => {
        for (const url of ['/api/v1/auth/register', '/api/v1/auth/login']) {
          const res = await call('POST', url, { body: { email, password: 'whatever-1' } });
          expect(code(res)).toBe('ROUTE_NOT_FOUND');
        }
      });

      it('me with token → 200; without / with a bogus token → 401', async () => {
        expect(body(await call('GET', '/api/v1/auth/me', { token }))['id']).toBe(userId);
        expect(code(await call('GET', '/api/v1/auth/me'))).toBe('UNAUTHENTICATED');
        expect(code(await call('GET', '/api/v1/auth/me', { token: 'bogus' }))).toBe(
          'UNAUTHENTICATED',
        );
        // A Bearer header is not a session any more: only the cookie is (ADR 0011).
        const bearer = await call('GET', '/api/v1/auth/me', {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(code(bearer)).toBe('UNAUTHENTICATED');
      });

      it('logout kills only that session', async () => {
        const other = await signInToken(`other-${randomUUID()}@test.local`);
        expect((await call('POST', '/api/v1/auth/logout', { token: other })).statusCode).toBe(204);
        expect(code(await call('GET', '/api/v1/auth/me', { token: other }))).toBe(
          'UNAUTHENTICATED',
        );
        expect((await call('GET', '/api/v1/auth/me', { token })).statusCode).toBe(200);
      });
    });

    describe('passwordless sign-in and cookie session (ADR 0011)', () => {
      const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

      const letterTo = (to: string): { code: string; link: string } => {
        const letter = (t.container.outbox ?? []).filter((m) => m.to === to).at(-1);
        if (!letter) throw new Error(`no sign-in letter to ${to}`);
        return letter;
      };
      const sessionCookie = (res: LightMyRequestResponse): string => {
        const set = res.cookies.find((c) => c.name === 'lch_session');
        if (!set) throw new Error(`no session cookie: ${res.statusCode} ${res.body}`);
        return `lch_session=${set.value}`;
      };
      const signIn = async (to: string): Promise<string> => `lch_session=${await signInToken(to)}`;

      it('code: 202 → letter with a 6-digit code and a link; verify sets an httpOnly cookie', async () => {
        const e = `otp-${randomUUID()}@test.local`;
        const sent = await call('POST', '/api/v1/auth/code', { body: { email: e.toUpperCase() } });
        expect(sent.statusCode).toBe(202);
        expect(body(sent)).toHaveProperty('expiresAt');
        const letter = letterTo(e);
        expect(letter.code).toMatch(/^\d{6}$/);
        expect(letter.link).toMatch(/\/login\/verify#token=[\w-]{43}$/);

        const wrong = String((Number(letter.code) + 1) % 1_000_000).padStart(6, '0');
        const bad = await call('POST', '/api/v1/auth/code/verify', {
          body: { email: e, code: wrong },
        });
        expect(bad.statusCode).toBe(401);
        expect(code(bad)).toBe('INVALID_CODE');

        const ok = await call('POST', '/api/v1/auth/code/verify', {
          body: { email: e, code: letter.code },
        });
        expect(ok.statusCode).toBe(200);
        expect(body(ok)['user']).toMatchObject({ email: e, role: 'USER' });
        expect(body(ok)).not.toHaveProperty('token');
        const set = ok.cookies.find((c) => c.name === 'lch_session');
        expect(set).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

        const me = await call('GET', '/api/v1/auth/me', { headers: { cookie: sessionCookie(ok) } });
        expect(body(me)['email']).toBe(e);
        // A used code does not work twice.
        const reused = await call('POST', '/api/v1/auth/code/verify', {
          body: { email: e, code: letter.code },
        });
        expect(code(reused)).toBe('INVALID_CODE');
      });

      it('link: the token of the letter signs in once', async () => {
        const e = `link-${randomUUID()}@test.local`;
        await call('POST', '/api/v1/auth/code', { body: { email: e } });
        const linkToken = decodeURIComponent(letterTo(e).link.split('#token=')[1] ?? '');
        const ok = await call('POST', '/api/v1/auth/link/verify', { body: { token: linkToken } });
        expect(ok.statusCode).toBe(200);
        expect(body(ok)['user']).toMatchObject({ email: e });
        const again = await call('POST', '/api/v1/auth/link/verify', {
          body: { token: linkToken },
        });
        expect(code(again)).toBe('INVALID_CODE');
      });

      it('resend within the cooldown → 429 TOO_MANY_REQUESTS with Retry-After', async () => {
        const e = `cool-${randomUUID()}@test.local`;
        await call('POST', '/api/v1/auth/code', { body: { email: e } });
        const res = await call('POST', '/api/v1/auth/code', { body: { email: e } });
        expect(res.statusCode).toBe(429);
        expect(code(res)).toBe('TOO_MANY_REQUESTS');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      });

      it('bad input → 400: code not 6 digits, bad email, short link token', async () => {
        const e = `bad-${randomUUID()}@test.local`;
        const cases: [string, Json][] = [
          ['/api/v1/auth/code/verify', { email: e, code: '12345' }],
          ['/api/v1/auth/code', { email: 'not-an-email' }],
          ['/api/v1/auth/link/verify', { token: 'short' }],
        ];
        for (const [url, payload] of cases) {
          expect(code(await call('POST', url, { body: payload }))).toBe('VALIDATION_ERROR');
        }
      });

      it('ADMIN_EMAIL signs in by code as the existing ADMIN', async () => {
        // adminToken came from a code sign-in of ADMIN_EMAIL in beforeAll.
        const me = await call('GET', '/api/v1/auth/me', { token: adminToken });
        expect(body(me)).toMatchObject({ email: TEST_ADMIN.email, role: 'ADMIN' });
      });

      it('CSRF: a cookie mutation must prove same origin; a foreign Origin is always rejected', async () => {
        const cookie = await signIn(`csrf-${randomUUID()}@test.local`);
        const order = (headers: Record<string, string>): Promise<LightMyRequestResponse> =>
          call('POST', '/api/v1/orders', {
            body: { planId: 'monthly' },
            headers: { cookie, 'idempotency-key': randomUUID(), ...headers },
          });

        const noProof = await order({});
        expect(noProof.statusCode).toBe(403);
        expect(code(noProof)).toBe('FORBIDDEN');
        expect(code(await order({ origin: 'https://evil.example' }))).toBe('FORBIDDEN');
        expect(code(await order({ 'sec-fetch-site': 'cross-site' }))).toBe('FORBIDDEN');
        expect(code(await order({ origin: 'null' }))).toBe('FORBIDDEN');
        // inject() sends Host: localhost:80 — an Origin with that host is the page's own origin.
        expect((await order({ origin: 'http://localhost:80' })).statusCode).toBe(201);
        expect((await order(SAME_ORIGIN)).statusCode).toBe(201);
        // Reads need no proof.
        const read = await call('GET', '/api/v1/licenses', { headers: { cookie } });
        expect(read.statusCode).toBe(200);
        // Service calls without a session and without an Origin (payment webhook) are not affected,
        // but a foreign Origin is rejected even there.
        const webhook = (headers: Record<string, string>): Promise<LightMyRequestResponse> =>
          call('POST', '/api/v1/payments/webhook', {
            body: { eventId: `evt_${randomUUID()}`, orderId: randomUUID(), result: 'SUCCEEDED' },
            headers: { 'x-webhook-secret': TEST_WEBHOOK_SECRET, ...headers },
          });
        expect(code(await webhook({}))).not.toBe('FORBIDDEN');
        expect(code(await webhook({ origin: 'https://evil.example' }))).toBe('FORBIDDEN');
      });

      it('logout by cookie ends the session and clears the cookie', async () => {
        const cookie = await signIn(`out-${randomUUID()}@test.local`);
        const out = await call('POST', '/api/v1/auth/logout', {
          headers: { cookie, ...SAME_ORIGIN },
        });
        expect(out.statusCode).toBe(204);
        expect(out.cookies.find((c) => c.name === 'lch_session')?.value).toBe('');
        const me = await call('GET', '/api/v1/auth/me', { headers: { cookie } });
        expect(code(me)).toBe('UNAUTHENTICATED');
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
        const stranger = await signInToken(e);
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
