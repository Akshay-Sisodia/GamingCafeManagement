import type { OfflineEventEnvelope } from "@gaming-cafe/shared";

export interface ServerSessionLike {
  id: string;
  status: string;
}

export type ConflictAction =
  | "accept_start"
  | "accept_extend"
  | "accept_end"
  | "duplicate"
  | "conflict";

export interface ConflictDecision {
  action: ConflictAction;
  reason?: string;
}

export function resolveOfflineEvent(
  serverSession: ServerSessionLike | null,
  evt: OfflineEventEnvelope,
): ConflictDecision {
  switch (evt.type) {
    case "SESSION_STARTED":
      if (serverSession && serverSession.status === "active") {
        return { action: "conflict", reason: "DUPLICATE_SESSION" };
      }
      return { action: "accept_start" };
    case "SESSION_EXTENDED":
      if (serverSession && serverSession.status === "active") {
        return { action: "accept_extend" };
      }
      return { action: "conflict", reason: "SESSION_ALREADY_ENDED" };
    case "SESSION_ENDED":
    case "SESSION_CANCELLED":
      if (!serverSession || serverSession.status !== "active") {
        return { action: "duplicate" };
      }
      return { action: "accept_end" };
    default:
      return { action: "duplicate" };
  }
}
