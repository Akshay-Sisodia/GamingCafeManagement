import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { PcDto } from "../../lib/types";
import { usePcMutations } from "./usePcMutations";

type DangerKind = "end" | "lock" | "restart" | "shutdown";

export interface PendingAction {
  pc: PcDto;
  kind: DangerKind;
}

export const CONFIRM_META: Record<DangerKind, { title: string; body: string; label: string }> = {
  end: {
    title: "End session",
    body: "End the active session on this PC? Remaining time is forfeited immediately.",
    label: "End session",
  },
  lock: {
    title: "Lock PC",
    body: "Lock this PC right now? The current customer will be blocked from using it.",
    label: "Lock PC",
  },
  restart: {
    title: "Restart PC",
    body: "Restart this machine? Any unsaved work on it is lost.",
    label: "Restart",
  },
  shutdown: {
    title: "Shut down PC",
    body: "Power off this machine? It cannot be started remotely.",
    label: "Shut down",
  },
};

export function usePcsPage() {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const pcsQuery = useQuery({ queryKey: ["pcs"], queryFn: () => api<PcDto[]>("/pcs") });
  const { extend, endSession, command, busy } = usePcMutations();

  function runPending() {
    if (!pending) return;
    const { pc, kind } = pending;
    setPending(null);
    if (kind === "end") {
      const sessionId = pc.current_session?.id;
      if (sessionId) endSession.mutate(sessionId);
      return;
    }
    command.mutate({ pcId: pc.id, type: kind });
  }

  return {
    pcsQuery,
    pending,
    setPending,
    runPending,
    busy,
    extend,
    pcs: pcsQuery.data ?? [],
  };
}
