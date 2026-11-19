import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/app.js';

/** Same-origin frontend (ADR 0008): static files, SPA fallback, cache headers, API untouched. */

const HTML = { accept: 'text/html,application/xhtml+xml' };
let dist: string;
let t: TestApp;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'lch-web-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(dist, 'assets', 'index-AbC123.js'), 'console.log(1)');
  await writeFile(join(dist, 'favicon.svg'), '<svg/>');
  t = await createTestApp({ WEB_DIST_DIR: dist });
});

afterAll(async () => {
  await t.close();
  await rm(dist, { recursive: true, force: true });
});

describe('frontend served by Fastify on the same origin', () => {
  it('hashed assets are cached for a year, everything else is revalidated', async () => {
    const asset = await t.app.inject({ method: 'GET', url: '/assets/index-AbC123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const icon = await t.app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('browser navigation to / or a client-side route gets index.html (reload works)', async () => {
    for (const url of ['/', '/licenses', '/orders/123']) {
      const res = await t.app.inject({ method: 'GET', url, headers: HTML });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('id="root"');
    }
  });

  it('API, missing assets and non-GET requests keep the JSON 404 of spec §3', async () => {
    const cases = [
      { method: 'GET' as const, url: '/api/v1/nope', headers: HTML },
      { method: 'GET' as const, url: '/assets/missing.js', headers: { accept: '*/*' } },
      { method: 'POST' as const, url: '/licenses', headers: HTML },
    ];
    for (const c of cases) {
      const res = await t.app.inject(c);
      expect(res.statusCode, c.url).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
    }
  });

  it('API and system endpoints work next to the frontend', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/plans' })).json()).toHaveLength(3);
    expect((await t.app.inject({ method: 'GET', url: '/version' })).statusCode).toBe(200);
  });
});

describe('frontend configuration', () => {
  it('without WEB_DIST_DIR the service is API-only: navigation gets the JSON 404', async () => {
    const api = await createTestApp();
    try {
      const res = await api.app.inject({ method: 'GET', url: '/', headers: HTML });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
    } finally {
      await api.close();
    }
  });

  it('a WEB_DIST_DIR without index.html fails at startup, not on the first visitor', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'lch-web-empty-'));
    try {
      await expect(createTestApp({ WEB_DIST_DIR: empty })).rejects.toThrow('has no index.html');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
