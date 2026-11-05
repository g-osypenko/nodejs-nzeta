import { defineConfig } from 'vitest/config';

/** Test set used by Stryker for every mutant: the unit level only (no Docker, deterministic, < 2 s). */
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/support/silence-logs.ts'],
  },
});
