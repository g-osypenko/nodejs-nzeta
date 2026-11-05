import type { AppConfig } from './shared/config.js';
import { createMemoryStore } from './shared/db/memory-store.js';
import type { AuthRepository } from './modules/auth/auth.repository.js';
import { createMemoryAuthRepository } from './modules/auth/auth.repository.memory.js';
import { createAuthService, type AuthService } from './modules/auth/auth.service.js';
import type { ConfigsRepository } from './modules/configs/configs.repository.js';
import { createMemoryConfigsRepository } from './modules/configs/configs.repository.memory.js';
import { createConfigsService, type ConfigsService } from './modules/configs/configs.service.js';
import type { LicensesRepository } from './modules/licenses/licenses.repository.js';
import { createMemoryLicensesRepository } from './modules/licenses/licenses.repository.memory.js';
import {
  createLicensesService,
  type LicensesService,
} from './modules/licenses/licenses.service.js';
import type { LoaderRepository } from './modules/loader/loader.repository.js';
import { createMemoryLoaderRepository } from './modules/loader/loader.repository.memory.js';
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

/**
 * Composition root (ADR 0005): the only place that knows concrete implementations.
 * One implementation per run, chosen by DATA_SOURCE.
 */
export async function createContainer(config: AppConfig): Promise<Container> {
  if (config.dataSource !== 'memory') {
    throw new Error(`DATA_SOURCE=${config.dataSource} is not implemented yet`);
  }
  const data = createMemoryDataLayer();
  const { repos } = data;

  const services: Services = {
    auth: createAuthService({ repo: repos.auth, sessionTtlHours: config.sessionTtlHours }),
    licenses: createLicensesService({
      repo: repos.licenses,
      owners: { findEmail: async (id) => (await repos.auth.findUserById(id))?.email ?? null },
      webhookSecret: config.webhookSecret,
    }),
    configs: createConfigsService({ repo: repos.configs }),
    loader: createLoaderService({ repo: repos.loader }),
  };

  await services.auth.ensureAdmin(config.admin.email, config.admin.password);

  return { config, services, checkHealth: data.checkHealth, close: data.close };
}
