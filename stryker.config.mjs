// Mutation testing (spec.md §6.3). Run: npm run test:mutation  (the "make mutation" of the course DoD)
// Report: reports/mutation/index.html; classification of survivors: docs/testing/mutation-report.md
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  // NB: @stryker-mutator/vitest-runner 10.0.0 predates vitest 5 — with vitest 5 every mutant ran
  // 0 tests and was reported "Survived" (score 24%). Hence vitest is pinned to 4.1.12 (ai/lab3/review.md).
  coverageAnalysis: 'perTest',
  mutate: [
    'src/modules/**/*.service.ts',
    'src/modules/loader/**/*.ts',
    '!src/modules/loader/loader.repository.postgres.ts', // SQL: covered by integration tests
    'src/shared/**/*.ts',
    '!src/shared/db/client.ts', // pool wiring: integration
    '!src/shared/db/migrat*.ts', // migrator: integration
    '!src/shared/db/rows.ts', // types only
    '!src/shared/db/memory-store.ts', // reference data
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: 80 },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
