using PcAgent.Core.Api;
using PcAgent.Core.Outbox;

namespace PcAgent.Core.Sync;

/// <summary>
/// Uploads pending outbox events in seq order and prunes only up to the
/// contiguous ack point (docs/03 §6.2). Conflicted events stay locally until
/// an admin resolves them server-side.
/// </summary>
public sealed class SyncEngine
{
    private readonly OutboxService _outbox;
    private readonly Func<AgentApiClient?> _clientFactory; // null when offline/unpaired
    private readonly Func<(string Token, string PcId, string AgentVersion)> _identity;
    private readonly Action<string> _log;

    public SyncEngine(
        OutboxService outbox,
        Func<AgentApiClient?> clientFactory,
        Func<(string Token, string PcId, string AgentVersion)> identity,
        Action<string>? log = null)
    {
        _outbox = outbox;
        _clientFactory = clientFactory;
        _identity = identity;
        _log = log ?? (_ => { });
    }

    /// <summary>One sync pass. Returns true when fully drained.</summary>
    public async Task<bool> SyncOnceAsync(CancellationToken ct)
    {
        var client = _clientFactory();
        if (client is null) return false;

        var pending = _outbox.Pending(500);
        if (pending.Count == 0) return true;

        var (token, pcId, agentVersion) = _identity();
        var batch = pending
            .Select(e => (e.EventId, e.Seq, e.Type, e.OccurredAt, e.Payload))
            .ToList();

        try
        {
            var response = await client.SyncEventsAsync(token, pcId, agentVersion, 0, batch, ct);

            var ackedIds = new List<string>();
            foreach (var result in response.Results)
            {
                switch (result.State)
                {
                    case "accepted":
                    case "duplicate":
                        ackedIds.Add(result.EventId);
                        break;
                    case "conflicted":
                        _outbox.MarkConflicted(result.EventId, result.Reason ?? "CONFLICT");
                        _log($"event {result.EventId} conflicted: {result.Reason}");
                        break;
                }
            }
            if (ackedIds.Count > 0)
            {
                _outbox.MarkAcked(ackedIds);
            }

            var remaining = _outbox.PendingCount();
            _log($"sync: sent={batch.Count} acked={ackedIds.Count} remaining={remaining}");
            return remaining == 0;
        }
        catch (Exception ex)
        {
            _log($"sync failed: {ex.Message}");
            return false;
        }
    }
}
