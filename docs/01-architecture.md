# Gaming Café Platform — Technical Architecture

**Version:** 1.0 · **Status:** Draft for review · **Source PRD:** v1.1
**Companion docs:** [02-data-model](02-data-model.md) · [03-protocols](03-protocols.md) · [04-pc-agent](04-pc-agent.md) · [05-milestones](05-milestones.md)

---

## 1. System Overview

Four products, one backend:

| Component | Runtime | Trust level | Notes |
|---|---|---|---|
| **PC Agent** | .NET 8 Windows Service (C#) | Privileged (LocalSystem) | Session engine, lockdown, offline outbox, deployment client |
| **Gaming Launcher** | .NET 8 WPF + WebView2 | Unprivileged kiosk user | Customer-facing kiosk UI; no secrets |
| **Cloud Backend** | Node.js 22 + TypeScript (Fastify) | Cloud | REST API + SSE + workers; PostgreSQL + Redis |
| **Admin App** | React 18 + Vite (responsive web) | Authenticated staff/owner | Phone-first |
| **Kitchen App** | React 18 + Vite (tablet layout) | Authenticated kitchen staff | Single-purpose queue UI |
| **Customer Web** | React 18 + Vite | Optional auth | V1: thin; Phase 2: mobile |

```text
                         INTERNET
                            │
                    ┌───────▼────────┐
                     │  CLOUD BACKEND │
                     │  api process   │
                     │  worker process│
                     │  PostgreSQL    │
                     │  Redis         │
                    └───┬───────┬────┘
              REST+SSE  │       │  REST+SSE
        ┌───────────────┘       └────────────┐
        ▼                                    ▼
   PC Agent ◄── IPC ──► Gaming Launcher   Admin / Kitchen / Customer web
        │
      LAN (game transfer, master PC repository)
```

### Non-negotiable invariants

1. **Gaming performance wins.** Any conflict between management features and game performance is resolved in favor of the game (PRD §3.1). Enforced by a "gaming mode" switch in the Agent that suspends all non-critical work.
2. **Cloud-first, not cloud-dependent.** Active sessions survive any cloud outage; all offline mutations are captured as idempotent events and reconciled later.
3. **Server-authoritative when online, PC-authoritative between syncs.** The PC computes countdowns locally from `expires_at`; the server never streams per-second state.
4. **Append-only money and audit.** Wallet, payments, loyalty, and audit are immutable ledgers — balances are derived, never mutated in place.

---

## 2. Technology Decisions (ADR summary)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| ADR-1 | PC Agent runtime | **C# / .NET 8 Worker Service**, Workstation GC, trimmed, NativeAOT evaluated at M7 | First-class Windows service + Win32 interop (job objects, DPAPI, registry policy, QPC time); ~40–60 MB RSS achievable; user selected .NET |
| ADR-2 | Agent UI | None — headless service | Agent must run when launcher crashes; UI is a separate unprivileged process |
| ADR-3 | Launcher UI | **WPF shell hosting WebView2**, renderer suspended during gameplay | Fast UI iteration with web tech; native host controls lifecycle; memory reclaimed while a game runs |
| ADR-4 | API style | **REST + OpenAPI 3.1** (no GraphQL for V1) | Simpler clients (Agent in C#, web apps), cacheable, codegen for TS + C#; SSE covers push |
| ADR-5 | Real-time transport | **SSE** with `Last-Event-ID` replay; commands persisted server-side with ack protocol | Server→client dominant; survives proxies; reconnect semantics built-in (PRD §7) |
| ADR-6 | Backend framework | **Fastify** + TypeScript ESM | Performance, schema-based validation (TypeBox), first-class SSE support |
| ADR-7 | ORM / SQL | **Drizzle ORM** + drizzle-kit migrations | Transparent SQL for the idempotency/ledger-heavy model; no hidden N+1 |
| ADR-8 | Jobs / cache / fan-out | **Redis** (BullMQ queues, pub/sub SSE fan-out, rate limits, idempotency cache) alongside PostgreSQL | User decision; enables stateless horizontal api scaling without sticky sessions; Postgres remains source of truth (§4.4) |
| ADR-9 | Agent local store | **SQLite** (WAL mode) via `Microsoft.Data.Sqlite` | Durable outbox + config cache; zero admin overhead; single-file backup |
| ADR-10 | IDs | **UUIDv7** everywhere | Time-sortable, safe to generate offline on PCs (critical for the event outbox) |
| ADR-11 | Money | Integer **minor units** (paise) + currency string per café | No floats in payments/pricing |
| ADR-12 | Time | All server timestamps `timestamptz` UTC; agents keep server-offset + monotonic clock | Trusted-time requirement (PRD §27) |
| ADR-13 | Monorepo | pnpm workspaces + Turborepo; OpenAPI-generated shared types | One repo, independent deployables |
| ADR-14 | Multi-tenancy | Shared database, `cafe_id` column on every tenant-owned row + composite indexes; RLS deferred to Phase 3 | Day-one multi-café (PRD §56) without operational complexity |

---

## 3. Repository Layout

```text
GamingCafeManagement/
├── apps/
│   ├── server/                 # Fastify API (modular monolith)
│   ├── worker/                 # BullMQ consumers (same codebase, separate deployable)
│   ├── admin-web/
│   ├── kitchen-web/
│   └── customer-web/
├── packages/
│   ├── shared/                 # zod schemas + generated OpenAPI types
│   ├── contracts/              # OpenAPI spec (source of truth), SSE event catalog
│   └── config/                 # eslint/tsconfig shared configs
├── desktop/
│   ├── PcAgent/                # C# .NET 8 worker service
│   ├── PcAgent.Core/           # session engine, outbox, trusted time (unit-testable)
│   ├── GamingLauncher/         # WPF + WebView2 shell
│   └── PcAgent.Installer/      # WiX MSI (service install, kiosk user creation, firewall rules)
├── infra/
│   ├── docker-compose.yml      # postgres + redis for dev
│   └── migrations/             # drizzle-kit output
└── docs/
```

---

## 4. Backend Architecture

### 4.1 Process model

Two deployables from one codebase:

- **api** — HTTP (REST + SSE), stateless, horizontally scalable behind a load balancer. Domain events are broadcast over Redis pub/sub so any api instance can serve any SSE client without stickiness; commands are DB-persisted so any instance can serve an ack.
- **worker** — BullMQ consumers: command timeouts, session expiry sweeps, notification fan-out, report rollups, deployment orchestration, reconciliation conflict review, retention jobs.

Scaling order of magnitude for V1 (tens of cafés): single api replica + single worker is sufficient; both are stateless/persistent-by-design so scaling is horizontal without redesign.

### 4.2 Modules

```text
server/src/modules/
├── auth/          # users, roles, device tokens, OTP (phase 2), JWT issue/refresh
├── cafes/         # tenants, cafes, pc tiers, pricing rules
├── pcs/           # registration, status, health, configuration, commands
├── sessions/      # lifecycle, extensions, transfers, expiry sweep
├── games/         # catalog, versions, installations, deployments
├── menu/          # categories, items, variants, availability
├── orders/        # cart→order lifecycle, kitchen state machine
├── customers/     # accounts, play history
├── payments/      # payment records, refunds (gateway phase 2)
├── sync/          # offline event ingestion, reconciliation, conflicts
├── realtime/      # SSE hub, event publisher
├── notifications/ # admin/customer notification dispatch
├── reports/       # daily rollups, dashboards
└── audit/         # append-only audit log writer (in-process hook)
```

Cross-cutting: `audit` is invoked via an in-process event bus so every module emits audit entries without coupling; `realtime` subscribes to domain events and fans out to SSE channels.

### 4.3 Domain events (internal)

Modules publish to an in-process emitter; the realtime module maps them to SSE channels (and broadcasts cross-instance via Redis pub/sub), the audit module persists them, and BullMQ handles async side effects. This keeps the API request path synchronous-only where correctness matters (session start/end) and async where latency tolerance exists (notifications, reports).

### 4.4 Redis usage & durability stance

PostgreSQL is the **source of truth**; Redis holds only rebuildable/ephemeral state:

| Use | Keys/patterns | Loss impact |
|---|---|---|
| Job queues (BullMQ) | `bull:*` | In-flight jobs retried after reconnect; scheduled jobs re-enqueued from DB state on boot |
| SSE fan-out | pub/sub channel `events:{cafe_id}` | Clients miss events until next SSE event / bootstrap poll — self-healing |
| Rate limiting | `rl:{principal}:{window}` (sliding window via INCR+EXPIRE) | Limits reset — acceptable |
| Idempotency-Key cache | `idem:{key}` → response hash, 24 h TTL | DB unique constraints remain authoritative fallback |
| Presence/heartbeat | `pc:online:{pc_id}` TTL = 2× cadence | Derived from `pcs.last_heartbeat_at` anyway |
| Session cache (read-through) | `sess:{session_id}` short TTL | Cache miss falls back to Postgres |

Rules: no money, session authority, or audit data lives exclusively in Redis; every write that matters commits to Postgres first (or in the same logical transaction where feasible).

---

## 5. Identity & Security Model

### 5.1 Principal types

| Principal | Credential | Transport |
|---|---|---|
| Staff/Owner (User) | Password (Argon2id) → JWT access (15 min) + refresh (30 d, rotating) | `Authorization: Bearer` |
| Gaming PC (Device) | Opaque device token (32-byte random), SHA-256 stored; minted via pairing code | `Authorization: Bearer` + `X-PC-Id` |
| Customer | V1: email/password basic accounts; Phase 2: phone OTP, QR | Bearer JWT |
| Superadmin (local) | Argon2id verifier synced from cloud, DPAPI-encrypted at rest on PC | Local only; audited |

### 5.2 Device provisioning flow

```text
Admin creates PC record → pairing code (6 chars, 15-min TTL, single-use)
PC Agent first boot → POST /auth/devices/pair {pairing_code, hardware_fingerprint}
Server validates → issues device_token + pc_id → token stored DPAPI-encrypted
Re-install/re-image → admin revokes + re-pairs
```

Hardware fingerprint binds tokens to the machine (motherboard UUID + disk serial hash) to deter token copying; mismatch forces re-pairing but never mid-session.

### 5.3 RBAC matrix (V1)

| Capability | OWNER | MANAGER | STAFF | KITCHEN |
|---|---|---|---|---|
| Dashboard, reports | ✓ | ✓ | – | – |
| Start/extend/end sessions | ✓ | ✓ | ✓ | – |
| Lock/unlock/restart/shutdown PC | ✓ | ✓ | ✓ (confirm) | – |
| Menu & pricing management | ✓ | ✓ | – | – |
| Game catalog & deployment | ✓ | ✓ | – | – |
| User & PC registration mgmt | ✓ | ✓ | – | – |
| Order accept/preparing/ready/delivered | – | ✓ | ✓ | ✓ |
| Audit log view | ✓ | ✓ | – | – |

Dangerous commands (`RESTART`, `SHUTDOWN`, `END_SESSION`) require explicit UI confirmation and are always audited with actor + source.

### 5.4 Superadmin credentials (PRD §13)

- No hardcoded secrets. Cloud holds Argon2id hash; Agent receives a **DPAPI-encrypted verifier bundle** during each config sync (rotated).
- Online entry: verify against server (preferred). Offline entry: verify against local bundle; result queued as `SUPERADMIN_ENTERED` audit event with `connection: OFFLINE`.
- Rate limiting local attempts: exponential backoff persisted across reboots (SQLite), plus failed-attempt logging.
- Privilege separation: superadmin actions run in the Agent's privileged context; the launcher never sees credentials.

### 5.5 Transport & hardening

- TLS 1.2+ everywhere (HSTS); LAN game transfer uses a scoped token issued per deployment job.
- Tenant isolation enforced in the data layer: every query filtered by `cafe_id` claims; integration tests assert cross-tenant 404s.
- Secrets: env vars / cloud secret manager; nothing in repo or launcher bundle.
- Agent updates signed (Authenticode + manifest hash check before install) — Phase 2 automated pipeline, manual MSI in V1.

---

## 6. Offline & Reconciliation Stance

- The Agent's SQLite outbox is the durable record of every offline mutation (PRD §25). Events carry UUIDv7 ids + per-PC monotonic sequence numbers.
- Ingestion endpoint is idempotent by `event_id` primary key; replays are acknowledged as duplicates, never double-applied (PRD §26).
- Conflict rules are deterministic and documented per event type (see [03-protocols §6](03-protocols.md)); unresolved conflicts surface in the admin app rather than silently resolving.
- Trusted time (server offset + monotonic anchor) prevents clock tampering from extending sessions (PRD §27).

---

## 7. Observability

| Concern | Mechanism |
|---|---|
| API logs | pino structured JSON, request id propagation |
| Metrics | `/metrics` Prometheus endpoint (api + worker); agent exposes none externally — health posted via REST |
| Tracing | OpenTelemetry optional flag; default off to reduce dependencies |
| Health | `/healthz` (liveness), `/readyz` (DB check); Agent posts heartbeat+health every 60 s online, 300 s while gaming |
| Audit | `audit_logs` table, append-only, actor/action/source/event_id (PRD §55) |

Alert-worthy signals (Phase 2 notification rules): PC offline > 5 min, agent unhealthy, reconciliation conflicts pending, disk below threshold, deployment failures, payment failures.

---

## 8. Environments & Configuration

- `dev`: docker-compose (Postgres + Redis), seed script (café, 20 PCs, games, menu).
- `staging/prod`: managed PostgreSQL (PITR enabled) + managed Redis, api+worker behind ALB, SSE-friendly proxy settings (`proxy_buffering off`, read timeout ≥ 10 min).
- Config via environment (zod-validated); per-café runtime config lives in `pc_configurations` and is pushed to agents over SSE `config.updated`.

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| WebView2 launcher too heavy | Renderer suspended during gameplay; measured budget ≤ 150 MB idle, ~0% CPU while game runs; fallback plan: pure WPF UI (same shell contract) |
| SSE through corporate proxies | Long-read-timeout proxy config documented; agent falls back to 60 s polling if SSE cannot establish (degraded mode) |
| Reconciliation ambiguity | Deterministic conflict matrix + admin review queue; no silent overwrites |
| Steam/platform installs resist automation | Deployment orchestrates official installers/config only; never touches DRM/licensing (PRD §32); unsupported platforms fall back to "manual install + mark version" workflow |
| Clock tampering | Monotonic anchor + wall-clock divergence detection; divergence > threshold locks session-start and flags audit event |
