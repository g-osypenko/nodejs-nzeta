import { setTimeout as sleep } from 'node:timers/promises';
import { logger } from '../logger.js';
import { isTransientDbError } from './errors.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 50;

/**
 * Re-runs an operation on transient DB errors (spec.md §4.7) with exponential backoff + jitter.
 * ONLY for idempotent operations: after a dropped connection we cannot know whether COMMIT
 * reached the server, so the operation must be safe to apply twice (idempotency key,
 * ON CONFLICT, conditional UPDATE).
 */
export async function withRetry<T>(operation: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientDbError(error)) throw error;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * BASE_DELAY_MS);
      logger.warn({ err: error, operation, attempt, delay }, 'transient db error, retrying');
      await sleep(delay);
    }
  }
}
