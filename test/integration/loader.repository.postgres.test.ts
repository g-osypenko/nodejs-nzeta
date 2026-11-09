import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPostgresLoaderRepository } from '../../src/modules/loader/loader.repository.postgres.js';
import type { LoaderRepository } from '../../src/modules/loader/loader.repository.js';
import { createDb, type Db } from '../../src/shared/db/client.js';
import type { LicenseRow } from '../../src/shared/db/rows.js';
import { generateLicenseKey } from '../../src/shared/license-key.js';
import { DAY_MS } from '../support/fixtures.js';

describe('postgres loader repository (real Postgres via Testcontainers)', () => {
  let sql: Db;
  let repo: LoaderRepository;
  const now = new Date('2030-01-01T00:00:00.000Z');

  beforeAll(() => {
    sql = createDb({ url: inject('databaseUrl'), max: 5, statementTimeoutMs: 5000 });
    repo = createPostgresLoaderRepository(sql);
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function insertLicense(patch: Partial<LicenseRow> = {}): Promise<LicenseRow> {
    const row = {
      key: generateLicenseKey(),
      hwid: null,
      status: 'UNACTIVATED',
      durationDays: 30,
      activatedAt: null,
      expiresAt: null,
      ...patch,
    };
    const [inserted] = await sql<LicenseRow[]>`
      INSERT INTO licenses (key, hwid, status, duration_days, activated_at, expires_at)
      VALUES (${row.key}, ${row.hwid}, ${row.status}, ${row.durationDays},
              ${row.activatedAt}, ${row.expiresAt})
      RETURNING *`;
    if (!inserted) throw new Error('insert failed');
    return inserted;
  }

  it('findByKey returns the narrow read model with typed columns, or null', async () => {
    const license = await insertLicense({ durationDays: 7 });
    expect(await repo.findByKey(license.key)).toEqual({
      key: license.key,
      hwid: null,
      status: 'UNACTIVATED',
      expiresAt: null,
    });
    expect(await repo.findByKey('APP-0000-0000-0000')).toBeNull();
  });

  it('bindHwid starts the term in SQL: expires_at = now + duration_days', async () => {
    const license = await insertLicense({ durationDays: 7 });
    const bound = await repo.bindHwid(license.key, 'HWID-PG-0001', now);
    expect(bound).toEqual({
      key: license.key,
      hwid: 'HWID-PG-0001',
      status: 'ACTIVE',
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    });
    const [row] = await sql<LicenseRow[]>`SELECT * FROM licenses WHERE id = ${license.id}`;
    expect(row?.activatedAt).toEqual(now);
  });

  it('bindHwid after a reset keeps the original term (COALESCE)', async () => {
    const activatedAt = new Date('2029-12-01T00:00:00.000Z');
    const expiresAt = new Date('2030-01-20T00:00:00.000Z');
    const license = await insertLicense({ status: 'ACTIVE', activatedAt, expiresAt });
    const bound = await repo.bindHwid(license.key, 'HWID-PG-0002', now);
    expect(bound?.expiresAt).toEqual(expiresAt);
  });

  it.each([
    ['already bound', { hwid: 'HWID-OTHER' } as Partial<LicenseRow>],
    ['banned', { status: 'BANNED' } as Partial<LicenseRow>],
  ])('bindHwid returns null and changes nothing when %s', async (_case, patch) => {
    const license = await insertLicense(patch);
    expect(await repo.bindHwid(license.key, 'HWID-PG-0003', now)).toBeNull();
    const [row] = await sql<LicenseRow[]>`SELECT * FROM licenses WHERE id = ${license.id}`;
    expect(row?.hwid ?? null).toBe(patch.hwid ?? null);
  });

  it('20 concurrent binds of one key from different devices: exactly one wins (row lock + recheck)', async () => {
    const license = await insertLicense();
    const devices = Array.from({ length: 20 }, (_, i) => `HWID-RACE-${String(i).padStart(4, '0')}`);

    const results = await Promise.all(devices.map((d) => repo.bindHwid(license.key, d, now)));

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    const [row] = await sql<LicenseRow[]>`SELECT * FROM licenses WHERE id = ${license.id}`;
    expect(row?.hwid).toBe(winners[0]?.hwid);
  });
});
