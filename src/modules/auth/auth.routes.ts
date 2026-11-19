import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from 'fastify';
import type { AuthService, IssuedSession } from '@lch/auth-core';
import { setCurrentUser } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import {
  CodeRequestBody,
  CodeVerifyBody,
  LinkVerifyBody,
  toUserDto,
  type UserDto,
} from './auth.schemas.js';

/** httpOnly session cookie (ADR 0011): the browser keeps it, page scripts cannot read it. */
export const SESSION_COOKIE = 'lch_session';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AuthTransportOptions {
  /** Origin cookie-authenticated mutations must come from; `null` = the request's own host. */
  allowedOrigin: string | null;
  /** Reads the session cookie (the cookie plugin's parser, injected by app.ts). */
  sessionCookie(request: FastifyRequest): string | null;
}

function originAllowed(origin: string, request: FastifyRequest, allowed: string | null): boolean {
  if (allowed !== null) return origin === allowed;
  try {
    // Host header parsed with the Origin's scheme, so default ports compare equal (:80 == none).
    const page = new URL(origin);
    return page.host === new URL(`${page.protocol}//${request.headers.host ?? ''}`).host;
  } catch {
    return false; // "null" or garbage
  }
}

/**
 * CSRF guard (ADR 0011, OWASP "verify origin with standard headers"):
 *  - a mutation that names a foreign Origin is rejected, whatever it authenticates with;
 *  - a mutation authenticated by the cookie must prove it is same-origin (Origin or Sec-Fetch-Site).
 * Service calls without a session and without an Origin (the loader, the payment webhook) pass.
 */
function assertSameOrigin(
  request: FastifyRequest,
  usesCookie: boolean,
  allowed: string | null,
): void {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (originAllowed(origin, request, allowed)) return;
    throw new AppError('FORBIDDEN', 'Cross-site request rejected');
  }
  if (usesCookie && request.headers['sec-fetch-site'] !== 'same-origin') {
    throw new AppError('FORBIDDEN', 'Cross-site request rejected');
  }
}

/** Transport-level authentication: the session cookie, resolved to the user of the request context. */
export function createAuthHook(
  auth: AuthService,
  opts: AuthTransportOptions,
): onRequestHookHandler {
  return async (request) => {
    const token = opts.sessionCookie(request);
    assertSameOrigin(request, token !== null, opts.allowedOrigin);
    if (!token) return;
    const user = await auth.authenticate(token);
    if (user) setCurrentUser(user);
  };
}

export interface CookieSettings {
  secure: boolean;
}

interface SignedIn {
  user: UserDto;
  expiresAt: string;
}

export function authRoutes(auth: AuthService, cookie: CookieSettings): FastifyPluginAsync {
  const startSession = (reply: FastifyReply, session: IssuedSession): SignedIn => {
    void reply.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cookie.secure,
      expires: session.expiresAt,
    });
    return { user: toUserDto(session.user), expiresAt: session.expiresAt.toISOString() };
  };

  return async (app) => {
    // Passwordless sign-in (ADR 0011): the first sign-in of an email creates the account.
    app.post('/auth/code', async (request, reply) => {
      const { email } = CodeRequestBody.parse(request.body);
      const { expiresAt } = await auth.requestCode(email);
      return reply.code(202).send({ expiresAt: expiresAt.toISOString() });
    });

    app.post('/auth/code/verify', async (request, reply) => {
      const { email, code } = CodeVerifyBody.parse(request.body);
      return startSession(reply, await auth.verifyCode(email, code));
    });

    app.post('/auth/link/verify', async (request, reply) => {
      const { token } = LinkVerifyBody.parse(request.body);
      return startSession(reply, await auth.verifyLink(token));
    });

    app.post('/auth/logout', async (request, reply) => {
      await auth.logout(request.cookies[SESSION_COOKIE] ?? '');
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    });

    app.get('/auth/me', async () => toUserDto(await auth.me()));
  };
}
