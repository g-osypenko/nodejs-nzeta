import { requireUser } from '../../shared/context.js';
import type { ConfigRow } from '../../shared/db/rows.js';
import { notFound } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import type { ConfigsRepository } from './configs.repository.js';
import type { ConfigPayload } from './configs.schemas.js';

export interface ConfigsService {
  list(): Promise<Pick<ConfigRow, 'name' | 'updatedAt'>[]>;
  get(name: string): Promise<ConfigRow>;
  put(name: string, payload: ConfigPayload): Promise<{ config: ConfigRow; created: boolean }>;
  remove(name: string): Promise<void>;
}

/** Every operation is scoped to the current user: a user can never address another user's profile. */
export function createConfigsService({ repo }: { repo: ConfigsRepository }): ConfigsService {
  const service: ConfigsService = {
    list() {
      return repo.listNames(requireUser().id);
    },

    async get(name) {
      const config = await repo.find(requireUser().id, name);
      if (!config) throw notFound('Config');
      return config;
    },

    async put(name, payload) {
      const result = await repo.upsert(requireUser().id, name, payload);
      logger.info({ configName: name, created: result.created }, 'config saved');
      return result;
    },

    async remove(name) {
      const deleted = await repo.delete(requireUser().id, name);
      if (!deleted) throw notFound('Config');
    },
  };
  return service;
}
