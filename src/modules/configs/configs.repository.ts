import type { ConfigRow, JsonObject } from '../../shared/db/rows.js';

export interface ConfigsRepository {
  listNames(userId: string): Promise<Pick<ConfigRow, 'name' | 'updatedAt'>[]>;
  find(userId: string, name: string): Promise<ConfigRow | null>;
  /** Insert-or-replace by (userId, name): idempotent, safe to retry. */
  upsert(
    userId: string,
    name: string,
    payload: JsonObject,
  ): Promise<{ config: ConfigRow; created: boolean }>;
  delete(userId: string, name: string): Promise<boolean>;
}
