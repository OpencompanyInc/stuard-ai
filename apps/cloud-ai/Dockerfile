# Cloud AI Dockerfile
# Build and run the TypeScript server with Node 20

FROM node:20-slim AS base
WORKDIR /usr/src/app

# Build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json tsconfig.json ./
COPY src ./src

# Install dev deps to build, then prune to production
RUN npm install --legacy-peer-deps && npm run build && npm prune --omit=dev --legacy-peer-deps

ENV NODE_ENV=production
# Persistent data directory for SQLite (mount a volume here in Cloud Run)
ENV STUARD_DATA_DIR=/usr/src/app/.data
RUN mkdir -p /usr/src/app/.data
EXPOSE 8082
CMD ["node", "dist/server.js"]
