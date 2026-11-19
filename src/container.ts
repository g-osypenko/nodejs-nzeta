import type { AppConfig } from './shared/config.js';
import { assertDbReachable, createDb } from './shared/db/client.js';
import { createMemoryStore } from './shared/db/memory-store.js';
import type { AuthRepository } from './modules/auth/auth.repository.js';
import { createMemoryAuthRepository } from './modules/auth/auth.repository.memory.js';
import { createPostgresAuthRepository } from './modules/auth/auth.repository.postgres.js';
import type { AuthService } from '@lch/auth-core';
import { createAppAuth } from './modules/auth/auth.adapters.js';
import type { ConfigsRepository } from './modules/configs/configs.repository.js';
import { createMemoryConfigsRepository } from './modules/configs/configs.repository.memory.js';
import { createPostgresConfigsRepository } from './modules/configs/configs.repository.postgres.js';
import { createConfigsService, type ConfigsService } from './modules/configs/configs.service.js';
import type { LicensesRepository } from './modules/licenses/licenses.repository.js';
import { createMemoryLicensesRepository } from './modules/licenses/licenses.repository.memory.js';
import { createPostgresLicensesRepository } from './modules/licenses/licenses.repository.postgres.js';
import {
  createLicensesService,
  type LicensesService,
} from './modules/licenses/licenses.service.js';
import type { LoaderRepository } from './modules/loader/loader.repository.js';
import { createMemoryLoaderRepository } from './modules/loader/loader.repository.memory.js';
import { createPostgresLoaderRepository } from './modules/loader/loader.repository.postgres.js';
import { createLoaderService, type LoaderService } from './modules/loader/loader.service.js';

export interface Repositories {
  auth: AuthRepository;
  licenses: LicensesRepository;
  configs: ConfigsRepository;
  loader: LoaderRepository;
}

export interface Services {
  auth: AuthService;
  licenses: LicensesService;
  configs: ConfigsService;
  loader: LoaderService;
}

export interface Container {
  config: AppConfig;
  services: Services;
  /** Throws if a backing resource is unavailable (used by GET /health). */
  checkHealth(): Promise<'memory' | 'up'>;
  close(): Promise<void>;
}

interface DataLayer {
  repos: Repositories;
  checkHealth(): Promise<'memory' | 'up'>;
  close(): Promise<void>;
}

function createMemoryDataLayer(): DataLayer {
  const store = createMemoryStore();
  return {
    repos: {
      auth: createMemoryAuthRepository(store),
      licenses: createMemoryLicensesRepository(store),
      configs: createMemoryConfigsRepository(store),
      loader: createMemoryLoaderRepository(store),
    },
    checkHealth: async () => 'memory',
    close: async () => undefined,
  };
}

async function createPostgresDataLayer(config: AppConfig): Promise<DataLayer> {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for DATA_SOURCE=postgres');
  const sql = createDb({
    url: config.databaseUrl,
    max: config.dbPoolMax,
    statementTimeoutMs: config.dbStatementTimeoutMs,
  });
  // Fail fast: explicit pool initialisation + SELECT now() before the server accepts traffic.
  await assertDbReachable(sql).catch(async (err: unknown) => {
    await sql.end({ timeout: 1 });
    throw new Error('Database is unreachable at startup', { cause: err });
  });
  const layer: DataLayer = {
    repos: {
      auth: createPostgresAuthRepository(sql),
      licenses: createPostgresLicensesRepository(sql),
      configs: createPostgresConfigsRepository(sql),
      loader: createPostgresLoaderRepository(sql),
    },
    checkHealth: async () => {
      await sql`SELECT 1`;
      return 'up';
    },
    close: () => sql.end({ timeout: 5 }),
  };
  return layer;
}

/**
 * Composition root (ADR 0005): the only place that knows concrete implementations.
 * One implementation per run, chosen by DATA_SOURCE.
 */
export async function createContainer(config: AppConfig): Promise<Container> {
  const data =
    config.dataSource === 'postgres'
      ? await createPostgresDataLayer(config)
      : createMemoryDataLayer();
  const { repos } = data;

  const services: Services = {
    auth: createAppAuth({
      store: repos.auth,
      sessionTtlHours: config.sessionTtlHours,
      hashing: config.authHashing,
    }).service,
    licenses: createLicensesService({
      repo: repos.licenses,
      webhookSecret: config.webhookSecret,
    }),
    configs: createConfigsService({ repo: repos.configs }),
    loader: createLoaderService({ repo: repos.loader }),
  };

  await services.auth.ensureAdmin(config.admin.email, config.admin.password);

  return { config, services, checkHealth: data.checkHealth, close: data.close };
}
