import { describe, expect, it } from "vitest";
import type { OfflineEventEnvelope } from "@gaming-cafe/shared";
import { resolveOfflineEvent, type ServerSessionLike } from "./conflicts.js";

function evt(type: OfflineEventEnvelope["type"], overrides: Partial<OfflineEventEnvelope> = {}): OfflineEventEnvelope {
  return {
    event_id: "018f3d7a-0000-7000-8000-000000000000",
    seq: 1,
    type,
    occurred_at: "2026-08-21T14:20:11Z",
    payload: {},
    ...overrides,
  };
}

const activeSession: ServerSessionLike = { id: "s1", status: "active" };
const endedSession: ServerSessionLike = { id: "s1", status: "ended" };

describe("resolveOfflineEvent — docs/03 §6.3 matrix", () => {
  it("accepts SESSION_STARTED when no server session exists", () => {
    expect(resolveOfflineEvent(null, evt("SESSION_STARTED"))).toEqual({ action: "accept_start" });
  });

  it("flags DUPLICATE_SESSION when an active session already exists", () => {
    const d = resolveOfflineEvent(activeSession, evt("SESSION_STARTED"));
    expect(d.action).toBe("conflict");
    expect(d.reason).toBe("DUPLICATE_SESSION");
  });

  it("accepts offline start when previous session already ended", () => {
    expect(resolveOfflineEvent(endedSession, evt("SESSION_STARTED")).action).toBe("accept_start");
  });

  it("accepts SESSION_EXTENDED while session is active", () => {
    expect(resolveOfflineEvent(activeSession, evt("SESSION_EXTENDED"))).toEqual({ action: "accept_extend" });
  });

  it("rejects extension when server already ended the session", () => {
    const d = resolveOfflineEvent(endedSession, evt("SESSION_EXTENDED"));
    expect(d.action).toBe("conflict");
    expect(d.reason).toBe("SESSION_ALREADY_ENDED");
  });

  it("rejects extension when no session exists", () => {
    expect(resolveOfflineEvent(null, evt("SESSION_EXTENDED")).action).toBe("conflict");
  });

  it("accepts SESSION_ENDED for an active session", () => {
    expect(resolveOfflineEvent(activeSession, evt("SESSION_ENDED"))).toEqual({ action: "accept_end" });
  });

  it("treats end-of-already-ended session as duplicate (idempotent)", () => {
    expect(resolveOfflineEvent(endedSession, evt("SESSION_ENDED"))).toEqual({ action: "duplicate" });
    expect(resolveOfflineEvent(null, evt("SESSION_CANCELLED"))).toEqual({ action: "duplicate" });
  });

  it("non-session events are recorded without side effects", () => {
    expect(resolveOfflineEvent(null, evt("SUPERADMIN_ENTERED"))).toEqual({ action: "duplicate" });
  });
});
