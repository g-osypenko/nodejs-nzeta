import type { FastifyPluginAsync } from 'fastify';
import { ConfigNameParams, PutConfigBody, toConfigDto } from './configs.schemas.js';
import type { ConfigsService } from './configs.service.js';

export function configsRoutes(configs: ConfigsService): FastifyPluginAsync {
  return async (app) => {
    app.get('/configs', async () =>
      (await configs.list()).map((c) => ({ name: c.name, updatedAt: c.updatedAt.toISOString() })),
    );

    app.get('/configs/:name', async (request) => {
      const { name } = ConfigNameParams.parse(request.params);
      return toConfigDto(await configs.get(name));
    });

    // 64 KiB is far above any real profile; rejects payload-flooding with 413.
    app.put('/configs/:name', { bodyLimit: 64 * 1024 }, async (request, reply) => {
      const { name } = ConfigNameParams.parse(request.params);
      const { payload } = PutConfigBody.parse(request.body);
      const { config, created } = await configs.put(name, payload);
      return reply.code(created ? 201 : 200).send(toConfigDto(config));
    });

    app.delete('/configs/:name', async (request, reply) => {
      const { name } = ConfigNameParams.parse(request.params);
      await configs.remove(name);
      return reply.code(204).send();
    });
  };
}
