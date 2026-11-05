import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryConfigsRepository } from '../../../src/modules/configs/configs.repository.memory.js';
import { ConfigPayload } from '../../../src/modules/configs/configs.schemas.js';
import {
  createConfigsService,
  type ConfigsService,
} from '../../../src/modules/configs/configs.service.js';
import { createMemoryStore, type MemoryStore } from '../../../src/shared/db/memory-store.js';
import { AppError } from '../../../src/shared/errors.js';
import { asUser, runAs, seedUser } from '../../support/fixtures.js';

const payload = ConfigPayload.parse({
  sensitivity: 0.5,
  resolution: { width: 1920, height: 1080 },
  smoothing: { algorithm: 'ema', strength: 0.2 },
});

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : String(e)),
  );
}

describe('configs.service', () => {
  let store: MemoryStore;
  let configs: ConfigsService;

  beforeEach(() => {
    store = createMemoryStore();
    configs = createConfigsService({ repo: createMemoryConfigsRepository(store) });
  });

  it('every operation requires a signed-in user', async () => {
    for (const op of [
      (): Promise<unknown> => configs.list(),
      (): Promise<unknown> => configs.get('a'),
      (): Promise<unknown> => configs.put('a', payload),
      (): Promise<unknown> => configs.remove('a'),
    ]) {
      expect(await codeOf(runAs(null, op))).toBe('UNAUTHENTICATED');
    }
  });

  it('put creates then replaces by name (idempotent upsert), keeping the id', async () => {
    const alice = asUser(seedUser(store));
    const first = await runAs(alice, () => configs.put('main', payload));
    const second = await runAs(alice, () => configs.put('main', { ...payload, sensitivity: 0.9 }));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.config.id).toBe(first.config.id);
    expect(store.configs.size).toBe(1);
    expect((await runAs(alice, () => configs.get('main'))).payload['sensitivity']).toBe(0.9);
  });

  it('list returns only the caller’s names, sorted', async () => {
    const alice = asUser(seedUser(store));
    const bob = asUser(seedUser(store));
    await runAs(alice, () => configs.put('zeta', payload));
    await runAs(alice, () => configs.put('alpha', payload));
    await runAs(bob, () => configs.put('bobs', payload));

    const names = (await runAs(alice, () => configs.list())).map((c) => c.name);
    expect(names).toEqual(['alpha', 'zeta']);
  });

  it('one user can neither read, overwrite nor delete another user’s profile with the same name', async () => {
    const alice = asUser(seedUser(store));
    const bob = asUser(seedUser(store));
    await runAs(alice, () => configs.put('main', payload));

    expect(await codeOf(runAs(bob, () => configs.get('main')))).toBe('NOT_FOUND');
    expect(await codeOf(runAs(bob, () => configs.remove('main')))).toBe('NOT_FOUND');
    const bobs = await runAs(bob, () => configs.put('main', { ...payload, sensitivity: 0.1 }));
    expect(bobs.created).toBe(true);
    expect((await runAs(alice, () => configs.get('main'))).payload['sensitivity']).toBe(0.5);
  });

  it('remove deletes; a second remove and a get → NOT_FOUND', async () => {
    const alice = asUser(seedUser(store));
    await runAs(alice, () => configs.put('main', payload));
    await runAs(alice, () => configs.remove('main'));
    expect(await codeOf(runAs(alice, () => configs.remove('main')))).toBe('NOT_FOUND');
    expect(await codeOf(runAs(alice, () => configs.get('main')))).toBe('NOT_FOUND');
  });
});

describe('ConfigPayload schema (strict)', () => {
  it('defaults fpsLimit to null and accepts boundary values', () => {
    const parsed = ConfigPayload.parse({
      sensitivity: 0,
      resolution: { width: 160, height: 4320 },
      smoothing: { algorithm: 'none', strength: 1 },
    });
    expect(parsed.fpsLimit).toBeNull();
  });

  it.each([
    ['sensitivity > 1', { sensitivity: 1.01 }],
    ['width below 160', { resolution: { width: 159, height: 1080 } }],
    ['fractional width', { resolution: { width: 1920.5, height: 1080 } }],
    ['unknown algorithm', { smoothing: { algorithm: 'median', strength: 0.1 } }],
    ['unknown top-level field', { extra: true }],
    ['unknown nested field', { resolution: { width: 1920, height: 1080, depth: 3 } }],
    ['fpsLimit 0', { fpsLimit: 0 }],
  ])('rejects %s', (_case, patch) => {
    expect(ConfigPayload.safeParse({ ...payload, ...patch }).success).toBe(false);
  });
});
