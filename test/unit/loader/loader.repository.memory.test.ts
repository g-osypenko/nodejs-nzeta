import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLoaderRepository } from '../../../src/modules/loader/loader.repository.memory.js';
import type { LoaderRepository } from '../../../src/modules/loader/loader.repository.js';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { DAY_MS, seedLicense } from '../../support/fixtures.js';

// Same contract as loader.repository.postgres (see test/integration): the memory version must
// keep the compare-and-set semantics of `UPDATE … WHERE hwid IS NULL AND status <> 'BANNED'`.
describe('memory loader repository', () => {
  let store: MemoryStore;
  let repo: LoaderRepository;
  const now = new Date('2030-01-01T00:00:00.000Z');

  beforeEach(() => {
    store = createMemoryStore();
    repo = createMemoryLoaderRepository(store);
  });

  it('findByKey returns the narrow read model or null', async () => {
    const license = seedLicense(store, { hwid: 'HWID-0001', status: 'ACTIVE' });
    expect(await repo.findByKey(license.key)).toEqual({
      key: license.key,
      hwid: 'HWID-0001',
      status: 'ACTIVE',
      expiresAt: null,
    });
    expect(await repo.findByKey('APP-0000-0000-0000')).toBeNull();
  });

  it('bindHwid sets hwid, ACTIVE and the term on first activation', async () => {
    const license = seedLicense(store, { durationDays: 7 });
    const bound = await repo.bindHwid(license.key, 'HWID-0001', now);
    expect(bound).toEqual({
      key: license.key,
      hwid: 'HWID-0001',
      status: 'ACTIVE',
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    });
    expect(store.licenses.get(license.id)?.activatedAt).toEqual(now);
  });

  it('bindHwid keeps an existing term (rebind after reset)', async () => {
    const activatedAt = new Date('2029-12-01T00:00:00.000Z');
    const expiresAt = new Date('2030-01-15T00:00:00.000Z');
    const license = seedLicense(store, { status: 'ACTIVE', activatedAt, expiresAt });
    const bound = await repo.bindHwid(license.key, 'HWID-0002', now);
    expect(bound?.expiresAt).toEqual(expiresAt);
    expect(store.licenses.get(license.id)?.activatedAt).toEqual(activatedAt);
  });

  it.each([
    ['unknown key', (): string => 'APP-0000-0000-0000'],
    ['already bound', (s: MemoryStore): string => seedLicense(s, { hwid: 'HWID-OTHER' }).key],
    ['banned', (s: MemoryStore): string => seedLicense(s, { status: 'BANNED' }).key],
  ])('bindHwid refuses (returns null) when %s', async (_case, keyOf) => {
    const key = keyOf(store);
    const before = structuredClone([...store.licenses.values()]);
    expect(await repo.bindHwid(key, 'HWID-0001', now)).toBeNull();
    expect([...store.licenses.values()]).toEqual(before);
  });
});
