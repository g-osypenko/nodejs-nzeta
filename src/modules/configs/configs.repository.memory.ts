import { randomUUID } from 'node:crypto';
import type { MemoryStore } from '../../shared/db/memory-store.js';
import type { ConfigRow } from '../../shared/db/rows.js';
import type { ConfigsRepository } from './configs.repository.js';

export function createMemoryConfigsRepository(store: MemoryStore): ConfigsRepository {
  const find = (userId: string, name: string): ConfigRow | undefined =>
    [...store.configs.values()].find((c) => c.userId === userId && c.name === name);

  const repository: ConfigsRepository = {
    async listNames(userId) {
      return [...store.configs.values()]
        .filter((c) => c.userId === userId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, updatedAt }) => ({ name, updatedAt }));
    },

    async find(userId, name) {
      return find(userId, name) ?? null;
    },

    async upsert(userId, name, payload) {
      const existing = find(userId, name);
      const config: ConfigRow = {
        id: existing?.id ?? randomUUID(),
        userId,
        name,
        payload,
        updatedAt: new Date(),
      };
      store.configs.set(config.id, config);
      return { config, created: existing === undefined };
    },

    async delete(userId, name) {
      const existing = find(userId, name);
      return existing ? store.configs.delete(existing.id) : false;
    },
  };
  return repository;
}
