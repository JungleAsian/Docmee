# Multi-stage build for the Docmee backend (api + worker share one image).
# Build context = monorepo root:  docker build -f deploy/Dockerfile -t docmee-be .
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# --- deps: install with the lockfile for cacheable layers ---
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

# --- build: compile all workspace packages + apps ---
FROM deps AS build
RUN pnpm build

# --- runtime: prune to production deps, ship dist ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts || true
# Default to the API; the worker service overrides CMD in docker-compose.
CMD ["node", "apps/api/dist/index.js"]
