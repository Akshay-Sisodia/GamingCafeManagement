import { describe, expect, it } from "vitest";
import { computeAckSeq } from "./ack-seq.js";

/** ponytail: ack cursor must not freeze behind a conflicted seq */
describe("computeAckSeq", () => {
  it("advances through accepted, conflicted, and later accepted", () => {
    expect(
      computeAckSeq(0, [
        { seq: 1, state: "accepted" },
        { seq: 2, state: "conflicted" },
        { seq: 3, state: "accepted" },
      ]),
    ).toBe(3);
  });

  it("stops at a seq gap", () => {
    expect(
      computeAckSeq(0, [
        { seq: 1, state: "accepted" },
        { seq: 3, state: "accepted" },
      ]),
    ).toBe(1);
  });

  it("treats duplicates as terminal", () => {
    expect(computeAckSeq(10, [{ seq: 11, state: "duplicate" }])).toBe(11);
  });
});
