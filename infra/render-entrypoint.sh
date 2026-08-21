#!/bin/sh
# Container entrypoint: sync DB schema (with retries), then start api.
# A cold/slow database must never prevent the api from booting — schema
# sync failures are retried and ultimately non-fatal.
set -u
cd /app

echo "[entrypoint] syncing database schema..."
attempt=0
until pnpm --filter server db:push --force; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 5 ]; then
    echo "[entrypoint] schema sync failed after $attempt attempts — continuing startup"
    break
  fi
  echo "[entrypoint] retrying schema sync in 5s ($attempt/5)..."
  sleep 5
done

echo "[entrypoint] starting api..."
exec pnpm --filter server start
