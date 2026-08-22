# Local desktop profile — 2026-08-22

Measured on **DESKTOP-B2P1QBE** (12 cores), dev build `Release`, agent started via `dotnet PcAgent.dll`, launcher spawned by `LauncherSupervisor`.

**Method:** `docs/benchmarks/profile-desktop.ps1` — 120 s idle sample, 5 s intervals. PRD exit criteria call for **30 min** idle; this run is a shorter smoke profile. Re-run with `-DurationSec 1800` for M1 sign-off.

## PRD targets (from `docs/04-pc-agent.md`, `docs/05-milestones.md`)

| Metric | Target | Hard limit | Result (120 s idle) | Status |
|--------|--------|------------|---------------------|--------|
| PcAgent idle CPU (avg) | — | < 0.5 % | **0.034 %** | Pass |
| PcAgent RSS | ≤ 60 MB | ≤ 100 MB | **65.4 MB** max WS | Target miss, hard pass |
| PcAgent private bytes | — | — | **17 MB** end | Informative |
| GamingLauncher idle RSS | — | ≤ 150 MB | **119.9 MB** max WS | Pass |
| GamingLauncher gaming RSS | ≤ 40 MB residual | — | **Not measured** | Pending |
| FPS vs baseline (CapFrameX) | Δ < 1 %, 1 % lows Δ < 2 % | — | **Not measured** | Pending |
| Health cadence idle | 60 s | — | Implemented (`HealthIntervalIdleSeconds`) | Pass (design) |
| Health cadence gaming | 300 s | — | Implemented (`HealthIntervalGamingSeconds`) | Pass (design) |

Raw JSON: `profile-20260822-114620.json` (agent + launcher), `profile-20260822-114202.json` (agent only).

## Implementation vs PRD (`docs/04-pc-agent.md §2`)

| Technique | PRD | Current code |
|-----------|-----|--------------|
| Single 1 s timer | Yes | `PeriodicTimer` in `AgentWorker` |
| Countdown IPC only when not gaming | Yes | `_gamingMode` gate on timer push |
| Lightweight health (`GetSystemTimes`) | Yes | `HealthReporter` |
| Gaming-mode switch | Suspends heavy work | `_gamingMode` reduces health/timer push |
| Workstation GC + trim / R2R | Yes | **Not configured** in `PcAgent.csproj` |
| Job object process wait | Yes | **Not implemented** — `ProcessController` + `WaitForExit` |
| WebView2 + suspend renderer | Yes | **Not used** — pure WPF launcher (lower RAM than WebView2 plan) |
| Deployment pause while gaming | Yes | `DeploymentClient` exists; gaming pause wiring **not verified** |
| CapFrameX benchmark harness | Yes | **Not present** in `/docs/benchmarks` |

## Notes

1. **Agent RSS ~60–65 MB** sits just above the 60 MB *target* but well inside the 100 MB hard cap. Running under `dotnet.exe` includes host working set; a trimmed published `PcAgent.exe` may read lower — worth re-measuring after `PublishTrimmed` / self-contained publish.
2. **Launcher ~120 MB idle** is within the 150 MB architecture budget (`docs/01-architecture.md`). Earlier ~174 MB readings likely involved **duplicate `GamingLauncher` processes** (manual start + supervisor).
3. **Gaming FPS impact** and **launcher RSS during gameplay** are still open M1/M2 exit items — need CapFrameX/PresentMon and a gaming-mode profile pass.
4. **30 min idle** PRD sample not run here; use:

   ```powershell
   .\docs\benchmarks\profile-desktop.ps1 -DurationSec 1800
   ```

## Verdict

**PcAgent idle resource usage is broadly within PRD hard limits** (CPU and RAM < 100 MB) for this short profile. **M1 is not fully signed off:** 30 min idle run, FPS benchmarks, and gaming-mode launcher RAM remain outstanding. Optional tightening: GC trim settings and published (non-`dotnet`) host binary to hit the 60 MB RSS target.
