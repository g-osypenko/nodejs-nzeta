import type { Db } from '../../shared/db/client.js';
import { withRetry } from '../../shared/db/retry.js';
import type { ConfigRow } from '../../shared/db/rows.js';
import type { ConfigsRepository } from './configs.repository.js';

export function createPostgresConfigsRepository(sql: Db): ConfigsRepository {
  const repository: ConfigsRepository = {
    async listNames(userId) {
      return sql<Pick<ConfigRow, 'name' | 'updatedAt'>[]>`
        SELECT name, updated_at FROM user_configs WHERE user_id = ${userId} ORDER BY name`;
    },

    async find(userId, name) {
      const [row] = await sql<ConfigRow[]>`
        SELECT * FROM user_configs WHERE user_id = ${userId} AND name = ${name}`;
      return row ?? null;
    },

    upsert(userId, name, payload) {
      return withRetry('upsertConfig', async () => {
        // xmax = 0 only for a freshly inserted row version → tells insert from update in one statement.
        const [row] = await sql<(ConfigRow & { inserted: boolean })[]>`
          INSERT INTO user_configs (user_id, name, payload)
          VALUES (${userId}, ${name}, ${sql.json(payload)})
          ON CONFLICT (user_id, name)
          DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
          RETURNING *, (xmax = 0) AS inserted`;
        if (!row) throw new Error('upsert returned no row');
        const { inserted, ...config } = row;
        return { config, created: inserted };
      });
    },

    async delete(userId, name) {
      const rows = await sql`
        DELETE FROM user_configs WHERE user_id = ${userId} AND name = ${name} RETURNING id`;
      return rows.length > 0;
    },
  };
  return repository;
}
