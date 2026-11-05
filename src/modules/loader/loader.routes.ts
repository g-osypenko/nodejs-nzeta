import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LICENSE_KEY_PATTERN } from '../../shared/license-key.js';
import type { LoaderService } from './loader.service.js';

const HandshakeBody = z.object({
  license_key: z.string().regex(LICENSE_KEY_PATTERN, 'Expected APP-XXXX-XXXX-XXXX'),
  hwid: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/),
});

export function loaderRoutes(loader: LoaderService): FastifyPluginAsync {
  return async (app) => {
    app.post('/loader/handshake', async (request) => {
      const body = HandshakeBody.parse(request.body);
      const result = await loader.handshake(body.license_key, body.hwid);
      return {
        status: 'OK',
        action: result.action,
        expires_at: result.expiresAt?.toISOString() ?? null,
      };
    });
  };
}
