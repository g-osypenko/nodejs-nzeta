import { describe, expect, it } from 'vitest';
import { AuthError, createPasswordHasher, type PasswordKdf } from '../src/index.js';

/** A KDF whose calls finish only when the test says so: concurrency becomes observable. */
function controllableKdf(): PasswordKdf & {
  started: string[];
  finish: (password: string, error?: Error) => void;
} {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  const started: string[] = [];
  const call = (password: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      started.push(password);
      pending.set(password, { resolve, reject });
    });
  return {
    started,
    hash: call,
    verify: async (password: string, encoded: string): Promise<boolean> =>
      (await call(password)) === encoded,
    finish: (password: string, error?: Error): void => {
      const p = pending.get(password);
      if (!p) throw new Error(`no pending call for ${password}`);
      pending.delete(password);
      if (error) p.reject(error);
      else p.resolve(`hash:${password}`);
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('password hasher with admission control', () => {
  it('runs at most maxConcurrent KDF calls; the next waiter starts as soon as a slot frees', async () => {
    const kdf = controllableKdf();
    const hasher = createPasswordHasher(kdf, { maxConcurrent: 2, maxQueued: 5 });
    const results = ['a', 'b', 'c', 'd'].map((p) => hasher.hash(p));
    await tick();
    expect(kdf.started).toEqual(['a', 'b']);
    expect(hasher.stats()).toEqual({ running: 2, queued: 2, rejected: 0 });

    kdf.finish('b');
    await tick();
    expect(kdf.started).toEqual(['a', 'b', 'c']); // FIFO: c before d
    expect(hasher.stats()).toMatchObject({ running: 2, queued: 1 });

    kdf.finish('a');
    kdf.finish('c');
    await tick();
    kdf.finish('d');
    expect(await Promise.all(results)).toEqual(['hash:a', 'hash:b', 'hash:c', 'hash:d']);
    expect(hasher.stats()).toEqual({ running: 0, queued: 0, rejected: 0 });
  });

  it('beyond maxQueued a call fails fast with AUTH_BUSY and never reaches the KDF', async () => {
    const kdf = controllableKdf();
    const hasher = createPasswordHasher(kdf, { maxConcurrent: 1, maxQueued: 1 });
    const first = hasher.hash('a');
    const second = hasher.hash('b');
    const third = hasher.verify('c', 'hash:c');

    await expect(third).rejects.toBeInstanceOf(AuthError);
    await expect(third).rejects.toMatchObject({
      code: 'AUTH_BUSY',
      message: 'Too many sign-ins at once, retry shortly',
    });
    expect(hasher.stats()).toEqual({ running: 1, queued: 1, rejected: 1 });

    kdf.finish('a');
    await tick();
    kdf.finish('b');
    await Promise.all([first, second]);
    expect(kdf.started).toEqual(['a', 'b']);
  });

  it('a failing KDF call releases its slot (no leaked capacity)', async () => {
    const kdf = controllableKdf();
    const hasher = createPasswordHasher(kdf, { maxConcurrent: 1, maxQueued: 1 });
    const failing = hasher.hash('a');
    const next = hasher.verify('b', 'hash:b');
    await tick(); // the hasher acquires the slot asynchronously before calling the KDF
    kdf.finish('a', new Error('kdf exploded'));
    await expect(failing).rejects.toThrow('kdf exploded');
    await tick();
    kdf.finish('b');
    expect(await next).toBe(true);
    expect(hasher.stats()).toEqual({ running: 0, queued: 0, rejected: 0 });
  });

  it('maxQueued = 0: no waiting at all, only maxConcurrent calls at a time', async () => {
    const kdf = controllableKdf();
    const hasher = createPasswordHasher(kdf, { maxConcurrent: 1, maxQueued: 0 });
    const first = hasher.hash('a');
    await expect(hasher.hash('b')).rejects.toMatchObject({ code: 'AUTH_BUSY' });
    kdf.finish('a');
    await first;
  });

  it('rejects nonsensical limits at construction, not on the first sign-in', () => {
    const kdf = controllableKdf();
    expect(() => createPasswordHasher(kdf, { maxConcurrent: 0, maxQueued: 1 })).toThrow(
      'maxConcurrent must be a positive integer',
    );
    expect(() => createPasswordHasher(kdf, { maxConcurrent: 1.5, maxQueued: 1 })).toThrow(
      RangeError,
    );
    expect(() => createPasswordHasher(kdf, { maxConcurrent: 1, maxQueued: -1 })).toThrow(
      'maxQueued must be a non-negative integer',
    );
  });
});
