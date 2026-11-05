import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/shared/db/migrations.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * One fresh Postgres per test run (never the developer's docker-compose DB on 55432):
 * Testcontainers picks a random free host port, migrations are applied from migrations/*.sql.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17.6-alpine',
  ).start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}
