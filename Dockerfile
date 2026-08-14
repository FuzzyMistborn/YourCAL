# Multi-stage build for the whole npm-workspaces monorepo (shared/server/client).
# The server serves the client's built static assets itself (see
# server/src/index.ts's @fastify/static registration against
# ../../client/dist), so this produces a single runtime image rather than
# separate server/client images.

FROM node:26-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 (a server dependency) compiles a native addon via
# node-gyp whenever no prebuilt binary matches this exact platform/arch/
# Node ABI -- installing these here guarantees `npm ci` succeeds either
# way; they're not present in the final runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy only the manifests first so this layer -- and the `npm ci` below --
# stays cached across rebuilds that only touch source files, not dependencies.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
# --legacy-peer-deps: typescript-eslint doesn't support TypeScript 7 yet
# (peer dep caps at <6.1.0). See AGENTS.md "Toolchain: TypeScript 7 vs.
# @typescript-eslint" for details.
RUN npm ci --legacy-peer-deps

COPY shared shared
COPY server server
COPY client client
RUN npm run build

# Drop devDependencies (typescript, vite, vitest, tsx, ...) -- keeps
# better-sqlite3's already-compiled native binary, since prune only
# removes package entries, not rebuild anything.
RUN npm prune --omit=dev

FROM node:26-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

# Default SQLITE_PATH (./data/cache.db, only used when CACHE_ENABLED=true)
# resolves relative to the CMD's cwd (/app) -- create it so a bind-mounted
# volume has somewhere to land even when the cache is off by default.
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
