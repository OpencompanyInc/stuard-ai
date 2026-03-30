# Cloud AI Dockerfile
# Build and run the TypeScript server from the monorepo root context with Node 22

FROM node:22-slim AS base
WORKDIR /workspace/apps/cloud-ai

# Build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY apps/cloud-ai/package.json apps/cloud-ai/tsconfig.json ./
COPY apps/cloud-ai/src ./src
COPY shared /workspace/shared

# Install dev deps to build, then prune to production
RUN npm install --legacy-peer-deps && npm run build && npm prune --omit=dev --legacy-peer-deps

ENV NODE_ENV=production
# Persistent data directory for SQLite (mount a volume here in Cloud Run)
ENV STUARD_DATA_DIR=/workspace/apps/cloud-ai/.data
RUN mkdir -p /workspace/apps/cloud-ai/.data
EXPOSE 8082
CMD ["node", "dist/server.js"]
