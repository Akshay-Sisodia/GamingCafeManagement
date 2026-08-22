using System.Text.Json;
using PcAgent.Core.Api;
using PcAgent.Core.Storage;

namespace PcAgent.Core.Outbox;

/// <summary>An offline state-change event awaiting reconciliation (docs/03 §6.1).</summary>
public sealed record OutboxEvent(
    string EventId,
    long Seq,
    string Type,
    DateTimeOffset OccurredAt,
    JsonElement Payload);

/// <summary>
/// Append-only local outbox: every offline mutation is recorded here before
/// anything else happens, so a power cut can never lose an operation.
/// </summary>
public sealed class OutboxService
{
    private const string CursorKey = "last_server_seq";
    private readonly AgentDatabase _db;

    public OutboxService(AgentDatabase db) => _db = db;

    public string Enqueue(string type, JsonElement payload)
    {
        var eventId = Guid.CreateVersion7().ToString();
        var seq = _db.NextSeq();
        _db.ExecuteNonQuery(
            """
            INSERT INTO outbox(event_id, seq, type, occurred_at, payload, sync_state)
            VALUES($id, $seq, $type, $at, $payload, 'pending')
            """,
            ("$id", eventId),
            ("$seq", seq),
            ("$type", type),
            ("$at", DateTimeOffset.UtcNow.ToString("O")),
            ("$payload", payload.GetRawText()));
        return eventId;
    }

    public long LastServerSeq() =>
        long.TryParse(_db.GetMeta(CursorKey), out var n) ? n : 0;

    public List<OutboxEvent> Pending(int limit = 500) =>
        _db.Query(
            """
            SELECT event_id, seq, type, occurred_at, payload
            FROM outbox WHERE sync_state = 'pending'
            ORDER BY seq LIMIT $limit
            """,
            ("$limit", limit))
        .Select(row => new OutboxEvent(
            (string)row["event_id"]!,
            Convert.ToInt64(row["seq"]),
            (string)row["type"]!,
            DateTimeOffset.Parse((string)row["occurred_at"]!),
            JsonDocument.Parse((string)row["payload"]!).RootElement.Clone()))
        .ToList();

    public int PendingCount()
    {
        var rows = _db.Query("SELECT count(*) AS c FROM outbox WHERE sync_state = 'pending'");
        return rows.Count > 0 ? Convert.ToInt32(rows[0]["c"]) : 0;
    }

    /// <summary>
    /// Mark conflicted rows first, then drop pending events at or below the
    /// contiguous ack cursor. Never deletes conflicted rows.
    /// </summary>
    public void ApplyBatch(IReadOnlyList<SyncEventResult> results, long ackSeq)
    {
        results
            .Where(r => r.State == "conflicted")
            .ToList()
            .ForEach(r => _db.ExecuteNonQuery(
                "UPDATE outbox SET sync_state = 'conflicted', conflict_reason = $r WHERE event_id = $id",
                ("$r", r.Reason ?? "CONFLICT"), ("$id", r.EventId)));

        _db.ExecuteNonQuery(
            "DELETE FROM outbox WHERE sync_state = 'pending' AND seq <= $ack",
            ("$ack", ackSeq));

        if (ackSeq > LastServerSeq())
            _db.SetMeta(CursorKey, ackSeq.ToString());
    }
}
