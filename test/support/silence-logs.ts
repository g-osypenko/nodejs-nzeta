import { logger } from '../../src/shared/logger.js';

// Tests assert behaviour, not log output; set TEST_LOG_LEVEL=debug to see logs while debugging.
logger.level = process.env['TEST_LOG_LEVEL'] ?? 'silent';
