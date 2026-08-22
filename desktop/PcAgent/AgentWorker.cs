using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using PcAgent.Core;
using PcAgent.Core.Api;
using PcAgent.Core.Commands;
using PcAgent.Core.Games;
using PcAgent.Games;
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
    private bool _timerPushLogged;
    private long _lastServerTimeMs;
    private CancellationTokenSource _lifetime = new();
    private GameLibraryService? _gameLibrary;
    private List<LauncherGameDto> _launcherGames = new();
    private List<Dictionary<string, object?>> _menuItems = new();
    private readonly string _ipcToken;
    private readonly object _launcherGamesGate = new();
    private readonly object _menuGate = new();

    public AgentWorker(AgentOptions options, ILogger<AgentWorker> logger)
    {
        _options = options;
        _logger = logger;
        Directory.CreateDirectory(options.DataDirectory);
        _ipcToken = IpcTokenStore.LoadOrCreate(options.DataDirectory);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _lifetime = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        Directory.CreateDirectory(_options.DataDirectory);
        var dbPath = Path.Combine(_options.DataDirectory, "agent.db");
        _db = new AgentDatabase(dbPath);
        _gameLibrary = new GameLibraryService(_db, _options.DataDirectory, msg => _logger.LogInformation("{Msg}", msg));
        var discovered = _gameLibrary.ImportDiscovered(onlyNew: true);
        var pruned = _gameLibrary.PruneNonGames();
        _logger.LogInformation("games: boot scan added {Added} new title(s), pruned {Pruned}", discovered, pruned);
        ReloadLocalGames();
        _clock = new TrustedClock();
        _outbox = new OutboxService(_db);
        _processes = new ProcessController(msg => _logger.LogInformation("process: {Msg}", msg));
        _processes.TrackedProcessesChanged += () =>
        {
            if (_processes.TrackedRunningCount() == 0) _gamingMode = false;
        };
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
        // Crash/reboot recovery: resume or expire any session found on disk
        // BEFORE the SSE loop starts adopting cloud state.
        _sessions.RecoverOnBoot();
        _sessions.StateChanged += state =>
        {
            if (state == LocalSessionState.NoSession)
            {
                _gamingMode = false;
                _timerPushLogged = false;
            }
            _ = PushSessionStateToLauncherAsync();
        };

        _superadmin = new SuperadminService(
            _db,
            scope => CheckRateLimit(scope),
            scope => FailRateLimit(scope),
            () => ResetRateLimit(scope0: "superadmin"),
            (action, meta) =>
            {
                using var doc = JsonDocument.Parse(meta);
                _outbox.Enqueue(action, JsonSerializer.SerializeToElement(new { action, metadata = doc.RootElement.Clone() }));
                _db.ExecuteNonQuery(
                    "INSERT OR IGNORE INTO audit_pending(event_id, action, occurred_at, metadata) VALUES($id,$a,$at,$m)",
                    ("$id", Guid.CreateVersion7().ToString()), ("$a", action), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$m", meta));
            },
            msg => _logger.LogInformation("superadmin: {Msg}", msg));

        if (_options.AllowDevSuperadminProvisioner &&
            !_superadmin.HasVerifier() &&
            string.Equals(Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"), "Development", StringComparison.OrdinalIgnoreCase))
        {
            _superadmin.SetVerifier(SuperadminService.CreateVerifier("Password123!"), []);
            _logger.LogInformation("superadmin: dev local verifier provisioned (Password123!)");
        }

        _sync = new SyncEngine(
            _outbox,
            () => IsPaired() ? _api : null,
            () => (_deviceToken!, _pcId!, "1.0.0"),
            msg => _logger.LogInformation("sync: {Msg}", msg));

        StartSse();
        StartIpc();

        if (IsPaired())
        {
            try { await SyncFromBootstrapAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogDebug("initial bootstrap sync: {Msg}", ex.Message); }
            try { await RefreshMenuAsync(stoppingToken); }
            catch (Exception ex) { _logger.LogDebug("initial menu sync: {Msg}", ex.Message); }
        }

        _supervisor = new LauncherSupervisor(_options.LauncherPath, _ipcToken,
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
                // the renderer must stay idle while a game runs).
                if (!_gamingMode && _ipc is not null &&
                    _sessions.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
                {
                    await _ipc.PushAsync("timer", JsonSerializer.SerializeToElement(
                        new { remaining_seconds = _sessions.RemainingSeconds() }));
                    if (!_timerPushLogged)
                    {
                        _timerPushLogged = true;
                        _logger.LogInformation("timer stream active ({Sec}s remaining)", _sessions.RemainingSeconds());
                    }
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
                    await _sync!.SyncOnceAsync(stoppingToken);
                    await SyncFromBootstrapAsync(stoppingToken);
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

    /// <summary>
    /// Server rejected our credentials (PC record deleted server-side, DB
    /// reset, token rotation). Drop the stored identity so the next SSE
    /// attempt re-enrolls/pairs from scratch.
    /// </summary>
    private void ClearIdentity()
    {
        if (!IsPaired()) return;
        _logger.LogWarning("clearing stored identity after auth rejection");
        _db!.SetMeta("device_token_protected", "");
        _db.SetMeta("pc_id", "");
        _deviceToken = null;
        _pcId = null;
    }

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
        _sse.AuthRejected += ClearIdentity;
        _sse.ConnectionChanged += connected =>
        {
            if (connected)
            {
                // Refetch authoritative session on every (re)connect.
                _ = Task.Run(async () =>
                {
                    try { await SyncFromBootstrapAsync(_lifetime.Token); }
                    catch { /* logged inside */ }
                });
            }
        };
        _sse.Start();
    }

    private readonly SemaphoreSlim _sseEventGate = new(1, 1);

    private void HandleSseEvent(SseEvent ev)
    {
        // Serialize event application — concurrent deliveries (reconnect
        // replay + live push) must not race the local session store.
        _sseEventGate.Wait();
        try
        {
            ApplySseEvent(ev);
        }
        finally
        {
            _sseEventGate.Release();
        }
    }

    private void ApplySseEvent(SseEvent ev)
    {
        switch (ev.EventName)
        {
            case "command":
                {
                    using var doc = JsonDocument.Parse(ev.Data);
                    var command = doc.RootElement.Clone();
                    try
                    {
                        var handler = new CommandHandler(
                            _sessions!,
                            _processes!,
                            () => Task.CompletedTask,
                            ackApplied: id => _api!.AckCommandAsync(_deviceToken!, _pcId!, id, "applied", null, CancellationToken.None),
                            ackFailed: (id, code) => _api!.AckCommandAsync(_deviceToken!, _pcId!, id, "failed", code, CancellationToken.None),
                            log: msg => _logger.LogInformation("command: {Msg}", msg));
                        handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "command handling failed");
                    }
                    break;
                }
            case "session.updated":
            case "session.ended":
            case "session.cancelled":
            case "session.expired":
                ApplySessionUpdatedFromSse(ev.Data);
                break;
            default:
                _logger.LogDebug("SSE event {Name} ignored", ev.EventName);
                break;
        }
    }

    private void ApplySessionUpdatedFromSse(string data)
    {
        using var doc = JsonDocument.Parse(data);
        var expiresAt = doc.RootElement.TryGetProperty("expires_at", out var e)
            ? DateTimeOffset.Parse(e.GetString()!).ToUnixTimeMilliseconds()
            : (long?)null;
        var status = doc.RootElement.TryGetProperty("status", out var s) ? s.GetString() : null;

        if (expiresAt is not null && status is not null)
        {
            AdoptServerSessionState(status, expiresAt.Value);
        }
    }

    /// <summary>
    /// Makes the local session agree with the server's view. Cloud-originated:
    /// never echoes into the outbox (server already knows).
    /// </summary>
    private void AdoptServerSessionState(string status, long expiresEffMs)
    {
        if (status == "active")
        {
            _sessions!.SetPaused(false);
            if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
            {
                var localExpires = _sessions.ExpiresEffMs() ?? 0;
                if (Math.Abs(expiresEffMs - localExpires) > 3000)
                {
                    _sessions.SetExpiresEffMs(expiresEffMs, suppressOutboxEcho: true);
                    var remainingSec = Math.Max(0, (expiresEffMs - _clock!.EffectiveNowMs()) / 1000);
                    _logger.LogInformation("aligned session expiry with server ({Sec}s remaining)", remainingSec);
                }
            }
            else
            {
                _sessions!.StartSession(0, "admin", null, suppressOutboxEcho: true, expiresEffMs: expiresEffMs);
                var remainingSec = Math.Max(0, (expiresEffMs - _clock!.EffectiveNowMs()) / 1000);
                _logger.LogInformation("adopted cloud session ({Sec}s remaining)", remainingSec);
            }
        }
        else if (status == "paused")
        {
            if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
            {
                _sessions.SetPaused(true);
                _logger.LogInformation("adopted remote session pause");
            }
        }
        else if (status is "ended" or "cancelled" or "expired")
        {
            if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
            {
                _sessions.End($"cloud_{status}", suppressOutboxEcho: true);
                _processes!.KillAllTracked();
                _gamingMode = false;
                _logger.LogInformation("adopted remote session end ({Status})", status);
            }
        }
    }

    private async Task PushSessionStateToLauncherAsync()
    {
        if (_ipc is null || _sessions is null) return;

        var active = _sessions.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring;
        var paused = _sessions.IsPaused;
        var remaining = active ? _sessions.RemainingSeconds() : 0;

        await _ipc.PushAsync("session", JsonSerializer.SerializeToElement(new
        {
            state = paused ? "paused" : active ? "active" : "none",
            expires_at = active
                ? DateTimeOffset.FromUnixTimeMilliseconds(_sessions.ExpiresEffMs() ?? 0).ToString("O")
                : null,
            remaining_seconds = remaining,
        }));
        await _ipc.PushAsync("timer", JsonSerializer.SerializeToElement(
            new { remaining_seconds = remaining }));
    }

    private void ReloadLocalGames()
    {
        var loaded = _gameLibrary!.Load();
        var next = loaded
            .Where(g => File.Exists(g.ExecutablePath))
            .Select(g => new LauncherGameDto(
                g.Id, g.Name, g.ExecutablePath, g.LaunchArgs, g.IconUrl, g.IconPath, g.Category))
            .ToList();
        lock (_launcherGamesGate)
        {
            _launcherGames = next;
        }
        _logger.LogInformation(
            "games: loaded {Count} titles from {Path}",
            next.Count,
            _gameLibrary.Store.ConfigPath);
        _ = PushGamesToLauncherAsync();
    }

    private async Task PushGamesToLauncherAsync()
    {
        if (_ipc is null) return;

        List<LauncherGameDto> snapshot;
        lock (_launcherGamesGate) snapshot = _launcherGames.ToList();

        var items = snapshot.Select(g => new
        {
            game_id = g.Id,
            name = g.Name,
            executable_path = g.ExecutablePath,
            launch_args = g.LaunchArgs,
            icon_url = g.IconUrl,
            icon_path = g.IconPath,
            category = g.Category,
        }).ToList();

        await _ipc.PushAsync("games", JsonSerializer.SerializeToElement(new { items }));
    }

    private List<Dictionary<string, object?>> MenuSnapshot()
    {
        lock (_menuGate) return _menuItems.ToList();
    }

    private async Task RefreshMenuAsync(CancellationToken ct)
    {
        if (!IsPaired() || _api is null) return;
        var json = await _api.GetMenuAsync(_deviceToken!, _pcId!, ct);
        if (!json.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array) return;

        var next = itemsEl.EnumerateArray()
            .Select(el => new Dictionary<string, object?>
            {
                ["id"] = el.GetProperty("id").GetString(),
                ["name"] = el.GetProperty("name").GetString(),
                ["price_amount"] = el.GetProperty("price_amount").GetInt32(),
                ["category"] = el.TryGetProperty("category", out var cat) ? cat.GetString() : null,
            })
            .ToList();

        lock (_menuGate) _menuItems = next;
        _logger.LogInformation("menu: loaded {Count} available item(s) from server", next.Count);

        if (_ipc is not null)
        {
            await _ipc.PushAsync("menu", JsonSerializer.SerializeToElement(new { items = next }));
        }
    }

    private sealed record LauncherGameDto(
        string Id,
        string Name,
        string ExecutablePath,
        string LaunchArgs,
        string? IconUrl,
        string? IconPath,
        string? Category);

    /// <summary>
    /// Server-refetch safety net: on every SSE (re)connect, pull the authoritative
    /// session so a reboot — even with a wiped local database — continues the
    /// same session.
    /// </summary>
    private async Task SyncFromBootstrapAsync(CancellationToken ct)
    {
        try
        {
            if (!IsPaired() || _api is null) return;
            var bootstrap = await _api.BootstrapAsync(_deviceToken!, _pcId!, ct);
            var sessionEl = bootstrap.TryGetProperty("active_session", out var s) ? s : default;
            if (sessionEl.ValueKind == JsonValueKind.Object)
            {
                var expiresMs = sessionEl.TryGetProperty("expires_at", out var exp)
                    ? DateTimeOffset.Parse(exp.GetString()!).ToUnixTimeMilliseconds()
                    : (long?)null;
                var st = sessionEl.TryGetProperty("status", out var stat) ? stat.GetString() : null;
                if (expiresMs is not null && st is not null)
                {
                    _sseEventGate.Wait(ct);
                    try { AdoptServerSessionState(st, expiresMs.Value); }
                    finally { _sseEventGate.Release(); }
                }
            }
            else if (_sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
            {
                // Server says nothing active but we think there is — server wins.
                _sessions.End("server_reset", suppressOutboxEcho: true);
                _processes!.KillAllTracked();
                _gamingMode = false;
                _logger.LogInformation("cleared local session after server bootstrap reset");
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug("bootstrap session sync unavailable: {Msg}", ex.Message);
        }
    }

    // ---- IPC -------------------------------------------------------------------

    private void StartIpc()
    {
        _ipc = new IpcServer(async (req, ct) =>
        {
            if (!ValidateIpcToken(req)) return new { ok = false, error = "unauthorized_ipc" };

            switch (req.Method)
            {
                case "bootstrap":
                    {
                        var active = _sessions!.CurrentState is LocalSessionState.Active or LocalSessionState.Expiring;
                        List<LauncherGameDto> gamesSnapshot;
                        lock (_launcherGamesGate) gamesSnapshot = _launcherGames.ToList();
                        return new Dictionary<string, object?>
                        {
                            ["pc_id"] = _pcId,
                            ["session"] = active
                                ? new
                                {
                                    state = _sessions.IsPaused ? "paused" : "active",
                                    expires_at = DateTimeOffset.FromUnixTimeMilliseconds(_sessions.ExpiresEffMs() ?? 0).ToString("O"),
                                    remaining_seconds = _sessions.RemainingSeconds(),
                                }
                                : new { state = "none" },
                            ["games"] = gamesSnapshot.Select(g => new
                            {
                                game_id = g.Id,
                                name = g.Name,
                                executable_path = g.ExecutablePath,
                                launch_args = g.LaunchArgs,
                                icon_url = g.IconUrl,
                                icon_path = g.IconPath,
                                category = g.Category,
                            }).ToList(),
                            ["menu"] = MenuSnapshot(),
                        };
                    }

                case "session.start":
                    {
                        await _sseEventGate.WaitAsync(ct);
                        try
                        {
                            var minutes = req.Payload.TryGetProperty("planned_minutes", out var pm) ? pm.GetInt32() : 60;
                            var localRef = _sessions!.StartSession(minutes, "launcher");
                            return new { local_ref = localRef };
                        }
                        finally { _sseEventGate.Release(); }
                    }

                case "session.extend":
                    {
                        await _sseEventGate.WaitAsync(ct);
                        try
                        {
                            _sessions!.Extend(req.Payload.TryGetProperty("minutes", out var m) ? m.GetInt32() : 15);
                            return new { ok = true };
                        }
                        finally { _sseEventGate.Release(); }
                    }

                case "game.launch":
                    {
                        if (_sessions!.CurrentState is not (LocalSessionState.Active or LocalSessionState.Expiring))
                            return new { ok = false, error = "no_active_session" };
                        var exe = req.Payload.TryGetProperty("executable_path", out var exeEl) ? exeEl.GetString() : null;
                        var args = req.Payload.TryGetProperty("launch_args", out var argsEl) ? argsEl.GetString() : null;
                        if (exe is null) throw new ArgumentException("missing executable_path");
                        if (!File.Exists(exe)) throw new FileNotFoundException($"Game not installed on this PC: {exe}");
                        _processes!.LaunchTracked(exe, args);
                        _gamingMode = true;
                        return new { ok = true };
                    }

                case "order.place":
                    {
                        if (!IsPaired()) throw new InvalidOperationException("offline: cannot place orders");
                        if (_sessions!.CurrentState is not (LocalSessionState.Active or LocalSessionState.Expiring))
                            return new { ok = false, error = "no_active_session" };

                        var orderItems = new List<Dictionary<string, object>>();
                        if (req.Payload.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
                        {
                            itemsEl.EnumerateArray().ToList().ForEach(item =>
                            {
                                var menuItemId = item.TryGetProperty("menu_item_id", out var mid) ? mid.GetString() : null;
                                var qty = item.TryGetProperty("qty", out var q) ? q.GetInt32() : 0;
                                if (menuItemId is null || qty < 1) return;
                                orderItems.Add(new Dictionary<string, object>
                                {
                                    ["menu_item_id"] = menuItemId,
                                    ["qty"] = qty,
                                });
                            });
                        }
                        if (orderItems.Count == 0) throw new ArgumentException("missing items");

                        var body = new Dictionary<string, object?>
                        {
                            ["items"] = orderItems,
                            ["session_id"] = _sessions.ServerSessionId(),
                        };
                        var result = await _api!.PlaceOrderAsync(_deviceToken!, _pcId!, body, ct);
                        var orderNumber = result.TryGetProperty("order_number", out var num) ? num.GetInt32() : 0;
                        _logger.LogInformation("order placed from launcher: #{Number}", orderNumber);
                        return new { ok = true, order_number = orderNumber };
                    }

                case "superadmin.verify":
                    {
                        var password = req.Payload.TryGetProperty("password", out var pw) ? pw.GetString() : null;
                        if (password is null) throw new ArgumentException("missing password");

                        var limit = CheckRateLimit("superadmin");
                        if (!limit.Allowed)
                            return new { ok = false, reason = "rate_limited", retry_after_s = limit.RetryAfterSeconds };

                        if (IsPaired())
                        {
                            var onlineOk = await _api!.VerifySuperadminOnlineAsync(_deviceToken!, _pcId!, password, ct);
                            if (onlineOk)
                            {
                                ResetRateLimit("superadmin");
                                return new { ok = true, reason = "online" };
                            }
                            FailRateLimit("superadmin");
                        }

                        var offlineResult = _superadmin!.VerifyOffline(password);
                        if (offlineResult.Ok)
                            return new { ok = true, reason = "offline" };

                        if (offlineResult.RetryAfterSeconds > 0)
                            return new { ok = false, reason = "rate_limited", retry_after_s = offlineResult.RetryAfterSeconds };

                        var reason = _superadmin.HasVerifier() ? "bad_password" : "no_verifier";
                        return new { ok = false, reason };
                    }

                case "games.scan":
                    {
                        var items = _gameLibrary!.ScanInstalled()
                            .Select(d => new
                            {
                                name = d.Name,
                                executable_path = d.ExecutablePath,
                                launch_args = d.LaunchArgs,
                                source_path = d.SourcePath,
                                category = d.Category,
                                in_library = _gameLibrary.Store.HasExecutable(d.ExecutablePath),
                            })
                            .ToList();
                        return new { items };
                    }

                case "games.import_discovered":
                    {
                        var added = _gameLibrary!.ImportDiscovered(onlyNew: true);
                        var pruned = _gameLibrary.PruneNonGames();
                        ReloadLocalGames();
                        return new { added_count = added, pruned_count = pruned, total = _launcherGames.Count };
                    }

                case "games.add":
                    {
                        var path = req.Payload.TryGetProperty("shortcut_path", out var sp) ? sp.GetString() : null;
                        var name = req.Payload.TryGetProperty("name", out var nm) ? nm.GetString() : null;
                        if (path is null) throw new ArgumentException("missing shortcut_path");
                        var game = _gameLibrary!.AddFromShortcut(path, name);
                        ReloadLocalGames();
                        return new { game_id = game.Id, name = game.Name, icon_path = game.IconPath };
                    }

                case "games.remove":
                    {
                        var gameId = req.Payload.TryGetProperty("game_id", out var gid) ? gid.GetString() : null;
                        if (gameId is null) throw new ArgumentException("missing game_id");
                        var ok = _gameLibrary!.Remove(gameId);
                        ReloadLocalGames();
                        return new { ok };
                    }

                case "games.set_thumbnail":
                    {
                        var gameId = req.Payload.TryGetProperty("game_id", out var tid) ? tid.GetString() : null;
                        var imagePath = req.Payload.TryGetProperty("image_path", out var ip) ? ip.GetString() : null;
                        if (gameId is null) return new { ok = false, error = "missing game_id" };
                        if (imagePath is null) return new { ok = false, error = "missing image_path" };
                        try
                        {
                            var game = _gameLibrary!.SetThumbnail(gameId, imagePath);
                            ReloadLocalGames();
                            return new { ok = true, game_id = game.Id, icon_path = game.IconPath };
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning("games.set_thumbnail failed: {Msg}", ex.Message);
                            return new { ok = false, error = ex.Message };
                        }
                    }

                case "games.set_path":
                    {
                        var gameId = req.Payload.TryGetProperty("game_id", out var pid) ? pid.GetString() : null;
                        var path = req.Payload.TryGetProperty("shortcut_path", out var sp) ? sp.GetString() : null;
                        if (gameId is null) return new { ok = false, error = "missing game_id" };
                        if (path is null) return new { ok = false, error = "missing shortcut_path" };
                        try
                        {
                            var game = _gameLibrary!.SetLaunchPath(gameId, path);
                            ReloadLocalGames();
                            return new { ok = true, game_id = game.Id, executable_path = game.ExecutablePath };
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning("games.set_path failed: {Msg}", ex.Message);
                            return new { ok = false, error = ex.Message };
                        }
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

        // When the launcher connects, push cached state — don't re-read games.local.json
        // on every reconnect (supervisor restarts / pipe blips spam the log otherwise).
        _ipc.ClientConnected += async () =>
        {
            _timerPushLogged = false;
            await PushGamesToLauncherAsync();
            await PushSessionStateToLauncherAsync();
        };

        _ipc.Start();
    }

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

    // ponytail: rate-limit DB helpers stay here — SuperadminService already delegates via callbacks;
    // moving SQL into the service would just duplicate AgentDatabase access patterns.

    private bool ValidateIpcToken(IpcRequest req)
    {
        if (!req.Payload.TryGetProperty("ipc_token", out var tokenEl)) return false;
        var token = tokenEl.GetString();
        return !string.IsNullOrWhiteSpace(token) && token == _ipcToken;
    }

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
