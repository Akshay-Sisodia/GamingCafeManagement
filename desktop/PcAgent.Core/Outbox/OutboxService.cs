using System.Text.Json;
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
    private readonly AgentDatabase _db;

    public OutboxService(AgentDatabase db) => _db = db;

    /// <summary>Records an event and returns its id.</summary>
    public string Enqueue(string type, JsonElement payload)
    {
        var eventId = Uuid7.NewId();
        var seq = _db.NextSeq();
        var occurredAt = DateTimeOffset.UtcNow.ToString("O");
        _db.ExecuteNonQuery(
            """
            INSERT INTO outbox(event_id, seq, type, occurred_at, payload, sync_state)
            VALUES($id, $seq, $type, $at, $payload, 'pending')
            """,
            ("$id", eventId),
            ("$seq", seq),
            ("$type", type),
            ("$at", occurredAt),
            ("$payload", payload.GetRawText()));
        return eventId;
    }

    public List<OutboxEvent> Pending(int limit = 500)
    {
        var rows = _db.Query(
            """
            SELECT event_id, seq, type, occurred_at, payload
            FROM outbox WHERE sync_state = 'pending'
            ORDER BY seq LIMIT $limit
            """,
            ("$limit", limit));

        var result = new List<OutboxEvent>(rows.Count);
        foreach (var row in rows)
        {
            result.Add(new OutboxEvent(
                (string)row["event_id"]!,
                (long)row["seq"]!,
                (string)row["type"]!,
                DateTimeOffset.Parse((string)row["occurred_at"]!),
                JsonDocument.Parse((string)row["payload"]!).RootElement.Clone()));
        }
        return result;
    }

    public void MarkAcked(IEnumerable<string> eventIds)
    {
        foreach (var id in eventIds)
        {
            _db.ExecuteNonQuery("DELETE FROM outbox WHERE event_id = $id AND sync_state = 'pending'", ("$id", id));
        }
    }

    public void MarkConflicted(string eventId, string reason)
    {
        _db.ExecuteNonQuery(
            "UPDATE outbox SET sync_state = 'conflicted', conflict_reason = $r WHERE event_id = $id",
            ("$r", reason), ("$id", eventId));
    }

    public int PendingCount()
    {
        var rows = _db.Query("SELECT count(*) AS c FROM outbox WHERE sync_state = 'pending'");
        return rows.Count > 0 ? Convert.ToInt32(rows[0]["c"]) : 0;
    }
}
