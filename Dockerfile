# syntax=docker/dockerfile:1
# Production image of License & Config Hub (spec.md §8, ADR 0006).
# The same image runs the app (CMD) and the migration/seed steps of CD:
#   docker run --rm -e DATABASE_URL=… <image> node dist/shared/db/migrate.js --phase=schema

ARG NODE_IMAGE=node:22.23.4-alpine3.24

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Workspace manifests first: npm ci links packages/* into node_modules (ADR 0010).
COPY packages/auth-core/package.json ./packages/auth-core/
# --ignore-scripts: no husky `prepare` inside the image
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY packages ./packages
COPY src ./src
# Builds @lch/auth-core (dist/) first, then the app against its published types.
RUN npm run build

# Frontend (web/, ADR 0008): built here, served by Fastify from /app/public.
FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web ./
RUN npm run build

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/auth-core/package.json ./packages/auth-core/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/public
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# node_modules/@lch/auth-core is a symlink to packages/auth-core: ship its manifest and build only.
COPY --from=build /app/packages/auth-core/package.json ./packages/auth-core/package.json
COPY --from=build /app/packages/auth-core/dist ./packages/auth-core/dist
COPY package.json ./
COPY migrations ./migrations
COPY --from=web /web/dist ./public
# SHA of the deployed commit → GET /version (spec.md §8, CD criterion 2)
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
USER node
EXPOSE 3000
# Liveness only (no DB): readiness for traffic switching is the platform health check on /health.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/version" >/dev/null || exit 1
CMD ["node", "dist/index.js"]
