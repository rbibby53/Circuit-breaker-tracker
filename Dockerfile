# syntax=docker/dockerfile:1

# ---- Build the web app and the server bundle --------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @cbt/web build && pnpm --filter @cbt/server build

# ---- Install only the native modules the bundle keeps external --------------------------
FROM node:22-bookworm-slim AS native
WORKDIR /app
# Build tools are a fallback in case no prebuilt better-sqlite3 binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY apps/server/package.json /tmp/server-package.json
RUN node -e "\
  const d = require('/tmp/server-package.json').dependencies; \
  const keep = ['better-sqlite3', '@node-rs/argon2']; \
  require('fs').writeFileSync('package.json', JSON.stringify({ name: 'cbt-runtime', private: true, \
    dependencies: Object.fromEntries(keep.map((k) => [k, d[k]])) }));" \
  && npm install --omit=dev --no-audit --no-fund

# ---- Runtime ----------------------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=native /app/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
