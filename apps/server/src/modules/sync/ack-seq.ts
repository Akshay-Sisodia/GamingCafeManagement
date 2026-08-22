export function computeAckSeq(
  lastServerSeq: number,
  results: Array<{ seq: number; state: string }>,
): number {
  return [...results]
    .sort((a, b) => a.seq - b.seq)
    .reduce((ack, r) => {
      if (r.seq !== ack + 1) return ack;
      if (r.state === "accepted" || r.state === "duplicate" || r.state === "conflicted") {
        return r.seq;
      }
      return ack;
    }, lastServerSeq);
}
