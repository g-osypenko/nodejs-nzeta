import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

const strictTs = {
  ...tsPlugin.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-function-return-type': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: [
      'packages/*/dist/**',
      'dist/**',
      'node_modules/**',
      'reports/**',
      '.stryker-tmp/**',
      'web/dist/**',
      'web/node_modules/**',
    ],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'packages/*/{src,test}/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.json' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: strictTs,
  },
  {
    // Library boundary (spec.md §9.4, ADR 0010): a package knows no implementation and no host.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/*', '../../*'],
              message: 'A package must not import the host application.',
            },
            {
              group: ['node:*'],
              message: 'Runtime resources come in through ports (DI), not node:* imports.',
            },
          ],
          paths: ['postgres', 'fastify', 'pino', 'zod', 'crypto', 'fs'].map((name) => ({
            name,
            message: 'Implementations belong to the host; the package depends on ports only.',
          })),
        },
      ],
    },
  },
  {
    // Frontend (web/): the same strict TS rules + the rules of hooks.
    files: ['web/src/**/*.{ts,tsx}', 'web/vite.config.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './web/tsconfig.json', ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tsPlugin, 'react-hooks': reactHooks },
    rules: {
      ...strictTs,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
