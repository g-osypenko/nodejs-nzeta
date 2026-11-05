import { inject } from 'vitest';
import { createTestApp } from '../support/app.js';
import { describeApiContract } from '../support/api-contract.js';

describeApiContract('postgres', () =>
  createTestApp({ DATA_SOURCE: 'postgres', DATABASE_URL: inject('databaseUrl') }),
);
