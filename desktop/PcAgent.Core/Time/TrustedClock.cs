using System.Diagnostics;

namespace PcAgent.Core.Time;

/// <summary>
/// Trusted time per docs/03-protocols.md §7: an anchor of (server time, monotonic
/// ticks) captured at sync. Effective "now" advances on the monotonic clock so
/// changing the Windows wall clock cannot extend sessions.
/// </summary>
public sealed class TrustedClock
{
    private readonly object _gate = new();
    private readonly Func<long> _timestampProvider;
    private readonly Func<long, double> _elapsedToMs;

    private long _anchorTicks;
    private double _anchorServerMs;
    private DateTimeOffset _anchorWallUtc;

    public TrustedClock(Func<long>? timestampProvider = null)
    {
        _timestampProvider = timestampProvider ?? Stopwatch.GetTimestamp;
        // Default conversion uses Stopwatch.Frequency.
        _elapsedToMs = ticks => ticks * 1000.0 / Stopwatch.Frequency;
        _anchorTicks = _timestampProvider();
        _anchorServerMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _anchorWallUtc = DateTimeOffset.UtcNow;
    }

    /// <summary>Re-anchor to a server-provided unix-ms time.</summary>
    public void UpdateFromServer(long serverTimeMs)
    {
        lock (_gate)
        {
            _anchorTicks = _timestampProvider();
            _anchorServerMs = serverTimeMs;
            _anchorWallUtc = DateTimeOffset.UtcNow;
        }
    }

    /// <summary>Current trusted time as unix milliseconds.</summary>
    public long EffectiveNowMs()
    {
        lock (_gate)
        {
            var elapsedTicks = _timestampProvider() - _anchorTicks;
            return (long)(_anchorServerMs + _elapsedToMs(elapsedTicks));
        }
    }

    /// <summary>
    /// Signed seconds between the Windows wall clock and trusted time.
    /// Large values indicate clock tampering or drift.
    /// </summary>
    public double WallClockDivergenceSeconds()
    {
        lock (_gate)
        {
            var effective = DateTimeOffset.FromUnixTimeMilliseconds(EffectiveNowMs());
            return (DateTimeOffset.UtcNow - effective).TotalSeconds;
        }
    }

    /// <summary>Absolute divergence in seconds (tamper heuristic threshold ~60s).</summary>
    public double AbsoluteDivergenceSeconds() => Math.Abs(WallClockDivergenceSeconds());

    /// <summary>Snapshot for persistence across reboots.</summary>
    public (long ServerMs, DateTimeOffset WallUtc) Snapshot()
    {
        lock (_gate)
        {
            return ((long)_anchorServerMs, _anchorWallUtc);
        }
    }
}
