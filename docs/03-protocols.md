# Protocols — REST API, SSE, Commands, Sync

**Conventions**

- Base URL: `https://api.<domain>/v1`. All examples abbreviated; the OpenAPI spec in `packages/contracts` is the source of truth.
- Auth: `Authorization: Bearer <jwt|device_token>`. Device calls additionally carry `X-PC-Id`.
- Errors: RFC 7807 problem+json (`type`, `title`, `status`, `detail`, `code`).
- Idempotency: mutating endpoints accept `Idempotency-Key` header (stored 24 h). Offline sync has its own stronger dedupe (§6).
- All times ISO-8601 UTC.

---

## 1. Authentication Endpoints

```text
POST /auth/login                      # staff/customer → {access_token, refresh_token, user}
POST /auth/refresh                    # rotate refresh token
POST /auth/devices/pair               # {pairing_code, hardware_fingerprint, agent_version}
                                      # → {pc_id, device_token, server_time, config_version}
POST /auth/devices/rotate             # device token rotation (device-authenticated)
```

Pairing response includes `server_time_ms` — the first trusted-time sample. Every authenticated device response also carries `X-Server-Time-Ms`.

---

## 2. PC & Session Surface (Agent-facing)

```text
GET  /agent/bootstrap                 # full state after (re)connect:
                                      #   pc profile, active session(s), config,
                                      #   game catalog + installations, deployment jobs,
                                      #   superadmin verifier version, pending commands
GET  /agent/config                    # → {version, config} ; 304 if unchanged
POST /agent/health                    # health snapshot (throttled server-side)
POST /agent/time-check                # → {server_time_ms} for offset sampling

# Sessions (online path)
POST /sessions                        # start (admin or launcher-origin)
POST /sessions/{id}/extend            # {minutes}
POST /sessions/{id}/end               # {reason}
POST /sessions/{id}/cancel
POST /sessions/{id}/pause | /resume | /transfer   # where supported
GET  /pcs/{id}/session                # current session snapshot

# Superadmin
POST /pcs/{id}/superadmin/verify      # online verification → {ok, ticket_ttl_s}
```

**Session start response** (the only per-session payload the agent needs):

```json
{
  "session_id": "018f3c…",
  "started_at": "2026-08-21T10:00:00Z",
  "expires_at": "2026-08-21T12:00:00Z",
  "server_time_ms": 1779367200000,
  "customer": null,
  "warnings": [600, 300, 60]
}
```

The agent computes countdowns locally from `expires_at` + time anchor. The server never sends per-second updates (PRD §19).

---

## 3. Admin App Surface

```text
GET  /dashboard                       # revenue today, occupancy, active sessions, pending orders, offline PCs
GET  /pcs                             # grid status (ETag-cached, refreshed via SSE)
GET  /pcs/{id}                        # detail: session, health, installations
POST /pcs/{id}/commands               # issue command (see §4)
GET  /pcs/{id}/commands?since=        # history

POST /games  PATCH /games/{id}        # catalog CRUD
POST /game-versions                   # publish version + manifest metadata
GET  /deployments  POST /deployments  # create job {game_id, target_version, master_pc_id, pc_ids[], policy}
GET  /deployments/{id}                # per-target states
POST /deployments/{id}/cancel
POST /deployment-targets/{id}/pause | /resume | /retry

GET  /menu  POST/PATCH …              # categories/items/variants/addons
GET  /orders?status=placed            # kitchen queue feed (also via SSE)
POST /orders                          # staff-placed orders
POST /orders/{id}/accept|prepare|ready|deliver|complete|cancel

GET  /reports/sessions|food|customers ?from&to&group_by
GET  /audit-logs?action&from&to&actor
GET  /sync/conflicts?state=conflicted
POST /sync/conflicts/{id}/resolve     # {resolution: accept_server|accept_offline|manual}
```

---

## 4. Command Protocol

Lifecycle:

```text
admin POST /pcs/{id}/commands ──► row(status=pending) ──► SSE delivery ──► status=sent
      agent applies ──► POST /commands/{id}/ack {status:"applied"|"failed", payload?}
      worker expires stale rows ──► status=expired (default TTL 60 s)
```

SSE event delivered to the PC channel:

```json
{
  "event": "command",
  "id": "42",
  "data": {
    "command_id": "018f…",
    "type": "extend_session",
    "payload": { "minutes": 30 },
    "issued_at": "2026-08-21T10:12:00Z"
  }
}
```

Rules:

- Commands are **persisted before delivery**; acks are idempotent (`applied` twice is fine).
- `requires_confirm` commands are rejected at issuance unless `confirm:true` was sent by an authorized role.
- Agent replies `failed` with a machine-readable `code` (e.g., `NO_ACTIVE_SESSION`) — surfaced to admin UI.
- If SSE is down, the agent picks up pending commands via `GET /agent/bootstrap` and polling fallback.

---

## 5. SSE Channels

Two endpoints; both support `Last-Event-ID` replay from a bounded in-memory ring buffer (per instance), plus DB catch-up for critical event classes. Domain events are broadcast to all api instances over Redis pub/sub (`events:{cafe_id}`), so any instance can serve any client — no sticky sessions required.

### 5.1 `GET /realtime/pc` (device auth)

| Event | Payload (abridged) |
|---|---|
| `command` | see §4 |
| `session.updated` | `{session_id, expires_at, status}` |
| `config.updated` | `{config_version}` (agent then GETs `/agent/config`) |
| `deployment.updated` | `{job_id, target_state, manifest_url, lan_token}` |
| `ping` | keepalive comment every 25 s |

### 5.2 `GET /realtime/admin?cafe={id}` (staff JWT)

| Event | Trigger |
|---|---|
| `pc.status` | heartbeat gap/restore, agent state change |
| `session.started/extended/ended/expired` | session module |
| `order.created/status` | order module |
| `deployment.progress` | target state changes |
| `sync.conflict` | reconciliation conflict created |
| `notification` | notification fan-out |

Kitchen app subscribes to the same endpoint filtered client-side by order events (V1 simplicity).

Reconnect policy (clients): exponential backoff 1 s → 30 s with jitter; on reconnect, agents run `bootstrap` diff before resuming normal operation.

---

## 6. Offline Sync / Reconciliation Protocol

### 6.1 Event envelope (agent-generated)

```json
{
  "event_id": "018f3d7a-…",          // UUIDv7, globally unique, primary dedupe key
  "seq": 8391,                        // per-PC monotonic, gap-free attempt
  "type": "SESSION_STARTED",
  "occurred_at": "2026-08-21T14:20:11Z",
  "payload": {
    "local_session_ref": "ls-221",
    "planned_minutes": 120,
    "customer": null,
    "price_quote": { "amount": 30000, "currency": "INR" }
  }
}
```

### 6.2 Batch upload

```text
POST /sync/events
{
  "pc_id": "…", "agent_version": "1.0.3",
  "last_server_seq": 8385,
  "events": [ …up to 500 envelopes, ordered by seq… ]
}

→ 200
{
  "results": [
    { "event_id": "…", "seq": 8386, "state": "accepted",  "session_id": "…" },
    { "event_id": "…", "seq": 8387, "state": "duplicate" },
    { "event_id": "…", "seq": 8388, "state": "conflicted",
      "reason": "SERVER_SESSION_ALREADY_ENDED", "resolution_hint": "discard_extension" }
  ],
  "ack_seq": 8388                     // highest contiguous applied seq
}
```

Semantics:

- **Idempotent**: `offline_events.id = event_id` PK. Replays return `duplicate`; no side effects ever re-run.
- **Ordered**: events apply in `seq` order per PC within a serializable transaction; gaps are tolerated (missing seqs may arrive later or were lost — timestamps arbitrate).
- **Ack point**: agent prunes local outbox rows only up to `ack_seq` and only when all their ids returned `accepted|duplicate`.
- **Conflicted** events stay on the server for admin review; the agent keeps them until acknowledged as resolved (they are never silently dropped).

### 6.3 Conflict matrix (V1)

| Offline event | Server state at reconcile | Resolution |
|---|---|---|
| `SESSION_STARTED` | No active session on PC | Accept; create session with `origin=superadmin_offline`, `expires_at = occurred_at + planned_minutes` (capped at now if already past → auto-expired) |
| `SESSION_STARTED` | Active session exists that started earlier | Conflict `DUPLICATE_SESSION` → keep server session; offline session recorded as conflicted for review |
| `SESSION_EXTENDED` | Session still active | Accept; extend `expires_at` |
| `SESSION_EXTENDED` | Server ended/cancelled meanwhile | Conflict `SESSION_ALREADY_ENDED` → reject extension; record for review (grace window configurable, default 0) |
| `SESSION_ENDED/CANCELLED` | Session active | Accept; end with `ended_at = occurred_at` |
| `SESSION_ENDED` | Already ended | Duplicate/idempotent accept |
| Any | Clock skew detected > 5 min between `occurred_at` and neighbors | Flag `CLOCK_SKEW`; apply but mark for review |

Money-affecting conflicts (payments in Phase 2) always resolve conservatively: never double-charge, prefer refund-side acceptance.

---

## 7. Trusted Time Protocol

```text
On connect + every 15 min (online):
  GET /agent/time-check → {server_time_ms}
  offset = server_time_ms - qpc_now_converted
  store (offset, qpc_anchor) durably

Effective now() = anchor_server_time + (qpc_now - anchor_qpc)

Wall-clock divergence check:
  if |system_clock - effective_now| > 60 s → tamper flag
    - block new offline session starts (configurable)
    - emit TAMPER_SUSPECTED audit event
    - sessions continue counting on monotonic time regardless
```

Sleep/hibernate: QPC pauses during sleep on some platforms; the agent records sleep/wake transitions and adds elapsed unbiased interrupt time so a customer cannot gain time by sleeping the PC mid-session (policy-configurable: pause vs continue countdown).

---

## 8. Health Reporting

```text
POST /agent/health
{ cpu_pct, ram_pct, gpu_pct, disk_pct, disk_free_bytes,
  net_rx_bps, net_tx_bps, uptime_s, current_game_id?, agent_status }

Cadence: 60 s idle · 300 s while game running (PRD §62: no heavy telemetry in-game)
Server marks PC offline after 2× cadence without heartbeat.
```

---

## 9. Game Deployment Coordination

Cloud coordinates metadata only; bytes move over LAN (PRD §29–31).

```text
Admin: POST /deployments {game_id, target_version, master_pc_id, pc_ids, policy}
Cloud → SSE deployment.updated → master_pc:  "you are source for job J"
Cloud → SSE deployment.updated → each target: "job J available"

Target agent lifecycle (details in 04-pc-agent §7):
  preflight checks → DOWNLOADING (LAN pull from master) → VERIFYING
  → INSTALLING (platform hooks) → READY   (or PAUSED/FAILED/OFFLINE)

Progress: POST /deployments/{job}/targets/{pc}/progress   (throttled, e.g. every 10 s or 5 % delta)
Terminal: POST .../complete {manifest_hash_verified:true} | .../fail {code, detail}
```

Policy object honored by agents:

```json
{
  "only_when_idle": true,
  "pause_on_session_start": true,
  "maintenance_window": { "start": "02:00", "end": "08:00", "timezone": "Asia/Kolkata" },
  "max_network_mbps": 100,
  "cpu_priority": "low",
  "disk_priority": "low",
  "min_free_disk_bytes": 107374182400
}
```
