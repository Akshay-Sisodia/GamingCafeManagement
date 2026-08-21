# Multi-stage build for the cloud backend (api + worker share one image).
# Runtime uses tsx (no emit pipeline) — see docs/01-architecture.md ADR notes.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps: install workspace dependencies ------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- build: copy sources, typecheck as a release gate -------------------------
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/worker apps/worker
RUN pnpm --filter @gaming-cafe/shared typecheck \
 && pnpm --filter server typecheck \
 && pnpm --filter worker typecheck

# ---- runtime -------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "server", "start"]
