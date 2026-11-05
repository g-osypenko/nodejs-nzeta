import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/modules/auth/password.js';
import { loadConfig } from '../../../src/shared/config.js';
import { isDbUnavailable, isTransientDbError } from '../../../src/shared/db/errors.js';
import {
  generateLicenseKey,
  isExpired,
  LICENSE_KEY_PATTERN,
} from '../../../src/shared/license-key.js';

describe('license key', () => {
  it('generates APP-XXXX-XXXX-XXXX upper-case hex keys that differ', () => {
    const keys = new Set(Array.from({ length: 200 }, generateLicenseKey));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(LICENSE_KEY_PATTERN);
  });

  it.each([
    ['APP-0A1B-2C3D-4E5F', true],
    ['app-0a1b-2c3d-4e5f', false],
    ['APP-0A1B-2C3D-4E5', false],
    ['APP-0A1B-2C3D-4E5F0', false],
    ['XAPP-0A1B-2C3D-4E5F', false],
    ['APP-0A1B-2C3D-4E5G', false],
  ])('pattern %s → %s', (key, ok) => {
    expect(LICENSE_KEY_PATTERN.test(key)).toBe(ok);
  });

  it('isExpired: null never expires; boundary expiresAt == now is expired', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isExpired(new Date(now.getTime()), now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});

describe('password hashing (scrypt)', () => {
  it('round-trips, rejects a wrong password, salts every hash', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horsE', a)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['other scheme', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='],
    ['missing hash', 'scrypt$16384$8$1$c2FsdA=='],
    ['truncated hash (length differs)', 'scrypt$16384$8$1$c2FsdA==$aGFzaA=='],
  ])('rejects a malformed stored hash: %s', async (_case, stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });
});

describe('config (env validation, fail fast)', () => {
  const base = {
    WEBHOOK_SECRET: 'x'.repeat(16),
    ADMIN_EMAIL: 'Admin@Test.Local',
    ADMIN_PASSWORD: 'p'.repeat(8),
  };

  it('applies defaults and normalises the admin email', () => {
    const c = loadConfig({ ...base, DATA_SOURCE: 'memory' });
    expect(c).toMatchObject({
      port: 3000,
      host: '127.0.0.1',
      dataSource: 'memory',
      databaseUrl: null,
      dbPoolMax: 10,
      dbStatementTimeoutMs: 5000,
      sessionTtlHours: 24,
      gitCommit: 'dev-local',
      debugHeaders: false,
      admin: { email: 'admin@test.local', password: 'pppppppp' },
    });
  });

  it('defaults to postgres and then requires DATABASE_URL', () => {
    expect(() => loadConfig(base)).toThrow(/DATABASE_URL: DATABASE_URL is required/);
    expect(loadConfig({ ...base, DATABASE_URL: 'postgres://x' }).databaseUrl).toBe('postgres://x');
  });

  it('parses numbers and booleans from strings', () => {
    const c = loadConfig({ ...base, DATA_SOURCE: 'memory', PORT: '8080', DEBUG_HEADERS: 'true' });
    expect(c.port).toBe(8080);
    expect(c.debugHeaders).toBe(true);
  });

  it.each([
    ['short webhook secret', { WEBHOOK_SECRET: 'short' }, /WEBHOOK_SECRET/],
    ['bad admin email', { ADMIN_EMAIL: 'nope' }, /ADMIN_EMAIL/],
    ['non-numeric port', { PORT: 'abc' }, /PORT/],
    ['unknown data source', { DATA_SOURCE: 'mysql' }, /DATA_SOURCE/],
  ])('rejects %s with a readable message', (_case, patch, field) => {
    expect(() => loadConfig({ ...base, DATA_SOURCE: 'memory', ...patch })).toThrow(field);
  });
});

describe('db error classification', () => {
  const err = (code: unknown): unknown => Object.assign(new Error('x'), { code });

  it.each([
    // [code, unavailable → 503, transient → retry]
    ['ECONNREFUSED', true, true],
    ['ECONNRESET', true, true],
    ['CONNECT_TIMEOUT', true, true],
    ['CONNECTION_CLOSED', true, true],
    ['CONNECTION_ENDED', true, true],
    ['CONNECTION_DESTROYED', true, true],
    ['ETIMEDOUT', true, true],
    ['EPIPE', true, true],
    ['ENOTFOUND', true, true],
    ['EAI_AGAIN', true, true],
    ['08006', true, true], // connection_failure (class 08)
    ['57P01', true, true], // admin_shutdown
    ['57P02', true, true], // crash_shutdown
    ['57P03', true, true], // cannot_connect_now
    ['53300', true, true], // too_many_connections
    ['57014', true, false], // statement timeout: 503, but NOT retried
    ['40001', false, true], // serialization_failure
    ['40P01', false, true], // deadlock_detected
    ['23505', false, false], // unique_violation: a bug/conflict, never retried
    ['23503', false, false],
  ])('%s → unavailable=%s transient=%s', (code, unavailable, transient) => {
    expect(isDbUnavailable(err(code))).toBe(unavailable);
    expect(isTransientDbError(err(code))).toBe(transient);
  });

  it.each([
    ['no code', new Error('x')],
    ['numeric code', err(42)],
    ['null', null],
    ['string', 'ECONNREFUSED'],
  ])('non-db values (%s) are neither unavailable nor transient', (_case, value) => {
    expect(isDbUnavailable(value)).toBe(false);
    expect(isTransientDbError(value)).toBe(false);
  });
});
