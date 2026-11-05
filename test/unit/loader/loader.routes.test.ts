import fastify, { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loaderRoutes } from '../../../src/modules/loader/loader.routes.js';
import { createTestApp, type TestApp } from '../../support/app.js';

describe('POST /api/v1/loader/handshake — transport contract', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const handshake = (body: unknown): Promise<LightMyRequestResponse> =>
    t.app.inject({ method: 'POST', url: '/api/v1/loader/handshake', payload: body as object });

  it.each([
    ['lower-case key', { license_key: 'app-aaaa-bbbb-cccc', hwid: 'HWID-0000-0001' }],
    ['key with a non-hex group', { license_key: 'APP-AAAA-BBBB-CCCG', hwid: 'HWID-0000-0001' }],
    ['key with a trailing char', { license_key: 'APP-AAAA-BBBB-CCCC1', hwid: 'HWID-0000-0001' }],
    ['hwid shorter than 8', { license_key: 'APP-AAAA-BBBB-CCCC', hwid: 'HW-1' }],
    ['hwid longer than 128', { license_key: 'APP-AAAA-BBBB-CCCC', hwid: 'H'.repeat(129) }],
    ['hwid with a space', { license_key: 'APP-AAAA-BBBB-CCCC', hwid: 'HWID 0000 0001' }],
    ['missing hwid', { license_key: 'APP-AAAA-BBBB-CCCC' }],
  ])('rejects %s with 400 VALIDATION_ERROR before touching the service', async (_case, body) => {
    const res = await handshake(body);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the boundary lengths of hwid (8 and 128) and reaches the service', async () => {
    for (const hwid of ['H'.repeat(8), 'H'.repeat(128)]) {
      const res = await handshake({ license_key: 'APP-AAAA-BBBB-CCCC', hwid });
      expect(res.json<{ error: { code: string } }>().error.code).toBe('KEY_NOT_FOUND');
    }
  });

  it('maps a domain error to its HTTP status with requestId/processId', async () => {
    const res = await handshake({ license_key: 'APP-AAAA-BBBB-CCCC', hwid: 'HWID-0000-0001' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ requestId: string; processId: string }>();
    expect(body.requestId).toBe(res.headers['x-request-id']);
    expect(body.processId).toBe(res.headers['x-process-id']);
  });
});

describe('loader routes — response shape', () => {
  it('serialises expires_at as ISO string, or null when the service has no expiry', async () => {
    const expiresAt = new Date('2030-01-02T03:04:05.000Z');
    const results = [
      { action: 'BOUND' as const, expiresAt },
      { action: 'AUTHENTICATED' as const, expiresAt: null },
    ];
    const app = fastify();
    await app.register(loaderRoutes({ handshake: async () => results.shift() ?? results[0]! }));

    const body = { license_key: 'APP-AAAA-BBBB-CCCC', hwid: 'HWID-0000-0001' };
    const first = await app.inject({ method: 'POST', url: '/loader/handshake', payload: body });
    const second = await app.inject({ method: 'POST', url: '/loader/handshake', payload: body });

    expect(first.json()).toEqual({
      status: 'OK',
      action: 'BOUND',
      expires_at: '2030-01-02T03:04:05.000Z',
    });
    expect(second.json()).toEqual({ status: 'OK', action: 'AUTHENTICATED', expires_at: null });
    await app.close();
  });
});
