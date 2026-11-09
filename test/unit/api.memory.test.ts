import { createTestApp } from '../support/app.js';
import { describeApiContract } from '../support/api-contract.js';

describeApiContract('memory (static prototype)', () => createTestApp());
