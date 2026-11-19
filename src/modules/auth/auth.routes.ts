import type { FastifyPluginAsync, FastifyRequest, onRequestHookHandler } from 'fastify';
import { setCurrentUser } from '../../shared/context.js';
import { CredentialsBody, toUserDto } from './auth.schemas.js';
import type { AuthService } from '@lch/auth-core';

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Transport-level authentication: resolves the bearer token and puts the user into the request context. */
export function createAuthHook(auth: AuthService): onRequestHookHandler {
  return async (request) => {
    const token = bearerToken(request);
    if (!token) return;
    const user = await auth.authenticate(token);
    if (user) setCurrentUser(user);
  };
}

export function authRoutes(auth: AuthService): FastifyPluginAsync {
  return async (app) => {
    app.post('/auth/register', async (request, reply) => {
      const user = await auth.register(CredentialsBody.parse(request.body));
      return reply.code(201).send(toUserDto(user));
    });

    app.post('/auth/login', async (request) => {
      const session = await auth.login(CredentialsBody.parse(request.body));
      return { token: session.token, expiresAt: session.expiresAt.toISOString() };
    });

    app.post('/auth/logout', async (request, reply) => {
      await auth.logout(bearerToken(request) ?? '');
      return reply.code(204).send();
    });

    app.get('/auth/me', async () => toUserDto(await auth.me()));
  };
}
