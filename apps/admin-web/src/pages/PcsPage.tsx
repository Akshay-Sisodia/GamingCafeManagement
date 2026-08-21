import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Power, RefreshCw, Square } from "lucide-react";
import { api } from "../lib/api";
import type { PcDto } from "../lib/types";
import { Badge, type BadgeTone } from "../components/Badge";
import { ConfirmModal } from "../components/ConfirmModal";
import { CountdownText } from "../components/CountdownText";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { useToast } from "../components/Toasts";

const STATUS_TONE: Record<PcDto["status"], BadgeTone> = {
  online: "emerald",
  offline: "zinc",
  maintenance: "amber",
  disabled: "red",
};

const STATUS_DOT: Record<PcDto["status"], string> = {
  online: "bg-emerald-500",
  offline: "bg-zinc-500",
  maintenance: "bg-amber-500",
  disabled: "bg-red-500",
};

type DangerKind = "end" | "lock" | "restart" | "shutdown";

interface PendingAction {
  pc: PcDto;
  kind: DangerKind;
}

const CONFIRM_META: Record<DangerKind, { title: string; body: string; label: string }> = {
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

function SessionLine({ pc }: { pc: PcDto }) {
  const session = pc.current_session;
  if (!session) return <div className="text-xs text-zinc-500">Idle — no active session</div>;
  return (
    <div className="text-xs text-zinc-400">
      <span className="text-zinc-300">{session.customer_name ?? "Walk-in"}</span>
      {session.game_name ? <span> · {session.game_name}</span> : null}
      <span className="ml-2">
        remaining <CountdownText expiresAt={session.expires_at} />
      </span>
    </div>
  );
}

function IconAction({
  title,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 ring-1 ring-inset transition disabled:opacity-40 ${
        danger
          ? "text-red-400 ring-red-500/30 hover:bg-red-500/10"
          : "text-zinc-300 ring-zinc-700 hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

export function PcsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const pcsQuery = useQuery({ queryKey: ["pcs"], queryFn: () => api<PcDto[]>("/pcs") });

  const extend = useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api(`/sessions/${sessionId}/extend`, { method: "POST", body: { minutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      toast.push("Session extended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Extend failed", "error"),
  });

  const endSession = useMutation({
    mutationFn: (sessionId: string) =>
      api(`/sessions/${sessionId}/end`, { method: "POST", body: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.push("Session ended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "End failed", "error"),
  });

  const command = useMutation({
    mutationFn: ({ pcId, type }: { pcId: string; type: "lock" | "restart" | "shutdown" }) =>
      api(`/pcs/${pcId}/commands`, { method: "POST", body: { type, payload: {}, confirm: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      void queryClient.invalidateQueries({ queryKey: ["pc"] });
      toast.push("Command issued");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Command failed", "error"),
  });

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

  if (pcsQuery.isLoading) return <LoadingBlock />;
  if (pcsQuery.isError) {
    return (
      <ErrorState
        message={pcsQuery.error instanceof Error ? pcsQuery.error.message : undefined}
        onRetry={() => void pcsQuery.refetch()}
      />
    );
  }

  const pcs = pcsQuery.data ?? [];
  const busy = extend.isPending || endSession.isPending || command.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">PCs</h1>
      {pcs.length === 0 ? (
        <p className="text-sm text-zinc-500">No PCs registered yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pcs.map((pc) => (
            <div
              key={pc.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <Link
                    to={`/pcs/${pc.id}`}
                    className="font-semibold text-zinc-100 hover:text-emerald-400"
                  >
                    {pc.name}
                  </Link>
                  <div className="text-xs text-zinc-500">
                    {pc.tier_name} · agent {pc.agent_version || "—"}
                  </div>
                </div>
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[pc.status]}`} />
                  <Badge tone={STATUS_TONE[pc.status]}>{pc.status}</Badge>
                </span>
              </div>

              <SessionLine pc={pc} />

              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                {[15, 30, 60].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={!pc.current_session || busy}
                    onClick={() => {
                      const sessionId = pc.current_session?.id;
                      if (sessionId) extend.mutate({ sessionId, minutes });
                    }}
                    className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    +{minutes}m
                  </button>
                ))}
                <span className="flex-1" />
                <IconAction
                  title="End session"
                  danger
                  disabled={!pc.current_session || busy}
                  onClick={() => setPending({ pc, kind: "end" })}
                >
                  <Square className="h-4 w-4" />
                </IconAction>
                <IconAction title="Lock" disabled={busy} onClick={() => setPending({ pc, kind: "lock" })}>
                  <Lock className="h-4 w-4" />
                </IconAction>
                <IconAction title="Restart" disabled={busy} onClick={() => setPending({ pc, kind: "restart" })}>
                  <RefreshCw className="h-4 w-4" />
                </IconAction>
                <IconAction title="Shutdown" disabled={busy} onClick={() => setPending({ pc, kind: "shutdown" })}>
                  <Power className="h-4 w-4" />
                </IconAction>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={pending !== null}
        title={pending ? CONFIRM_META[pending.kind].title : ""}
        body={pending ? CONFIRM_META[pending.kind].body : ""}
        confirmLabel={pending ? CONFIRM_META[pending.kind].label : ""}
        danger
        busy={busy}
        onConfirm={runPending}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
