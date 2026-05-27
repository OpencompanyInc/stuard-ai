# Cloud AI Dockerfile
# Built from the MONOREPO ROOT context — see release-*.yml:
#   docker build -f apps/cloud-ai/Dockerfile .
#
# Uses pnpm because cloud-ai depends on @stuardai/* workspace packages
# (workspace:* — npm cannot resolve that protocol outside a workspace). Those
# packages ship raw TS; the build inlines them into the bundle (tsup
# `noExternal`), so only third-party deps need to be present at runtime.

FROM node:22-slim AS base
WORKDIR /workspace

# Build tools for native modules (better-sqlite3, which stays external).
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8 --activate

# Copy the whole workspace. node_modules / dist / .turbo are excluded by the
# repo-root .dockerignore, so this brings in source + the lockfile only — which
# pnpm needs to resolve the @stuardai/* workspace graph.
COPY . .

# Install just cloud-ai's subtree (+ the workspace packages it depends on) and
# build the self-contained bundle.
RUN pnpm install --filter @stuardai/cloud-ai... --no-frozen-lockfile
RUN pnpm --filter @stuardai/cloud-ai run build

ENV NODE_ENV=production
# Persistent data directory for SQLite (mount a volume here in Cloud Run).
ENV STUARD_DATA_DIR=/workspace/apps/cloud-ai/.data
RUN mkdir -p /workspace/apps/cloud-ai/.data

WORKDIR /workspace/apps/cloud-ai
EXPOSE 8082
CMD ["node", "dist/server.js"]
