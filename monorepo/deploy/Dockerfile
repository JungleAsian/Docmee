# Multi-stage build for the Docmee BACKEND (api + worker share one image).
# Build context = monorepo root:  docker build -f deploy/Dockerfile -t docmee-be .
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY . .
# Install the full workspace (lockfile-accurate), then build only the backend
# graph (api + worker + their deps) — the FE app/ui aren't needed on this image.
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@docmee/api..." --filter "@docmee/worker..." build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Default to the API; the worker service overrides CMD in docker-compose.
CMD ["node", "apps/api/dist/index.js"]
