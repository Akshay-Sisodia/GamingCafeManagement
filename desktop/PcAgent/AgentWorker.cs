using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using PcAgent.Core;
using PcAgent.Core.Api;
using PcAgent.Core.Commands;
using PcAgent.Core.Health;
using PcAgent.Core.Ipc;
using PcAgent.Core.Launcher;
using PcAgent.Core.Options;
using PcAgent.Core.Outbox;
using PcAgent.Core.Sessions;
using PcAgent.Core.Sse;
using PcAgent.Core.Storage;
using PcAgent.Core.Superadmin;
using PcAgent.Core.Sync;
using PcAgent.Core.Time;
using PcAgent.Core.Windows;

namespace PcAgent;

/// <summary>
/// Boot sequence per docs/01 §60: load local state → recover sessions →
/// authenticate → connect SSE → synchronize → launch launcher → serve IPC.
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    private readonly AgentOptions _options;
    private readonly ILogger<AgentWorker> _logger;

    private AgentDatabase? _db;
    private TrustedClock? _clock;
    private OutboxService? _outbox;
    private SessionEngine? _sessions;
    private SyncEngine? _sync;
    private AgentApiClient? _api;
    private SseClient? _sse;
    private IpcServer? _ipc;
    private LauncherSupervisor? _supervisor;
    private ProcessController? _processes;
    private SuperadminService? _superadmin;
    private HealthReporter? _health;

    private string? _deviceToken;
    private string? _pcId;
    private bool _gamingMode;
    private long _lastServerTimeMs;

    public AgentWorker(AgentOptions options, ILogger<AgentWorker> logger)
    {
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Directory.CreateDirectory(_options.DataDirectory);
        var dbPath = Path.Combine(_options.DataDirectory, "agent.db");
        _db = new AgentDatabase(dbPath);
        _clock = new TrustedClock();
        _outbox = new OutboxService(_db);
        _processes = new ProcessController(msg => _logger.LogInformation("process: {Msg}", msg));
        _health = new HealthReporter();

        // Token is stored DPAPI-protected (see PairIfNeededAsync) — unprotect on boot.
        var storedProtected = _db.GetMeta("device_token_protected");
        if (storedProtected is not null)
        {
            try
            {
                _deviceToken = Unprotect(storedProtected);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "stored device token unreadable — re-pairing required");
                _db.SetMeta("device_token_protected", "");
                _db.SetMeta("pc_id", "");
            }
        }
        _pcId = _db.GetMeta("pc_id");
        if (string.IsNullOrEmpty(_pcId)) _pcId = null;
        if (string.IsNullOrEmpty(_deviceToken)) _deviceToken = null;
        _pcId = _db.GetMeta("pc_id");
        _api = new AgentApiClient(_options.ServerBaseUrl);

        _sessions = new SessionEngine(_db, _clock, _outbox, _options.WarningMarksSeconds,
            msg => _logger.LogInformation("session: {Msg}", msg));
        _sessions.Expired += OnSessionExpired;
        _sessions.WarningRaised += w =>
            _logger.LogWarning("session warning: {Sec}s remaining", w.RemainingSeconds);

        _superadmin = new SuperadminService(
            _db,
            scope => CheckRateLimit(scope),
            scope => FailRateLimit(scope),
            () => ResetRateLimit(scope0: "superadmin"),
            (action, meta) =>
            {
                _outbox.Enqueue(action, JsonSerializer.SerializeToElement(new { action, metadata = JsonDocument.Parse(meta).RootElement.Clone() }));
                _db.ExecuteNonQuery(
                    "INSERT OR IGNORE INTO audit_pending(event_id, action, occurred_at, metadata) VALUES($id,$a,$at,$m)",
                    ("$id", Uuid7.NewId()), ("$a", action), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$m", meta));
            },
            msg => _logger.LogInformation("superadmin: {Msg}", msg));

        _sync = new SyncEngine(
            _outbox,
            () => IsPaired() ? _api : null,
            () => (_deviceToken!, _pcId!, "1.0.0"),
            msg => _logger.LogInformation("sync: {Msg}", msg));

        StartSse();
        StartIpc();

        _supervisor = new LauncherSupervisor(_options.LauncherPath,
            msg => _logger.LogInformation("launcher: {Msg}", msg));
        if (File.Exists(_options.LauncherPath))
        {
            _supervisor.Start();
        }
        else
        {
            _logger.LogWarning("launcher not found at {Path}; skipping supervisor", _options.LauncherPath);
        }

        // Main 1s loop — the only per-second work in the process.
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        var lastHealth = DateTimeOffset.MinValue;
        var lastTimeSync = DateTimeOffset.MinValue;
        var lastSyncPass = DateTimeOffset.MinValue;

        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                _sessions!.Tick();

                // 1 Hz countdown push to the launcher (suppressed in gaming mode —
                // the WebView/renderer must stay idle while a game runs).
                if (!_gamingMode && _ipc is not null &&
                    _sessions.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
                {
                    await _ipc.PushAsync("timer", JsonSerializer.SerializeToElement(
                        new { remaining_seconds = _sessions.RemainingSeconds() }));
                }

                if (DateTimeOffset.UtcNow - lastTimeSync > TimeSpan.FromSeconds(_options.TimeSyncIntervalSeconds))
                {
                    await TrySyncClockAsync(stoppingToken);
                    lastTimeSync = DateTimeOffset.UtcNow;
                }

                if (!_gamingMode && DateTimeOffset.UtcNow - lastHealth > TimeSpan.FromSeconds(_options.HealthIntervalIdleSeconds)
                    || _gamingMode && DateTimeOffset.UtcNow - lastHealth > TimeSpan.FromSeconds(_options.HealthIntervalGamingSeconds))
                {
                    await PostHealthAsync(stoppingToken);
                    lastHealth = DateTimeOffset.UtcNow;
                }

                if (IsOnline() && DateTimeOffset.UtcNow - lastSyncPass > TimeSpan.FromSeconds(30))
                {
                    await _sync.SyncOnceAsync(stoppingToken);
                    lastSyncPass = DateTimeOffset.UtcNow;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "agent loop iteration failed");
            }
        }
    }

    // ---- pairing / identity ------------------------------------------------

    private bool IsPaired() => _deviceToken is not null && _pcId is not null;

    private bool IsOnline() => _sse?.IsConnected == true;

    private async Task PairIfNeededAsync(CancellationToken ct)
    {
        if (IsPaired()) return;

        // Zero-touch rollout: enrollment token registers this machine
        // automatically (creates its PC record from the hostname).
        var enrollToken = _options.EnrollToken ?? Environment.GetEnvironmentVariable("ENROLL_TOKEN");
        if (!string.IsNullOrEmpty(enrollToken))
        {
            await EnrollAsync(enrollToken, ct);
            return;
        }

        var code = _db!.GetMeta("pairing_code");
        if (string.IsNullOrEmpty(code))
        {
            // Provisioned via registry (installer/configure script) or env var.
            code = _options.PairingCode ?? Environment.GetEnvironmentVariable("PAIRING_CODE");
        }
        if (string.IsNullOrEmpty(code))
        {
            _logger.LogWarning("not paired and no pairing code available; waiting for provisioning");
            return;
        }

        try
        {
            var fingerprint = ComputeFingerprint();
            var result = await _api!.PairAsync(code, fingerprint, "1.0.0", ct);
            StoreIdentity(result);
            _logger.LogInformation("paired as {PcId}", _pcId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "pairing failed");
        }
    }

    private async Task EnrollAsync(string enrollToken, CancellationToken ct)
    {
        try
        {
            var result = await _api!.EnrollAsync(
                enrollToken, Environment.MachineName, ComputeFingerprint(), "1.0.0", ct);
            StoreIdentity(result);
            _logger.LogInformation("enrolled as {PcId}", _pcId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "enrollment failed");
        }
    }

    private void StoreIdentity(System.Text.Json.JsonElement result)
    {
        _deviceToken = result.GetProperty("device_token").GetString();
        _pcId = result.GetProperty("pc_id").GetString();
        _db!.SetMeta("device_token_protected", Protect(_deviceToken!));
        _db.SetMeta("pc_id", _pcId!);
    }

    internal static string ComputeFingerprint()
    {
        // Machine-level identity: machine name + SID of SYSTEM + CPU id would be
        // stronger; keep deterministic and dependency-free for V1.
        var raw = $"{Environment.MachineName}|{Environment.OSVersion.VersionString}";
        return Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)));
    }

    private static string Protect(string value)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(value);
        var protectedBytes = System.Security.Cryptography.ProtectedData.Protect(bytes, null, System.Security.Cryptography.DataProtectionScope.LocalMachine);
        return Convert.ToBase64String(protectedBytes);
    }

    private static string Unprotect(string base64)
    {
        var bytes = Convert.FromBase64String(base64);
        var unprotected = System.Security.Cryptography.ProtectedData.Unprotect(bytes, null, System.Security.Cryptography.DataProtectionScope.LocalMachine);
        return System.Text.Encoding.UTF8.GetString(unprotected);
    }

    // ---- SSE -----------------------------------------------------------------

    private void StartSse()
    {
        _sse = new SseClient(
            requestFactory: async ct =>
            {
                await PairIfNeededAsync(ct);
                if (!IsPaired()) throw new InvalidOperationException("unpaired");
                var url = $"{_options.ServerBaseUrl}/v1/realtime/pc?token={Uri.EscapeDataString(_deviceToken!)}&pc_id={Uri.EscapeDataString(_pcId!)}";
                return new HttpRequestMessage(HttpMethod.Get, url);
            },
            onEvent: ev => HandleSseEvent(ev),
            log: msg => _logger.LogInformation("sse: {Msg}", msg));
        _sse.ConnectionChanged += connected =>
            _logger.LogInformation("SSE {State}", connected ? "connected" : "disconnected");
        _sse.Start();
    }

    private void HandleSseEvent(SseEvent ev)
    {
        switch (ev.EventName)
        {
            case "command":
                {
                    using var doc = JsonDocument.Parse(ev.Data);
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var command = doc.RootElement.Clone();
                            var handler = new CommandHandler(
                                _sessions!,
                                _processes!,
                                RefreshConfigAsync,
                                ackApplied: id => _api!.AckCommandAsync(_deviceToken!, _pcId!, id, "applied", null, CancellationToken.None),
                                ackFailed: (id, code) => _api!.AckCommandAsync(_deviceToken!, _pcId!, id, "failed", code, CancellationToken.None),
                                log: msg => _logger.LogInformation("command: {Msg}", msg));
                            await handler.HandleAsync(command, CancellationToken.None);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "command handling failed");
                        }
                    });
                    break;
                }
            case "session.updated":
                {
                    using var doc = JsonDocument.Parse(ev.Data);
                    var expiresAt = doc.RootElement.TryGetProperty("expires_at", out var e)
                        ? DateTimeOffset.Parse(e.GetString()!).ToUnixTimeMilliseconds()
                        : (long?)null;
                    var status = doc.RootElement.TryGetProperty("status", out var s) ? s.GetString() : null;

                    if (status == "active" && expiresAt is not null)
                    {
                        // Cloud-originated change: adopt locally WITHOUT echoing
                        // back into the outbox (server already knows).
                        if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
                        {
                            // Align expiry with the server (covers remote extends).
                            var localRemaining = _sessions.RemainingSeconds();
                            var serverRemaining = (int)Math.Max(0, (expiresAt.Value - _clock!.EffectiveNowMs()) / 1000);
                            var deltaMinutes = (int)Math.Round((serverRemaining - localRemaining) / 60.0);
                            if (deltaMinutes > 0)
                            {
                                _sessions.Extend(deltaMinutes, suppressOutboxEcho: true);
                                _logger.LogInformation("adopted remote extension (+{Min}m)", deltaMinutes);
                            }
                        }
                        else
                        {
                            var remainingMin = (int)Math.Max(1, (expiresAt.Value - _clock!.EffectiveNowMs()) / 60000);
                            _sessions.StartSession(remainingMin, "admin", null, suppressOutboxEcho: true);
                            _logger.LogInformation("adopted cloud session ({Min}m)", remainingMin);
                        }
                    }
                    else if (status is "ended" or "cancelled" or "expired")
                    {
                        if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
                        {
                            _sessions.End($"cloud_{status}", suppressOutboxEcho: true);
                            _processes!.KillAllTracked();
                            _gamingMode = false;
                        }
                    }
                    break;
                }
            default:
                _logger.LogDebug("SSE event {Name} ignored", ev.EventName);
                break;
        }
    }

    private Task RefreshConfigAsync() => Task.CompletedTask;

    // ---- IPC -------------------------------------------------------------------

    private void StartIpc()
    {
        _ipc = new IpcServer(async (req, ct) =>
        {
            switch (req.Method)
            {
                case "bootstrap":
                    return new Dictionary<string, object?>
                    {
                        ["pc_id"] = _pcId,
                        ["session"] = _sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring
                            ? new { state = "active", expires_at = DateTimeOffset.FromUnixTimeMilliseconds(_sessions.ExpiresEffMs() ?? 0).ToString("O") }
                            : new { state = "none" },
                        ["games"] = LoadGamesCache(),
                    };

                case "session.start":
                    {
                        var minutes = req.Payload.TryGetProperty("planned_minutes", out var pm) ? pm.GetInt32() : 60;
                        var localRef = _sessions!.StartSession(minutes, "launcher");
                        return new { local_ref = localRef };
                    }

                case "session.extend":
                    _sessions!.Extend(req.Payload.TryGetProperty("minutes", out var m) ? m.GetInt32() : 15);
                    return new { ok = true };

                case "game.launch":
                    {
                        var exe = req.Payload.TryGetProperty("executable_path", out var exeEl) ? exeEl.GetString() : null;
                        var args = req.Payload.TryGetProperty("launch_args", out var argsEl) ? argsEl.GetString() : null;
                        if (exe is null) throw new ArgumentException("missing executable_path");
                        _processes!.LaunchTracked(exe, args);
                        _gamingMode = true;
                        return new { ok = true };
                    }

                case "order.place":
                    {
                        if (!IsPaired()) throw new InvalidOperationException("offline: cannot place orders");
                        var body = new Dictionary<string, object?> { ["source"] = "launcher" };
                        foreach (var prop in req.Payload.EnumerateObject())
                        {
                            body[prop.Name] = prop.Value.Clone();
                        }
                        using var httpReq = new HttpRequestMessage(HttpMethod.Post, $"{_options.ServerBaseUrl}/v1/orders")
                        {
                            Content = new StringContent(JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json"),
                        };
                        httpReq.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _deviceToken);
                        httpReq.Headers.Add("X-PC-Id", _pcId);
                        using var resp = await new HttpClient().SendAsync(httpReq, ct);
                        resp.EnsureSuccessStatusCode();
                        var json = await System.Text.Json.JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
                        return new { order_number = json.RootElement.TryGetProperty("number", out var n) ? n.GetInt32() : 0 };
                    }

                case "superadmin.verify":
                    {
                        var password = req.Payload.TryGetProperty("password", out var pw) ? pw.GetString() : null;
                        if (password is null) throw new ArgumentException("missing password");

                        // Prefer online verification; fall back offline.
                        var onlineOk = IsPaired() &&
                            await _api!.VerifySuperadminOnlineAsync(_deviceToken!, _pcId!, password, ct);
                        var ok = onlineOk || _superadmin!.VerifyOffline(password).Ok;
                        return new { ok };
                    }

                case "maintenance.action":
                    {
                        var action = req.Payload.TryGetProperty("action", out var a) ? a.GetString() : null;
                        switch (action)
                        {
                            case "restart": _processes!.RestartMachine(); break;
                            case "shutdown": _processes!.ShutdownMachine(); break;
                            case "enter_windows": /* fast-user-switch handled by launcher exit */ break;
                            default: throw new ArgumentException($"unknown action {action}");
                        }
                        return new { ok = true };
                    }

                default:
                    throw new ArgumentException($"unknown method {req.Method}");
            }
        }, msg => _logger.LogInformation("ipc: {Msg}", msg));
        _ipc.Start();
    }

    private static object[] LoadGamesCache() => Array.Empty<object>();

    // ---- session events ----------------------------------------------------------

    private void OnSessionExpired(SessionExpiredArgs args)
    {
        _logger.LogWarning("session expired: {Ref}", args.LocalRef);
        _processes!.KillAllTracked();
        _gamingMode = false;
    }

    // ---- clock / health ------------------------------------------------------------

    private async Task TrySyncClockAsync(CancellationToken ct)
    {
        try
        {
            if (!IsPaired())
            {
                await PairIfNeededAsync(ct);
                if (!IsPaired()) return;
            }
            var serverMs = await _api!.TimeCheckAsync(ct);
            _lastServerTimeMs = serverMs;
            _clock!.UpdateFromServer(serverMs);
            _db!.SetMeta("last_server_time_ms", serverMs.ToString());

            var divergence = _clock.AbsoluteDivergenceSeconds();
            if (divergence > _options.TamperDivergenceThresholdSeconds)
            {
                _logger.LogWarning("wall-clock divergence {Sec:F0}s detected", divergence);
                _outbox!.Enqueue("TAMPER_SUSPECTED",
                    JsonSerializer.SerializeToElement(new { divergence_seconds = divergence }));
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("time sync unavailable: {Msg}", ex.Message);
        }
    }

    private async Task PostHealthAsync(CancellationToken ct)
    {
        if (!IsPaired()) return;
        try
        {
            var sample = _health!.Sample();
            await _api!.PostHealthAsync(_deviceToken!, _pcId!, new
            {
                cpu_pct = sample.CpuPct,
                ram_pct = sample.RamPct,
                gpu_pct = (double?)null,
                disk_pct = sample.DiskPct,
                disk_free_bytes = sample.DiskFreeBytes,
                uptime_s = sample.UptimeSeconds,
                agent_status = "healthy",
            }, ct);
        }
        catch (Exception ex)
        {
            _logger.LogDebug("health post failed: {Msg}", ex.Message);
        }
    }

    // ---- rate limiting (persisted across reboots) -------------------------------------

    private SuperadminService.RateLimitDecision CheckRateLimit(string scope)
    {
        var rows = _db!.Query("SELECT fail_count, locked_until FROM rate_limit WHERE scope = $s", ("$s", scope));
        if (rows.Count == 0) return new SuperadminService.RateLimitDecision(true, 0);

        var lockedUntil = rows[0]!["locked_until"] as string;
        if (lockedUntil is not null &&
            DateTimeOffset.TryParse(lockedUntil, out var until) &&
            until > DateTimeOffset.UtcNow)
        {
            return new SuperadminService.RateLimitDecision(false, (int)Math.Ceiling((until - DateTimeOffset.UtcNow).TotalSeconds));
        }
        return new SuperadminService.RateLimitDecision(true, 0);
    }

    private void FailRateLimit(string scope)
    {
        var rows = _db!.Query("SELECT fail_count FROM rate_limit WHERE scope = $s", ("$s", scope));
        var fails = rows.Count > 0 ? Convert.ToInt32(rows[0]!["fail_count"]) : 0;
        fails++;
        var lockSeconds = Math.Min(30 * (long)Math.Pow(2, Math.Max(0, fails - 5)), 900); // from 5th failure
        var lockedUntil = fails >= 5 ? DateTimeOffset.UtcNow.AddSeconds(lockSeconds).ToString("O") : null;
        _db.ExecuteNonQuery(
            """
            INSERT INTO rate_limit(scope, fail_count, locked_until) VALUES($s, $f, $l)
            ON CONFLICT(scope) DO UPDATE SET fail_count = $f, locked_until = $l
            """,
            ("$s", scope), ("$f", fails), ("$l", lockedUntil));
    }

    private void ResetRateLimit(string scope0)
    {
        _db!.ExecuteNonQuery("DELETE FROM rate_limit WHERE scope = $s", ("$s", scope0));
    }
}
