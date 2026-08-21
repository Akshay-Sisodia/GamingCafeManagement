# PC Agent & Gaming Launcher — Technical Design

**Runtime:** .NET 8 (C#), Worker Service hosted as a Windows Service (`Microsoft.Extensions.Hosting.WindowsServices`).
**Companion:** [03-protocols](03-protocols.md) defines the wire behavior implemented here.

---

## 1. Process Architecture

```text
PcAgent.exe  (LocalSystem service)
├── SessionEngine            # authoritative local session state + countdown
├── TrustedClock             # server offset + QPC monotonic anchor
├── SseClient                # /realtime/pc, reconnect w/ backoff
├── CommandHandler           # applies commands, posts acks
├── OutboxStore (SQLite)     # offline events, config cache, rate-limit state
├── SyncEngine               # batch upload on reconnect, ack-point pruning
├── GameManager              # catalog cache, launch orchestration, monitoring
├── DeploymentClient         # LAN pulls, throttle, pause/resume, verify
├── WindowsController        # lockdown, session switch, restart/shutdown
├── SuperadminService        # local verifier, rate limiting
├── HealthReporter           # throttled sampling + POST
└── LauncherSupervisor       # start/restart launcher, crash detection

GamingLauncher.exe  (kiosk user session, unprivileged)
└── WPF shell + WebView2 UI  # game grid, timer, food ordering, superadmin prompt
    └── named-pipe IPC → PcAgent   (request/response + push events; no secrets)
```

**Separation rules**

- Launcher holds **no credentials and no lockdown rights**. Every privileged action is an IPC request the Agent may refuse.
- Agent must survive launcher crash → `LauncherSupervisor` restarts it with exponential backoff (max 5/min then hold 60 s) (PRD §68).
- Agent never renders UI except the minimal superadmin credential prompt (own WinForms/WPF dialog on secure desktop when invoked from lock screen path).

---

## 2. Performance Engineering (PRD §4, §62, §76)

Budget: idle CPU < 0.5 % avg · RAM 30–60 MB target (< 100 MB hard) · ~0 % GPU · near-zero idle disk I/O.

| Technique | Detail |
|---|---|
| GC | Workstation GC, concurrent off, `<ServerGarbageCollector>false</ServerGarbageCollector>`; allocations minimized on hot paths (no per-tick allocations in countdown — it's IPC-push only, see below) |
| Trimming/AOT | `PublishTrimmed` + ready-to-run; NativeAOT evaluated at M7 for Win32 interop compatibility |
| Timers | One coalesced 1 s `PeriodicTimer` drives everything cadence-based; no per-feature timers |
| Countdown | Computed on demand; pushed to launcher over IPC at 1 Hz **only while launcher visible & no game running**; suspended entirely during gameplay |
| SSE | Single HTTP/2 connection, `SocketsHttpHandler` keep-alive; read loop with pooled buffers |
| Process monitoring | No enumeration polling. Games launched by the Agent join a **Job Object**; exit detected via handle wait (`WaitForExitAsync`) = zero polling. Externally-launched platform games (Steam child) matched against a small known-exe list polled every 5 s max, only while a session expects that game |
| Disk I/O | SQLite WAL with `synchronous=NORMAL`; writes batched; zero writes during gameplay except terminal session events |
| Health sampling | Suspended during gameplay except 300 s cadence lightweight sample (CPU/RAM via `GetSystemTimes`, no WMI, no perf counters) |
| Networking | Heartbeat piggybacked on health POST; no other chatter |

**Gaming-mode switch:** on game process start, Agent sets a global flag that suspends: deployment work, health sampling (to 300 s), config refreshes, outbox compaction, launcher renderer (IPC message to WebView2 → suspend). Only SSE keepalive, session engine, and job-object wait remain active (PRD §62).

Benchmark harness (Milestone 1 exit): CapFrameX/PresentMon capture of FPS, 1 %/0.1 % lows, frametime variance across scenarios: baseline vs agent-idle-online vs agent-offline vs deployment-active (deployment expected to pause). Results recorded in `/docs/benchmarks`.

---

## 3. Local Persistence (SQLite)

```sql
CREATE TABLE meta            (key TEXT pk, value TEXT);          -- schema_version, pc_id, token(ref DPAPI)
CREATE TABLE outbox          (event_id TEXT pk, seq INTEGER, type TEXT,
                              occurred_at TEXT, payload TEXT,
                              sync_state TEXT CHECK(sync_state IN ('pending','acked','conflicted')),
                              conflict_reason TEXT);
CREATE TABLE sessions_local  (local_ref TEXT pk, server_session_id TEXT NULL,
                              started_eff_ms INTEGER, expires_eff_ms INTEGER,
                              status TEXT, origin TEXT);
CREATE TABLE config_cache    (version INTEGER, json TEXT);        -- last good config (offline boot)
CREATE TABLE games_cache     (game_id TEXT pk, json TEXT, manifest_version TEXT);
CREATE TABLE time_anchor     (offset_ms INTEGER, qpc_at_sync INTEGER, updated_at TEXT);
CREATE TABLE rate_limit      (scope TEXT pk, fail_count INTEGER, locked_until TEXT);
CREATE TABLE audit_pending   (event_id TEXT pk, action TEXT, occurred_at TEXT, metadata TEXT);
```

Write policy: outbox inserts are the only gameplay-window-permitted writes (terminal events only).

---

## 4. Session Engine

State machine:

```text
NO_SESSION ──start──► ACTIVE ──expire──► EXPIRING(60 s warn) ──► EXPIRED ──cleanup──► NO_SESSION
    ▲                    │  │
    │      extend────────┘  ├──cancel──► CANCELLED ──cleanup──► NO_SESSION
    └────────────pause/resume/transfer (policy-gated)
```

- `expires_eff_ms` is always derived from the trusted clock, never the wall clock.
- Expiry sequence (PRD §21): warnings at configured marks (default 10/5/1 min via IPC to launcher) → at 0: notify launcher "session ended" UI → terminate game processes in the job object (grace kill 10 s) → optionally re-lock → post/queue `SESSION_ENDED|EXPIRED`.
- Termination behavior configurable per café: `close_games` | `leave_open_lock_input` | `warn_only_staff_decides`.
- Crash recovery (PRD §68): on boot, load `sessions_local`; recompute effective expiry from anchor; if already past → mark expired + queue event; if active → resume countdown.
- Offline operations append to outbox immediately after local commit (write-ahead style), so a power cut between action and queue is impossible.

---

## 5. Windows Lockdown (Customer Mode)

Layered defense on a dedicated non-admin Windows account `gaming-kiosk` (auto-login):

| Layer | Mechanism |
|---|---|
| Shell replacement | Per-user custom shell: `HKCU\...\Winlogon` "Custom user interface" → `GamingLauncher.exe` (Explorer never starts) |
| Blocked executables | NTFS ACLs: remove execute for `gaming-kiosk` on cmd.exe, powershell.exe, wscript, regedit, mmc, taskmgr, explorer.exe fallback paths |
| Registry policy | DisableTaskMgr, DisableCmd, NoControlPanel, NoRun, DisallowRun for browser dev tools shortcuts etc. |
| AppLocker/WDAC | Allowlist mode where SKU supports it (Pro for AppLocker via GPO-local, Enterprise for WDAC); deny-by-default for user-writable paths |
| Edge cases | USB autoplay off; hide drive letters for system volumes; Ctrl+Alt+Del remains (Windows cannot fully suppress) — Secure Desktop screen has no shell behind it, so Escape options are limited to logoff which returns to kiosk login |

Superadmin entry points: hotkey from launcher → Agent shows credential dialog (topmost, own desktop) OR from Windows logon screen via a registered credential provider tile (Phase 2; V1 uses launcher hotkey + lock-screen instructions card). On success: option to (a) exit kiosk into full Windows admin session (fast user switch to admin account), or (b) open limited maintenance menu inside launcher context. Every attempt audited locally + queued (PRD §13).

---

## 6. Superadmin Local Auth

```text
verify(pass):
  rate_limit check (SQLite persisted; 5 fails → 30 s, doubling, cap 15 min)
  online?  → POST /pcs/{id}/superadmin/verify     (preferred; result cached 5 min)
  offline? → Argon2id.Verify(pass, DPAPI.Unprotect(verifier_blob))
  success → audit SUPERADMIN_ENTERED {connection} ; unlock actions
  fail    → audit SUPERADMIN_LOGIN_FAILED ; increment limiter
```

Verifier bundle rotated on every config sync so revocation propagates within one reconnect cycle.

---

## 7. Game Deployment Client

Roles: any PC can be **master** (source) if designated; masters run an embedded HTTPS file host (Kestrel, bound to LAN IP, port 7300) serving manifests + content chunks scoped by per-job tokens.

```text
Target flow:
  receive job (SSE/bootstrap) → preflight:
      idle? disk_free ≥ required? not gaming? within maintenance window/policy?
    fail-fast states: OFFLINE | BLOCKED_DISK | DEFERRED_BUSY (retry later)
  DOWNLOADING  ← chunked ranged GETs from master (8 MB chunks, 2 parallel),
                 throttle: NetworkQoS (min bandwidth reserve inverse) + low I/O priority
                 (FILE_PROCESSING_MODE / SetThreadPriority IDLE + I/O priority VeryLow)
  VERIFYING    ← SHA-256 per-file vs manifest (streamed, low priority)
  INSTALLING   ← platform hooks: steamapps.acf merge / epic manifest / symlink or junction
                 into library path; redistributables/anti-cheat handled by running the
                 platform's own first-launch repair — NEVER bypass DRM/licensing (PRD §32)
  READY        ← report complete {manifest_hash}
Pause triggers: session started, CPU/disk contention threshold, admin command, window closed
Resume: conditions re-evaluated each 30 s while PAUSED
```

Integrity failure ⇒ state FAILED with code; never silently READY (PRD §64). Master validates source manifest before accepting a job (PRD §63). Disk management never auto-deletes content without explicit admin policy (PRD §65).

---

## 8. Launcher (WPF + WebView2)

- Shell responsibilities: window management (fullscreen borderless topmost), IPC client, input gating, WebView2 lifecycle.
- Views: game grid (from `games_cache`), session timer bar, food menu/cart (REST via Agent proxy so launcher holds no tokens), session info, "ask staff" button, superadmin prompt.
- While a game runs: shell hides to tray-less no-op, WebView2 renderer suspended (`TrySuspend`), working set trimmed — measured acceptance ≤ 40 MB residual.
- Timer display driven by IPC pushes (1 Hz) — no JS timers doing math drift.

---

## 9. Failure & Recovery Matrix

| Failure | Detection | Recovery |
|---|---|---|
| Internet loss | SSE disconnect / health POST fail | Offline mode: sessions continue, ops queue to outbox, superadmin falls back local |
| Backend outage (net OK) | HTTP 5xx/timeouts | Same as offline; retry with jittered backoff |
| Agent crash | SCM | Service auto-restart (recovery options: restart after 5 s, 3× then reboot fallback) |
| Launcher crash | Supervisor wait handle | Restart launcher ≤ 5 s; session unaffected |
| Windows reboot | Boot start | Agent starts → recover sessions from SQLite → resume/expire → start launcher |
| Power failure | Cold boot path | Same as reboot; trusted clock re-anchors on first contact; monotonic anchor persisted pre-shutdown used conservatively |
| Clock tampering | Divergence check | Block offline session starts, flag audit, countdown continues on QPC |
| Duplicate event upload | Server PK dedupe | `duplicate` ack; prune safely |

---

## 10. Update Strategy (V1 manual, Phase 2 automated)

V1: signed MSI; installer stops service, swaps binaries, runs migration, restarts; preserves SQLite DB. Phase 2 adds cloud-driven staged rollout with signature verification, health-check gate, and automatic rollback to previous version directory if health check fails within 10 minutes (PRD §70). Updates are blocked while any session is active unless `force`d by OWNER role.
