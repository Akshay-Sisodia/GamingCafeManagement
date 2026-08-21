#!/bin/sh
# Container entrypoint: sync DB schema, then start api (+ workers when
# SINGLE_PROCESS=true). Used by the Render free-tier deployment.
set -e
cd /app

echo "[entrypoint] syncing database schema..."
pnpm --filter server db:push --force

echo "[entrypoint] starting api..."
exec pnpm --filter server start
