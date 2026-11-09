import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { App } from './app.js';

/**
 * Same-origin frontend (ADR 0008): Fastify serves the built SPA (web/dist) next to /api/v1.
 * - Hashed build assets (/assets/*) never change under the same name → cached for a year.
 * - Everything else (index.html, favicon) is revalidated on every load, so a deploy is visible
 *   immediately and the page always references the current asset hashes.
 * - Unknown GET paths that a browser navigates to (Accept: text/html) get index.html: client-side
 *   routes like /licenses work on reload. API paths and non-HTML requests keep the JSON 404.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export function registerWeb(app: App, dir: string): void {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`WEB_DIST_DIR has no index.html: ${root} (run npm run web:build)`);
  }
  void app.register(fastifyStatic, {
    root,
    // One route per file found at startup: unknown paths fall through to the not-found handler.
    wildcard: false,
    cacheControl: false,
    setHeaders: (reply, path) => {
      void reply.header(
        'cache-control',
        path.includes(`${sep}assets${sep}`) ? IMMUTABLE : REVALIDATE,
      );
    },
  });
}

/** A browser navigation to a client-side route (not an API call, not an asset request). */
export function isSpaNavigation(request: FastifyRequest): boolean {
  return (
    request.method === 'GET' &&
    !request.url.startsWith('/api/') &&
    (request.headers.accept ?? '').includes('text/html')
  );
}

export function sendSpaShell(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', REVALIDATE).sendFile('index.html');
}
