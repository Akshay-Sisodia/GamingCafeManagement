using PcAgent.Core.Api;
using PcAgent.Core.Outbox;

namespace PcAgent.Core.Sync;

/// <summary>
/// PC → backend outbox uploader (docs/03 §6). Single-flight, durable cursor,
/// ack-point prune, conflict retention, session-id bind on accepted starts.
/// </summary>
public sealed class SyncEngine
{
    public const int BatchSize = 500;
    public const int MaxBatchesPerPass = 4;

    private readonly OutboxService _outbox;
    private readonly Func<AgentApiClient?> _clientFactory;
    private readonly Func<(string Token, string PcId, string AgentVersion)> _identity;
    private readonly Action<string, string>? _bindServerSession;
    private readonly Action<string> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _holdUntil = DateTimeOffset.MinValue;
    private int _failures;

    public SyncEngine(
        OutboxService outbox,
        Func<AgentApiClient?> clientFactory,
        Func<(string Token, string PcId, string AgentVersion)> identity,
        Action<string, string>? bindServerSession = null,
        Action<string>? log = null)
    {
        _ = SyncAck.IsTerminal("accepted");
        _outbox = outbox;
        _clientFactory = clientFactory;
        _identity = identity;
        _bindServerSession = bindServerSession;
        _log = log ?? (_ => { });
    }

    /// <summary>Upload pending outbox events. Returns true when the outbox is drained.</summary>
    public async Task<bool> SyncOnceAsync(CancellationToken ct)
    {
        if (DateTimeOffset.UtcNow < _holdUntil) return false;
        if (!await _gate.WaitAsync(0, ct)) return false;
        try
        {
            var drained = await DrainAsync(ct);
            _failures = 0;
            _holdUntil = DateTimeOffset.MinValue;
            return drained;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _failures++;
            var delay = TimeSpan.FromSeconds(Math.Min(300, 5 * Math.Pow(2, Math.Min(_failures, 6))));
            _holdUntil = DateTimeOffset.UtcNow + delay;
            _log($"sync failed (retry in {delay.TotalSeconds:0}s): {ex.Message}");
            return false;
        }
        finally { _gate.Release(); }
    }

    private async Task<bool> DrainAsync(CancellationToken ct)
    {
        var client = _clientFactory();
        if (client is null) return false;

        async Task<int> drainLeft(int left)
        {
            if (left == 0) return _outbox.PendingCount();
            var remaining = await UploadBatchAsync(client, ct);
            return remaining == 0 ? 0 : await drainLeft(left - 1);
        }

        return await drainLeft(MaxBatchesPerPass) == 0;
    }

    private async Task<int> UploadBatchAsync(AgentApiClient client, CancellationToken ct)
    {
        var pending = _outbox.Pending(BatchSize);
        if (pending.Count == 0) return 0;

        var (token, pcId, agentVersion) = _identity();
        var lastSeq = _outbox.LastServerSeq();
        var batch = pending
            .Select(e => (e.EventId, e.Seq, e.Type, e.OccurredAt, e.Payload))
            .ToList();

        var response = await client.SyncEventsAsync(token, pcId, agentVersion, lastSeq, batch, ct);

        var cursor = Math.Max(
            response.AckSeq,
            SyncAck.Advance(lastSeq, response.Results.Select(r => (r.Seq, r.State)).ToList()));

        BindAcceptedSessions(pending, response.Results);
        _outbox.ApplyBatch(response.Results, cursor);

        var remaining = _outbox.PendingCount();
        _log($"sync: sent={batch.Count} cursor={cursor} remaining={remaining}");
        return remaining;
    }

    private void BindAcceptedSessions(IReadOnlyList<OutboxEvent> sent, IReadOnlyList<SyncEventResult> results)
    {
        if (_bindServerSession is null) return;
        var byId = sent.ToDictionary(e => e.EventId);
        results
            .Where(r => r.State == "accepted" && !string.IsNullOrEmpty(r.SessionId))
            .ToList()
            .ForEach(r =>
            {
                if (!byId.TryGetValue(r.EventId, out var evt)) return;
                if (!evt.Payload.TryGetProperty("local_session_ref", out var refEl)) return;
                var localRef = refEl.GetString();
                if (localRef is null || r.SessionId is null) return;
                _bindServerSession(localRef, r.SessionId);
            });
    }
}
