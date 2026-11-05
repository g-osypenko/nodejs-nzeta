import { AsyncResource } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { Container } from './container.js';
import { authRoutes, createAuthHook } from './modules/auth/auth.routes.js';
import { configsRoutes } from './modules/configs/configs.routes.js';
import { licensesRoutes } from './modules/licenses/licenses.routes.js';
import { loaderRoutes } from './modules/loader/loader.routes.js';
import { createContext, runWithContext, type RequestContext } from './shared/context.js';
import { isDbUnavailable } from './shared/db/errors.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
  processId: string;
}

interface Mapped {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const FRAMEWORK_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

/** Translates any thrown value into an HTTP answer. The ONLY place where errors become responses. */
function mapError(error: unknown): Mapped {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Request validation failed', details };
  }
  if (isDbUnavailable(error)) {
    return { status: 503, code: 'DB_UNAVAILABLE', message: 'Database is temporarily unavailable' };
  }
  const fe = error as Partial<FastifyError>;
  if (typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    // Framework codes (FST_ERR_*) never leave the server: only spec.md §3 codes (spec §3 rule).
    const code = FRAMEWORK_CODES[fe.statusCode] ?? 'BAD_REQUEST';
    return { status: fe.statusCode, code, message: fe.message ?? 'Bad request' };
  }
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}

/** Fastify instance typed with our pino logger. */
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger
>;

export function buildApp(container: Container): App {
  const app = fastify({
    loggerInstance: logger,
    // Built-in request logs are replaced by the context-aware log line in onResponse.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
  });

  // --- request context (AsyncLocalStorage) ---------------------------------
  const contexts = new WeakMap<FastifyRequest, { ctx: RequestContext; resource: AsyncResource }>();
  const contextOf = (request: FastifyRequest): RequestContext =>
    contexts.get(request)?.ctx ?? createContext({ requestId: request.id });

  app.addHook('onRequest', (request, _reply, done) => {
    const header = request.headers['x-process-id'];
    const ctx = createContext(
      typeof header === 'string' && UUID_PATTERN.test(header)
        ? { requestId: request.id, processId: header }
        : { requestId: request.id },
    );
    runWithContext(ctx, () => {
      contexts.set(request, { ctx, resource: new AsyncResource('lch-request') });
      done();
    });
  });
  // Body parsing runs on socket events outside the store; re-enter it before validation/handler.
  app.addHook('preValidation', (request, _reply, done) => {
    const entry = contexts.get(request);
    if (entry) entry.resource.runInAsyncScope(done);
    else done();
  });

  app.addHook('onRequest', createAuthHook(container.services.auth));

  app.addHook('onSend', async (request, reply) => {
    const ctx = contextOf(request);
    reply.header('x-request-id', ctx.requestId).header('x-process-id', ctx.processId);
    if (container.config.debugHeaders) reply.header('x-db-queries', String(ctx.dbQueries));
  });

  app.addHook('onResponse', async (request, reply) => {
    const ctx = contextOf(request);
    runWithContext(ctx, () =>
      logger.info(
        {
          method: request.method,
          route: request.routeOptions.url ?? request.url,
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
          dbQueries: ctx.dbQueries,
        },
        'request completed',
      ),
    );
  });

  // --- the single global error handler -------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const ctx = contextOf(request);
    const mapped = mapError(error);
    runWithContext(ctx, () => {
      if (mapped.status >= 500) logger.error({ err: error }, 'request failed');
      else logger.info({ code: mapped.code, status: mapped.status }, 'request rejected');
    });
    const body: ErrorBody = {
      error:
        mapped.details === undefined
          ? { code: mapped.code, message: mapped.message }
          : { code: mapped.code, message: mapped.message, details: mapped.details },
      requestId: ctx.requestId,
      processId: ctx.processId,
    };
    if (mapped.status === 503) void reply.header('retry-after', '5');
    return reply.status(mapped.status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const ctx = contextOf(request);
    return reply.status(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
      requestId: ctx.requestId,
      processId: ctx.processId,
    });
  });

  // --- routes ---------------------------------------------------------------
  void app.register(cors, { origin: true });

  app.get('/version', async () => ({ status: 'OK', commit: container.config.gitCommit }));
  app.get('/health', async () => ({ status: 'OK', db: await container.checkHealth() }));

  const { services } = container;
  void app.register(
    async (api) => {
      await api.register(authRoutes(services.auth));
      await api.register(licensesRoutes(services.licenses));
      await api.register(configsRoutes(services.configs));
      await api.register(loaderRoutes(services.loader));
    },
    { prefix: '/api/v1' },
  );

  return app;
}
