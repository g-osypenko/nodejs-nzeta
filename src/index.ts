import dotenv from 'dotenv';
import { buildApp } from './app.js';
import { createContainer } from './container.js';
import { loadConfig } from './shared/config.js';
import { logger } from './shared/logger.js';

dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const config = loadConfig();
  // Fails fast: invalid env or an unreachable DB stops the process before it accepts traffic.
  const container = await createContainer(config);
  const app = buildApp(container);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await container.close();
    process.exit(0);
  };
  process.once('SIGINT', (s) => void shutdown(s));
  process.once('SIGTERM', (s) => void shutdown(s));

  await app.listen({ port: config.port, host: config.host });
  logger.info({ dataSource: config.dataSource, commit: config.gitCommit }, 'server started');
  if (config.mailer === 'console') {
    // ADR 0011: until the product has a domain, sign-in letters are not sent, only logged.
    logger.warn({ mailer: config.mailer }, 'sign-in emails are written to the log, not sent');
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
