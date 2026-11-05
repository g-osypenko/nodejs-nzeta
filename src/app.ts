import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: true,
  });

  void app.register(cors, { origin: true });

  app.get('/version', async () => {
    return {
      status: 'OK',
      commit: process.env['GIT_COMMIT'] ?? 'dev-local',
    };
  });

  return app;
}
