import { defineConfig } from 'vitest/config';

// Same resolution as vitest.config.ts: workspace packages from source. Without it the app's tests
// imported @lch/auth-core from dist/, no test ever ran a mutant of packages/*/src and Stryker
// reported 0 % killed there at 100 % coverage (ai/lab5/review.md).
const conditions = ['source', 'module', 'node', 'development|production'];

/** Test set used by Stryker for every mutant: the unit level only (no Docker, deterministic, < 2 s). */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/unit/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    setupFiles: ['test/support/silence-logs.ts'],
  },
});
