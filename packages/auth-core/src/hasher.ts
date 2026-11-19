import {
  AuthError,
  type HasherStats,
  type HashingLimits,
  type PasswordHasher,
  type PasswordKdf,
} from './contract.js';

/**
 * Admission control around a CPU-heavy KDF (spec.md §9, ADR 0010).
 *
 * Measured on the perf stand (docs/perf/load-baseline.md): one scrypt costs ~23 ms of CPU, ~45×
 * a license handshake. Unbounded, 60 logins/s ran 4 scrypts at once on the libuv threadpool and
 * took the single core away from the event loop: handshake p99 1.6 → 86 ms, logins 6.4 s.
 * Bounded, at most `maxConcurrent` derivations run; up to `maxQueued` wait in FIFO order;
 * the rest fail immediately with AUTH_BUSY instead of joining an ever-growing queue.
 */
export function createPasswordHasher(kdf: PasswordKdf, limits: HashingLimits): PasswordHasher {
  if (!Number.isInteger(limits.maxConcurrent) || limits.maxConcurrent < 1) {
    throw new RangeError('maxConcurrent must be a positive integer');
  }
  if (!Number.isInteger(limits.maxQueued) || limits.maxQueued < 0) {
    throw new RangeError('maxQueued must be a non-negative integer');
  }

  let running = 0;
  let rejected = 0;
  const waiting: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (running < limits.maxConcurrent) {
      running += 1;
      return;
    }
    if (waiting.length >= limits.maxQueued) {
      rejected += 1;
      throw new AuthError('AUTH_BUSY', 'Too many sign-ins at once, retry shortly');
    }
    // The slot is handed over by release(): `running` stays the same for the woken waiter.
    await new Promise<void>((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  const limited = async <T>(work: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await work();
    } finally {
      release();
    }
  };

  return {
    hash: async (password) => limited(() => kdf.hash(password)),
    verify: async (password, encoded) => limited(() => kdf.verify(password, encoded)),
    stats: (): HasherStats => ({ running, queued: waiting.length, rejected }),
  };
}
