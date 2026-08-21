# Milestone Plan & Acceptance Criteria

Durations assume 1–2 engineers per track (cloud track / desktop track can run in parallel). "Exit" items are testable gates — a milestone is not done until every exit criterion passes.

```text
M0 Scaffold ─ M1 PC Agent ──► M2 Launcher ──► M5 Superadmin ──► M6 Offline/Reconcile ──► M7 Game Deployment
        └────── M3 Cloud Backend ──► M4 Admin Dashboard ───────────────┘
                                     M8 Food (after M4) ──► M9 Customers/Payments ──► M10 Mobile
```

---

## M0 — Repository & Infrastructure Scaffold (~3 d)

**Deliverables:** monorepo layout (pnpm workspaces + Turborepo), Fastify hello-API with OpenAPI generation, .NET solution skeleton, docker-compose (Postgres + Redis), CI (lint, typecheck, test), drizzle-kit baseline migration.

**Exit:** `pnpm dev` boots API against Postgres+Redis; `dotnet build` green; CI runs both toolchains on PR.

## M1 — PC Agent Core (~3 wk) · *performance benchmarking starts here*

**Build:** Windows service shell; device pairing + DPAPI token storage; heartbeat/health; SQLite store; session engine with local countdown; trusted clock (offset + QPC anchor, tamper detection); internet detection + offline flag; LauncherSupervisor stub; MSI installer creating kiosk user.

**Exit criteria:**
- [ ] Service survives reboot and recovers a mid-session state correctly.
- [ ] Countdown continues correctly across: wall-clock change ±2 h, sleep/resume, network loss.
- [ ] Benchmark vs baseline (CapFrameX): FPS delta < 1 %, 1 % lows delta < 2 %, idle RSS ≤ 100 MB (target ≤ 60 MB), idle CPU < 0.5 % avg over 30 min. Results committed to `/docs/benchmarks`.
- [ ] Pairing flow works end-to-end against a mock server.

## M2 — Gaming Launcher (~2 wk)

**Build:** WPF+WebView2 shell; IPC contract (named pipes, protobuf-ish JSON); game grid from cache; session timer UI; warnings (10/5/1 min); expiry behavior (configurable termination); food menu/cart UI hitting Agent proxy; Customer Mode lockdown layers (§5 of doc 04).

**Exit criteria:**
- [ ] Kiosk user cannot reach desktop/cmd/taskmgr/explorer via documented escape attempts checklist.
- [ ] Launcher kill → restarted by agent < 5 s, session unaffected.
- [ ] Timer drift < 1 s over 2 h session vs trusted clock.
- [ ] Renderer suspended during gameplay; residual RSS ≤ 40 MB measured.

## M3 — Cloud Backend (~3 wk)

**Build:** auth (users JWT, device pairing); cafés/tiers/pricing rules; PCs CRUD + status; sessions module (start/extend/end/cancel/pause/resume/transfer, expiry sweep via SKIP LOCKED); commands pipeline (persist → SSE → ack → expire); SSE hub (`/realtime/pc`, `/realtime/admin`) with Last-Event-ID replay and Redis pub/sub fan-out; audit writer hook; BullMQ worker process; seed script.

**Exit criteria:**
- [ ] Integration tests (Testcontainers): session lifecycle incl. concurrent extend/end race resolves consistently.
- [ ] Command issued → SSE-delivered → acked < 500 ms p95 locally; stale command expires to `expired`.
- [ ] SSE reconnect replays missed events by id; no duplicate command application.
- [ ] Cross-tenant access attempts return 404 (test suite).

## M4 — Admin Dashboard (~2 wk)

**Build:** React app: login, PC grid with live status (SSE), PC detail (start guest/registered session, +15/+30/+60, end, lock, restart/shutdown w/ confirm), dashboard tiles, basic customer list, audit log viewer.

**Exit criteria:**
- [ ] Walk-in flow (PRD §74) completable in < 20 s of staff interaction.
- [ ] Remote extension reflects on a real PC < 2 s over LAN-internet loop.
- [ ] Responsive at 390 px width (phone) for all screens above.

## M5 — Superadmin (~1.5 wk)

**Build:** local Argon2id verifier sync (DPAPI-encrypted), credential dialog, rate limiter (persisted), full-Windows escape (fast user switch), maintenance menu, offline entry path, audit events `SUPERADMIN_ENTERED/EXIT/FAILED`.

**Exit criteria:**
- [ ] Offline machine: correct pass enters superadmin; wrong passes trigger escalating lockout that survives reboot.
- [ ] Every attempt produces an audit event queued and later reconciled.
- [ ] No secret material recoverable from launcher process memory/disk (review checklist).

## M6 — Offline & Reconciliation (~2.5 wk)

**Build:** outbox write-path for all state changes; UUIDv7 ids + seq; batch upload endpoint; ack-point pruning; conflict matrix implementation (doc 03 §6.3); admin conflicts review screen; chaos test suite.

**Exit criteria (maps PRD §77):**
- [ ] Automated chaos harness passes: internet cut mid-session ×N, router restart, backend restart, SSE drop, agent restart, launcher crash, OS reboot, power-cut simulation (VM hard-reset), duplicate/delayed event injection, simultaneous admin commands, offline start/extend, reconnect reconcile.
- [ ] Zero duplicate sessions/payments across 1,000 randomized duplicate-event fuzz iterations.
- [ ] Conflicted events always visible in admin UI; never silently dropped.

## M7 — Game Deployment (~3 wk)

**Build:** game catalog + versions + manifests (file list, sizes, SHA-256); master PC repository host (Kestrel LAN HTTPS, job-scoped tokens); deployment orchestrator (jobs, targets, policies, maintenance windows); target client (preflight, chunked throttle download, verify, platform hooks for Steam first-pass); progress reporting; deployment dashboard; disk checks.

**Exit criteria:**
- [ ] 80 GB payload moves master→2 targets over LAN with configured 100 Mbps cap respected ±10 %.
- [ ] Starting a session pauses active deployment within 5 s; resumes after session end.
- [ ] Corrupted chunk detected → retry → persistent corruption ⇒ FAILED, never READY.
- [ ] Insufficient disk ⇒ BLOCKED_DISK before any bytes move.
- [ ] Maintenance window honored (job deferred outside window).
- [ ] Steam title launches successfully post-deployment without manual repair on clean target.

## M8 — Food (~2 wk)

**Build:** menu CRUD; cart→order API with server-side totals; order state machine + history; kitchen web app (queue columns, big touch targets, SSE live); launcher food ordering wired end-to-end; admin orders view.

**Exit criteria:**
- [ ] Order placed on PC appears in kitchen < 1 s; status transitions propagate back to launcher toast.
- [ ] Illegal transitions (e.g., ready→placed) rejected with problem+json.
- [ ] Daily order numbering gap-free per café under concurrency test.

## M9 — Customers, Wallet, Payments (~2.5 wk)

**Build:** customer accounts (email/password V1), play history; wallet ledger services (append-only, balance_after continuity); payments records (cash/UPI-manual) with idempotency keys; refund partial/full flows; loyalty earn/redeem skeleton; membership tables (UI minimal).

**Exit criteria:**
- [ ] Ledger property test: for any transaction sequence, sum(credits−debits) == balance_after of last txn.
- [ ] Duplicate payment submission (same Idempotency-Key) returns original payment, single ledger row.
- [ ] Refund produces immutable transactions and correct status transitions only.

## M10 — Mobile & Polish (~2 wk)

**Build:** PWA installability for admin/kitchen/customer (Phase 2 native apps deferred per PRD §72); push notifications (web push) for admin alerts; report rollups + export CSV; load/perf pass; security review; docs/benchmarks finalization.

**Exit criteria:** Lighthouse PWA ≥ 90 on admin; notification latency < 5 s; all §78 DoD items checked below.

---

## PRD §78 Definition-of-Done Traceability

| # | DoD item | Milestone |
|---|---|---|
| 1–2 | Install agent, register PC | M0/M1 |
| 3–4 | Configure games, boot launcher | M2 |
| 5–6 | Guest & registered sessions | M3/M4, M9 |
| 7–8 | Launch games, track time | M1/M2 |
| 9–11 | Extend/end remotely, auto-expire | M3/M4 |
| 12–13 | Superadmin local, full Windows | M5 |
| 14–16 | Operate offline, emergency sessions, offline extend | M1/M5/M6 |
| 17–19 | Store events, reconcile, dedupe | M6 |
| 20–22 | Master PC, LAN deploy, version tracking | M7 |
| 23–24 | Pause during gaming, maintenance windows | M7 |
| 25–28 | Menu, ordering, kitchen display, statuses | M8 |
| 29 | Audit logs | M3 (+M5/M6 sources) |
| 30 | Recover after crashes/reboots | M1/M2/M6 |
| 31 | Negligible gaming impact | M1 benchmarks, re-run at M7/M10 |

---

## Post-V1 Backlog (from PRD §72–73, not scheduled)

UPI gateway integration · memberships/loyalty UX · reservations · customer mobile app (React Native/Expo) · automated signed agent updates with rollback · advanced pricing/promotions · P2P LAN distribution · inventory · multi-café SaaS billing · RLS hardening.
