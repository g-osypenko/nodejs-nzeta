import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { AppError } from '../../../src/shared/errors.js';
import type {
  LoaderLicense,
  LoaderRepository,
} from '../../../src/modules/loader/loader.repository.js';
import { createMemoryLoaderRepository } from '../../../src/modules/loader/loader.repository.memory.js';
import {
  createLoaderService,
  type LoaderService,
} from '../../../src/modules/loader/loader.service.js';
import { DAY_MS, seedLicense } from '../../support/fixtures.js';

const HWID_A = 'HWID-AAAA-1111';
const HWID_B = 'HWID-BBBB-2222';

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

describe('loader.service handshake (memory repository)', () => {
  let store: MemoryStore;
  let loader: LoaderService;

  beforeEach(() => {
    store = createMemoryStore();
    loader = createLoaderService({ repo: createMemoryLoaderRepository(store) });
  });

  it('first handshake binds the HWID and starts the term at activation', async () => {
    const license = seedLicense(store, { durationDays: 30 });
    const before = Date.now();

    const result = await loader.handshake(license.key, HWID_A);

    expect(result.action).toBe('BOUND');
    const stored = store.licenses.get(license.id);
    expect(stored?.hwid).toBe(HWID_A);
    expect(stored?.status).toBe('ACTIVE');
    // term = activation + duration (spec §1: "термін іде від активації, а не від покупки")
    const expires = result.expiresAt?.getTime() ?? 0;
    expect(expires - (stored?.activatedAt?.getTime() ?? 0)).toBe(30 * DAY_MS);
    expect(stored?.activatedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('same HWID afterwards → AUTHENTICATED with the same expiry, nothing rebound', async () => {
    const license = seedLicense(store);
    const bound = await loader.handshake(license.key, HWID_A);

    const again = await loader.handshake(license.key, HWID_A);

    expect(again).toEqual({ action: 'AUTHENTICATED', expiresAt: bound.expiresAt });
  });

  it('another HWID on a bound key → HWID_MISMATCH and the binding is kept', async () => {
    const license = seedLicense(store);
    await loader.handshake(license.key, HWID_A);

    expect(await errorCodeOf(loader.handshake(license.key, HWID_B))).toBe('HWID_MISMATCH');
    expect(store.licenses.get(license.id)?.hwid).toBe(HWID_A);
  });

  it('unknown key → KEY_NOT_FOUND', async () => {
    expect(await errorCodeOf(loader.handshake('APP-0000-0000-0000', HWID_A))).toBe('KEY_NOT_FOUND');
  });

  it('banned key → KEY_BANNED even for the bound device, and is never bound', async () => {
    const bannedBound = seedLicense(store, { status: 'BANNED', hwid: HWID_A });
    const bannedFresh = seedLicense(store, { status: 'BANNED' });

    expect(await errorCodeOf(loader.handshake(bannedBound.key, HWID_A))).toBe('KEY_BANNED');
    expect(await errorCodeOf(loader.handshake(bannedFresh.key, HWID_A))).toBe('KEY_BANNED');
    expect(store.licenses.get(bannedFresh.id)?.hwid).toBeNull();
  });

  it('expired key → KEY_EXPIRED for the bound device', async () => {
    const license = seedLicense(store, {
      status: 'ACTIVE',
      hwid: HWID_A,
      activatedAt: new Date(Date.now() - 31 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    expect(await errorCodeOf(loader.handshake(license.key, HWID_A))).toBe('KEY_EXPIRED');
  });

  it('expired key after an HWID reset cannot be re-bound → KEY_EXPIRED', async () => {
    const license = seedLicense(store, {
      status: 'ACTIVE',
      hwid: null,
      activatedAt: new Date(Date.now() - 31 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    expect(await errorCodeOf(loader.handshake(license.key, HWID_B))).toBe('KEY_EXPIRED');
    expect(store.licenses.get(license.id)?.hwid).toBeNull();
  });

  it('a key that expires exactly now is already expired (boundary)', async () => {
    const now = new Date();
    const license = seedLicense(store, {
      status: 'ACTIVE',
      hwid: HWID_A,
      activatedAt: new Date(now.getTime() - DAY_MS),
      expiresAt: now,
    });

    expect(await errorCodeOf(loader.handshake(license.key, HWID_A))).toBe('KEY_EXPIRED');
  });

  it('after an admin HWID reset a new device binds and keeps the original term', async () => {
    const activatedAt = new Date(Date.now() - 10 * DAY_MS);
    const expiresAt = new Date(Date.now() + 20 * DAY_MS);
    const license = seedLicense(store, { status: 'ACTIVE', hwid: null, activatedAt, expiresAt });

    const result = await loader.handshake(license.key, HWID_B);

    expect(result).toEqual({ action: 'BOUND', expiresAt });
    expect(store.licenses.get(license.id)?.activatedAt).toEqual(activatedAt);
  });

  it('concurrent first handshakes from two devices: exactly one BOUND, one HWID_MISMATCH', async () => {
    const license = seedLicense(store);

    const results = await Promise.allSettled([
      loader.handshake(license.key, HWID_A),
      loader.handshake(license.key, HWID_B),
    ]);

    const outcomes = results
      .map((r) => (r.status === 'fulfilled' ? r.value.action : (r.reason as AppError).code))
      .sort();
    expect(outcomes).toEqual(['BOUND', 'HWID_MISMATCH']);
  });
});

describe('loader.service handshake — lost bind race (stub repository)', () => {
  const fresh: LoaderLicense = {
    key: 'APP-AAAA-BBBB-CCCC',
    hwid: null,
    status: 'UNACTIVATED',
    expiresAt: null,
  };

  /** findByKey returns `first`, then `afterRace`; bindHwid always loses the race. */
  function racingRepo(afterRace: LoaderLicense | null): LoaderRepository {
    let reads = 0;
    return {
      findByKey: async () => (reads++ === 0 ? fresh : afterRace),
      bindHwid: async () => null,
    };
  }

  const future = new Date(Date.now() + DAY_MS);

  it('winner bound another device → HWID_MISMATCH', async () => {
    const loader = createLoaderService({
      repo: racingRepo({ ...fresh, hwid: HWID_B, status: 'ACTIVE', expiresAt: future }),
    });
    expect(await errorCodeOf(loader.handshake(fresh.key, HWID_A))).toBe('HWID_MISMATCH');
  });

  it('winner bound the same device (duplicate request) → AUTHENTICATED', async () => {
    const loader = createLoaderService({
      repo: racingRepo({ ...fresh, hwid: HWID_A, status: 'ACTIVE', expiresAt: future }),
    });
    expect(await loader.handshake(fresh.key, HWID_A)).toEqual({
      action: 'AUTHENTICATED',
      expiresAt: future,
    });
  });

  it('license was banned in between → KEY_BANNED', async () => {
    const loader = createLoaderService({ repo: racingRepo({ ...fresh, status: 'BANNED' }) });
    expect(await errorCodeOf(loader.handshake(fresh.key, HWID_A))).toBe('KEY_BANNED');
  });

  it('license disappeared in between → KEY_NOT_FOUND', async () => {
    const loader = createLoaderService({ repo: racingRepo(null) });
    expect(await errorCodeOf(loader.handshake(fresh.key, HWID_A))).toBe('KEY_NOT_FOUND');
  });
});
