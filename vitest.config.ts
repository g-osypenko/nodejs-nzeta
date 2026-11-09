import { defineConfig } from 'vitest/config';

// Workspace packages are tested and consumed from source (package.json "source" export condition);
// only production builds resolve their dist/ (ADR 0010).
// The rest is Vite's defaultServerConditions (vite is not a direct dependency).
const conditions = ['source', 'module', 'node', 'development|production'];

/**
 * Three test levels (spec.md §6) as Vitest projects:
 *   unit        — no I/O, in-memory repositories           → npm test
 *   integration — Postgres in Testcontainers + app.inject  → npm run test:integration
 *   e2e         — built server process + Postgres + fetch  → npm run test:e2e
 */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    setupFiles: ['test/support/silence-logs.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/support/postgres.global.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          globalSetup: ['test/support/postgres.global.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
      // Entry points and CLIs are exercised by smoke/e2e as processes, not in-process.
      exclude: ['src/index.ts', 'src/smoke.ts', 'src/seed.ts', 'src/shared/db/migrate.ts'],
      reporter: ['text-summary', 'text', 'html', 'json-summary'],
      reportsDirectory: 'reports/coverage',
      thresholds: {
        // spec.md §6.1
        'src/modules/loader/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/modules/**/*.service.ts': { branches: 90 },
        // The extracted library (spec §9.4): fully covered by its own tests on fakes.
        'packages/auth-core/src/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'src/shared/**': { branches: 90 },
      },
    },
  },
});
