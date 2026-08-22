using System.Text.Json;
using PcAgent.Core.Storage;
using PcAgent.Core.Time;

namespace PcAgent.Core.Sessions;

public enum LocalSessionState
{
    NoSession,
    Active,
    Expiring,
    Expired,
    Cancelled,
}

/// <summary>Raised when a warning threshold is crossed while a session is active.</summary>
public sealed record SessionWarningRaised(string LocalRef, int RemainingSeconds);

public sealed record SessionExpiredArgs(string LocalRef, bool HadServerId);

internal sealed record ActiveRow(string LocalRef, string? ServerId, long StartedMs, long ExpiresMs);

/// <summary>
/// Authoritative local session state machine (docs/04-pc-agent.md §4).
/// Countdown derives from the TrustedClock — wall-clock changes cannot extend play.
/// </summary>
public sealed class SessionEngine
{
    private readonly AgentDatabase _db;
    private readonly TrustedClock _clock;
    private readonly Outbox.OutboxService _outbox;
    private readonly int[] _warningMarksSeconds;
    private readonly Action<string> _log;

    private readonly HashSet<int> _firedWarnings = new();
    private bool _paused;

    public bool IsPaused => _paused;

    public void SetPaused(bool paused) => _paused = paused;

    public event Action<LocalSessionState>? StateChanged;
    public event Action<SessionWarningRaised>? WarningRaised;
    public event Action<SessionExpiredArgs>? Expired;

    public SessionEngine(
        AgentDatabase db,
        TrustedClock clock,
        Outbox.OutboxService outbox,
        int[] warningMarksSeconds,
        Action<string>? log = null)
    {
        _db = db;
        _clock = clock;
        _outbox = outbox;
        _warningMarksSeconds = warningMarksSeconds.OrderByDescending(x => x).ToArray();
        _log = log ?? (_ => { });
    }

    public LocalSessionState CurrentState { get; private set; } = LocalSessionState.NoSession;
    public string? ActiveLocalRef { get; private set; }

    public long? ExpiresEffMs()
    {
        var row = LoadActive();
        return row?.ExpiresMs;
    }

    public string? ServerSessionId() => LoadActive()?.ServerId;

    /// <summary>Re-derives state from SQLite after service/OS restart.</summary>
    public void RecoverOnBoot()
    {
        var row = LoadActive();
        if (row is null)
        {
            CurrentState = LocalSessionState.NoSession;
            ActiveLocalRef = null;
            return;
        }

        if (_clock.EffectiveNowMs() >= row.ExpiresMs)
        {
            _log($"session {row.LocalRef} already expired during downtime");
            ExpireInternal(row.LocalRef, row.ServerId);
        }
        else
        {
            SetState(LocalSessionState.Active, row.LocalRef);
            _log($"recovered session {row.LocalRef}");
        }
    }

    public string StartSession(
        int plannedMinutes,
        string origin,
        string? serverSessionId = null,
        bool suppressOutboxEcho = false,
        long? expiresEffMs = null)
    {
        if (CurrentState is LocalSessionState.Active or LocalSessionState.Expiring)
        {
            throw new InvalidOperationException("A session is already active on this PC");
        }

        // Random-suffix segment (NOT the timestamp prefix — two ids created in
        // the same millisecond would collide on the unique local_ref).
        var localRef = $"ls-{Convert.ToHexString(Guid.CreateVersion7().ToByteArray())[^8..].ToLowerInvariant()}";
        var startMs = _clock.EffectiveNowMs();
        var expiresMs = expiresEffMs ?? startMs + plannedMinutes * 60_000L;

        _db.ExecuteNonQuery(
            """
            INSERT INTO sessions_local(local_ref, server_session_id, started_eff_ms, expires_eff_ms, status, origin)
            VALUES($ref, $sid, $start, $exp, 'active', $origin)
            """,
            ("$ref", localRef), ("$sid", serverSessionId), ("$start", startMs),
            ("$exp", expiresMs), ("$origin", origin));

        // Cloud-originated sessions are already known to the server — echoing
        // them back would reconcile as DUPLICATE_SESSION. Only offline or
        // launcher-originated starts sync.
        if (!suppressOutboxEcho)
        {
            _outbox.Enqueue("SESSION_STARTED", JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["local_session_ref"] = localRef,
                ["planned_minutes"] = plannedMinutes,
                ["origin"] = origin,
                ["server_session_id"] = serverSessionId,
            }));
        }

        _firedWarnings.Clear();
        SetState(LocalSessionState.Active, localRef);
        return localRef;
    }

    public void Extend(int minutes, bool suppressOutboxEcho = false)
    {
        var row = LoadActive() ?? throw new InvalidOperationException("No active session");
        var newExpiry = row.ExpiresMs + minutes * 60_000L;
        _db.ExecuteNonQuery(
            "UPDATE sessions_local SET expires_eff_ms = $exp WHERE local_ref = $ref",
            ("$exp", newExpiry), ("$ref", row.LocalRef));
        if (!suppressOutboxEcho)
        {
            _outbox.Enqueue("SESSION_EXTENDED", JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["local_session_ref"] = row.LocalRef,
                ["minutes"] = minutes,
            }));
        }
        _firedWarnings.Clear();
        SetState(LocalSessionState.Active, row.LocalRef);
    }

    /// <summary>Sets absolute expiry from the server (covers extend, shrink, and drift).</summary>
    public void SetExpiresEffMs(long expiresEffMs, bool suppressOutboxEcho = false)
    {
        var row = LoadActive() ?? throw new InvalidOperationException("No active session");
        if (row.ExpiresMs == expiresEffMs) return;

        _db.ExecuteNonQuery(
            "UPDATE sessions_local SET expires_eff_ms = $exp WHERE local_ref = $ref",
            ("$exp", expiresEffMs), ("$ref", row.LocalRef));
        if (!suppressOutboxEcho)
        {
            _outbox.Enqueue("SESSION_EXTENDED", JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["local_session_ref"] = row.LocalRef,
                ["expires_eff_ms"] = expiresEffMs,
            }));
        }
        _firedWarnings.Clear();
        SetState(LocalSessionState.Active, row.LocalRef);
    }

    public void End(string reason, bool suppressOutboxEcho = false)
    {
        var row = LoadActive();
        if (row is null) return;
        _db.ExecuteNonQuery(
            "UPDATE sessions_local SET status = 'ended' WHERE local_ref = $ref",
            ("$ref", row.LocalRef));
        if (!suppressOutboxEcho)
        {
            _outbox.Enqueue(reason == "cancelled" ? "SESSION_CANCELLED" : "SESSION_ENDED",
                JsonSerializer.SerializeToElement(new Dictionary<string, object?>
                {
                    ["local_session_ref"] = row.LocalRef,
                    ["reason"] = reason,
                }));
        }
        SetState(LocalSessionState.NoSession, null);
    }

    /// <summary>Called once per second by the host loop.</summary>
    public void Tick()
    {
        if (_paused) return;
        if (CurrentState is not (LocalSessionState.Active or LocalSessionState.Expiring)) return;
        var row = LoadActive();
        if (row is null) return;

        var remainingSec = (int)Math.Max(0, (row.ExpiresMs - _clock.EffectiveNowMs()) / 1000);

        foreach (var mark in _warningMarksSeconds)
        {
            if (remainingSec <= mark && remainingSec > mark - 2 && _firedWarnings.Add(mark))
            {
                WarningRaised?.Invoke(new SessionWarningRaised(row.LocalRef, remainingSec));
            }
        }

        if (remainingSec <= 60 && CurrentState == LocalSessionState.Active)
        {
            SetState(LocalSessionState.Expiring, row.LocalRef);
        }

        if (remainingSec <= 0)
        {
            ExpireInternal(row.LocalRef, row.ServerId);
        }
    }

    public int RemainingSeconds()
    {
        var row = LoadActive();
        if (row is null) return 0;
        if (_paused) return (int)Math.Max(0, (row.ExpiresMs - _clock.EffectiveNowMs()) / 1000);
        return (int)Math.Max(0, (row.ExpiresMs - _clock.EffectiveNowMs()) / 1000);
    }

    private void ExpireInternal(string localRef, string? serverId)
    {
        _db.ExecuteNonQuery(
            "UPDATE sessions_local SET status = 'expired' WHERE local_ref = $ref",
            ("$ref", localRef));
        _outbox.Enqueue("SESSION_ENDED", JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["local_session_ref"] = localRef,
            ["reason"] = "expired",
        }));
        SetState(LocalSessionState.NoSession, null);
        Expired?.Invoke(new SessionExpiredArgs(localRef, serverId is not null));
    }

    private ActiveRow? LoadActive()
    {
        var rows = _db.Query(
            "SELECT local_ref, server_session_id, started_eff_ms, expires_eff_ms FROM sessions_local WHERE status = 'active' LIMIT 1");
        if (rows.Count == 0) return null;
        var r = rows[0]!;
        return new ActiveRow(
            (string)r["local_ref"]!,
            r["server_session_id"] as string,
            Convert.ToInt64(r["started_eff_ms"]),
            Convert.ToInt64(r["expires_eff_ms"]));
    }

    private void SetState(LocalSessionState state, string? localRef)
    {
        CurrentState = state;
        ActiveLocalRef = localRef;
        StateChanged?.Invoke(state);
    }
}
