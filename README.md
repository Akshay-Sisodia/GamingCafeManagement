# Gaming Café Management Platform

Cloud-managed gaming café operating platform: lightweight Windows gaming terminals, cloud control, offline resilience, LAN game deployment.

See [`docs/`](./docs) for the full technical design:

| Doc | Contents |
|---|---|
| [01-architecture](docs/01-architecture.md) | System overview, ADRs, security model |
| [02-data-model](docs/02-data-model.md) | PostgreSQL schema |
| [03-protocols](docs/03-protocols.md) | REST, SSE, commands, offline sync protocol |
| [04-pc-agent](docs/04-pc-agent.md) | PC Agent & Launcher design |
| [05-milestones](docs/05-milestones.md) | Milestone plan & acceptance criteria |

## Repository layout

```text
apps/
  server/          Fastify API (modular monolith) + BullMQ worker entrypoints
  admin-web/       Unified web app: dashboard, PCs, orders, kitchen display, shop (React)
  customer-web/    Standalone customer portal (Phase 2 — needs customer auth)
packages/
  shared/          Shared types, zod schemas, SSE event catalog
desktop/
  PcAgent.Core/    C# session engine, outbox, trusted clock, LAN deployment (library)
  PcAgent/         .NET Windows Service host
  GamingLauncher/  WPF kiosk launcher
  PcAgent.Installer/  WiX v5 MSI (GamingCafeAgent.msi)
infra/
  docker-compose.yml  Postgres + Redis for local dev
  scripts/provision-kiosk.ps1  Kiosk user + lockdown provisioning
docs/                Technical design documents
```

## Local development

Prereqs: Node 22+, pnpm 11+, .NET SDK 10, Docker.

```powershell
pnpm install
pnpm infra:up                 # start Postgres + Redis
cp apps/server/.env.example apps/server/.env
pnpm --filter server db:migrate
pnpm --filter server db:seed
pnpm dev                      # api + all web apps via turbo
```

Server API: http://localhost:3000 · Admin: http://localhost:5173 · Kitchen: http://localhost:5174 · Customer: http://localhost:5175

## Tests

```powershell
pnpm --filter server test                # unit (pricing engine, conflict matrix)
$env:DATABASE_URL = "postgres://gcm:gcm-dev-password@localhost:5432/gamingcafe"
$env:REDIS_URL = "redis://localhost:6379"
pnpm --filter server test:integration   # chaos/reconciliation suite against live stack
```

Desktop (Windows):

```powershell
dotnet build desktop/PcAgent.sln -c Release
```

> **Troubleshooting (this machine):** a global `MSBuildSDKsPath` env var points at an old scoop SDK 9. If `dotnet build` fails with NETSDK1045, clear it first: `$env:MSBuildSDKsPath = $null; $env:DOTNET_ROOT = "C:\Program Files\dotnet"`.

## Deployment (Render free tier + hosted data)

Single **free** Render web service runs api + workers in one process (`SINGLE_PROCESS=true`), so 750 free instance-hours cover 24/7. Postgres and Redis are hosted externally.

1. Provision hosted data:
   - **Postgres** — [Neon](https://neon.tech) (free tier): copy the connection string, keep `?sslmode=require`
   - **Redis** — [Upstash](https://upstash.com) or [Redis Cloud](https://redis.com/cloud) (free tiers): copy the `redis://` / `rediss://` endpoint (TLS auto-detected)
2. Render Dashboard → **New → Blueprint** → select this repo.
3. When prompted, paste `DATABASE_URL`, `REDIS_URL`, and a strong `JWT_SECRET` (`openssl rand -hex 32`).
4. First deploy runs `db:push` automatically (schema sync). Seed once via a Render Shell on `gcm-api`:
   ```bash
   pnpm --filter server db:seed
   ```
5. **Keep-alive**: create a free cron at [cron-job.org](https://cron-job.org) or UptimeRobot hitting `https://<your-app>.onrender.com/healthz` every 10 minutes — prevents the 15-min idle spin-down.
6. Point PC agents at `https://gcm-api.onrender.com` (ServerBaseUrl).

Provider notes:
- Neon: use the **direct** (non-pooled) string for these long-lived services; pooled is for serverless.
- Upstash free tier limits concurrent connections — BullMQ uses blocking connections, so prefer Redis Cloud free (30 MB) if you hit limits.
- Free-tier reality: occasional Render restarts drop SSE connections; agents reconnect automatically (offline-first design), and sessions survive any backend downtime.

Local container check:

```powershell
docker build -t gcm-backend . 
docker run -p 3100:3000 -e DATABASE_URL=... -e REDIS_URL=... -e JWT_SECRET=... gcm-backend
```

## Notes

- Money is integer minor units everywhere.
- Redis holds only ephemeral state; PostgreSQL is the source of truth (docs/01 §4.4).
- The PC Agent must never meaningfully interfere with gaming performance — see docs/01 invariants.
