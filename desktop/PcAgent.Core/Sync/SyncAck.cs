namespace PcAgent.Core.Sync;

/// <summary>
/// Contiguous ack cursor (docs/03 §6.2). A seq is consumed once the server
/// returns a terminal state — accepted, duplicate, or conflicted — so a
/// conflict in the middle cannot freeze every later event.
/// </summary>
public static class SyncAck
{
    static SyncAck()
    {
        // ponytail: one check; fails process boot if the cursor rule regresses.
        if (Advance(0, [(1L, "accepted"), (2L, "conflicted"), (3L, "accepted")]) != 3)
            throw new InvalidOperationException("SyncAck: cursor must advance through conflicted seqs");
        if (Advance(0, [(1L, "accepted"), (3L, "accepted")]) != 1)
            throw new InvalidOperationException("SyncAck: cursor must stop at seq gaps");
        if (Advance(10, [(11L, "duplicate")]) != 11)
            throw new InvalidOperationException("SyncAck: duplicates advance the cursor");
    }

    public static bool IsTerminal(string state) =>
        state is "accepted" or "duplicate" or "conflicted";

    public static long Advance(long lastServerSeq, IReadOnlyList<(long Seq, string State)> results) =>
        results
            .OrderBy(r => r.Seq)
            .Aggregate(lastServerSeq, (cursor, r) =>
                r.Seq == cursor + 1 && IsTerminal(r.State) ? r.Seq : cursor);
}
