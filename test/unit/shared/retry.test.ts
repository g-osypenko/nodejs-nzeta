import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Backoff sleeps are recorded instead of waited for: deterministic and instant (spec §6.4).
const sleep = vi.hoisted(() => vi.fn(async (_ms: number): Promise<void> => undefined));
vi.mock('node:timers/promises', () => ({ setTimeout: sleep }));

const { withRetry } = await import('../../../src/shared/db/retry.js');

const transient = (): Error => Object.assign(new Error('deadlock'), { code: '40P01' });
const permanent = (): Error => Object.assign(new Error('unique'), { code: '23505' });

describe('withRetry', () => {
  beforeEach(() => {
    sleep.mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the first successful result without sleeping', async () => {
    const run = vi.fn(async () => 'ok');
    expect(await withRetry('op', run)).toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient errors with exponential backoff and succeeds', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce('ok');
    expect(await withRetry('op', run)).toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50, 100]);
  });

  it('adds jitter below the base delay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce('ok');
    await withRetry('op', run);
    expect(sleep.mock.calls[0]?.[0]).toBe(50 + 49);
  });

  it('gives up after 3 attempts and rethrows the last error', async () => {
    const last = transient();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(last);
    await expect(withRetry('op', run)).rejects.toBe(last);
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('never retries a non-transient error', async () => {
    const error = permanent();
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(error);
    await expect(withRetry('op', run)).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
