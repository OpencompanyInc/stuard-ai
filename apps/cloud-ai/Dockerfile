# Cloud AI Dockerfile
# Build and run the TypeScript server with Node 20

FROM node:20-slim AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json tsconfig.json ./
COPY src ./src

# Install dev deps to build, then prune to production
RUN npm install --legacy-peer-deps && npm run build && npm prune --omit=dev --legacy-peer-deps

ENV NODE_ENV=production
EXPOSE 8082
CMD ["node", "dist/server.js"]
