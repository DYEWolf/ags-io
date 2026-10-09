# syntax=docker/dockerfile:1
# Una sola imagen para `web` y `worker` (distinto command). Se endurece en M5 (T5.1).

ARG NODE_VERSION=22.21.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION=12.3.4
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Corepack de Node 22 no soporta el paquete de pnpm 12; se instala con npm (misma versión que packageManager).
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /app

# --- dependencias completas (build) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# --- build: cliente/SSR de Vite + entrypoints de Node ---
FROM deps AS build
COPY . .
RUN pnpm build

# --- dependencias de producción ---
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# --- runtime ---
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production TZ=UTC APP_VERSION=${APP_VERSION} NODE_OPTIONS=--enable-source-maps \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Chromium headless shell + sus librerías del sistema para el auditor (R-030). Va antes del
# código de la app para que esta capa solo se rehaga cuando cambian las dependencias.
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node src/db/migrations ./src/db/migrations
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/node/web.mjs"]
