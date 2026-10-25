# syntax=docker/dockerfile:1

# ---- Build the web app and the server bundle --------------------------------------------
FROM node:24-trixie-slim AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# The pnpm version pinned in package.json ("packageManager").
RUN npm install -g --no-audit --no-fund "$(node -p "require('./package.json').packageManager")"
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
# Shown in the app; CI passes the release tag. Defaults to the version in package.json.
ARG APP_VERSION=
RUN APP_VERSION=$APP_VERSION pnpm --filter @cbt/web build && APP_VERSION=$APP_VERSION pnpm --filter @cbt/server build

# ---- Install only the modules the bundle keeps external ---------------------------------
FROM node:24-trixie-slim AS native
WORKDIR /app
# Build tools are a fallback in case no prebuilt better-sqlite3 binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY apps/server/package.json /tmp/server-package.json
RUN node -e "\
  const d = require('/tmp/server-package.json').dependencies; \
  const keep = ['better-sqlite3', '@node-rs/argon2', 'pdfkit']; \
  require('fs').writeFileSync('package.json', JSON.stringify({ name: 'cbt-runtime', private: true, \
    dependencies: Object.fromEntries(keep.map((k) => [k, d[k]])) }));" \
  && npm install --omit=dev --no-audit --no-fund

# ---- Runtime ----------------------------------------------------------------------------
FROM node:24-trixie-slim
ENV NODE_ENV=production \
    PORT=2757 \
    DATA_DIR=/data \
    WEB_DIST=/app/web
WORKDIR /app
# Pick up Debian security fixes newer than the base image, and drop npm/corepack: the
# server only needs `node`, and npm's bundled modules are the bulk of the image's CVEs.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=native /app/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 2757
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2757) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
