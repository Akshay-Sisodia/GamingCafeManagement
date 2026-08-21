import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import type { InstallationDto, PcDetailDto } from "../lib/types";
import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { ConfirmModal } from "../components/ConfirmModal";
import { CountdownText } from "../components/CountdownText";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { useToast } from "../components/Toasts";
import { formatDateTime, formatTime } from "../lib/format";

const INSTALL_STATE_TONE: Record<InstallationDto["state"], BadgeTone> = {
  not_installed: "zinc",
  installing: "amber",
  ready: "emerald",
  failed: "red",
};

const COMMAND_STATUS_TONE: Record<string, BadgeTone> = {
  pending: "amber",
  sent: "sky",
  applied: "emerald",
  failed: "red",
  expired: "zinc",
};

function HealthBar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0;
  const color =
    pct === null ? "bg-zinc-600" : value >= 90 ? "bg-red-500" : value >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">{pct === null ? "—" : `${Math.round(value)}%`}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-zinc-800">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

export function PcDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmEnd, setConfirmEnd] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["pc", id],
    queryFn: () => api<PcDetailDto>(`/pcs/${id}`),
    enabled: id !== "",
  });

  const extend = useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api(`/sessions/${sessionId}/extend`, { method: "POST", body: { minutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pc", id] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session extended");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Extend failed", "error"),
  });

  const endSession = useMutation({
    mutationFn: (sessionId: string) =>
      api(`/sessions/${sessionId}/end`, { method: "POST", body: {} }),
    onSuccess: () => {
      setConfirmEnd(false);
      void queryClient.invalidateQueries({ queryKey: ["pc", id] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session ended");
    },
    onError: (error) => {
      setConfirmEnd(false);
      toast.push(error instanceof Error ? error.message : "End failed", "error");
    },
  });

  const startSession = useMutation({
    mutationFn: (plannedMinutes: number) =>
      api("/sessions", { method: "POST", body: { pc_id: id, planned_minutes: plannedMinutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pc", id] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session started");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Start failed", "error"),
  });

  if (detailQuery.isPending) return <LoadingBlock />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        message={detailQuery.error instanceof Error ? detailQuery.error.message : undefined}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const pc = detailQuery.data;
  if (!pc) return <ErrorState message="PC not found." />;
  const session = pc.current_session;
  const busy = extend.isPending || endSession.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/pcs"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Back to PCs"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{pc.name}</h1>
        <Badge tone={pc.status === "online" ? "emerald" : pc.status === "maintenance" ? "amber" : pc.status === "disabled" ? "red" : "zinc"}>
          {pc.status}
        </Badge>
        <span className="text-sm text-zinc-500">
          {pc.tier_name} · agent {pc.agent_version || "—"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400">Current session</h2>
          {session ? (
            <div className="mt-3 space-y-4">
              <CountdownText expiresAt={session.expires_at} className="text-5xl font-semibold" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-zinc-500">Customer</dt>
                <dd className="text-zinc-200">{session.customer_name ?? "Walk-in"}</dd>
                <dt className="text-zinc-500">Started</dt>
                <dd className="text-zinc-200">{formatDateTime(session.started_at)}</dd>
                <dt className="text-zinc-500">Planned</dt>
                <dd className="text-zinc-200">{session.planned_minutes} min</dd>
                <dt className="text-zinc-500">Game</dt>
                <dd className="text-zinc-200">{session.game_name ?? "—"}</dd>
              </dl>
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
                {[15, 30, 60].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={busy}
                    onClick={() => extend.mutate({ sessionId: session.id, minutes })}
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    +{minutes}m
                  </button>
                ))}
                <span className="flex-1" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmEnd(true)}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
                >
                  End session
                </button>
              </div>
            </div>
          ) : (
            <StartSessionPanel pcId={pc.id} disabled={pc.status === "disabled" || pc.status === "maintenance"} />
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400">Health</h2>
          {pc.health ? (
            <div className="mt-4 space-y-4">
              <HealthBar label="CPU" pct={pc.health.cpu_pct} />
              <HealthBar label="RAM" pct={pc.health.ram_pct} />
              <HealthBar label="GPU" pct={pc.health.gpu_pct ?? null} />
              <HealthBar label="Disk" pct={pc.health.disk_pct} />
              <p className="pt-1 text-xs text-zinc-500">
                agent status: {pc.health.agent_status} · uptime{" "}
                {Math.floor(pc.health.uptime_s / 3600)}h {Math.floor((pc.health.uptime_s % 3600) / 60)}m
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No health report received yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400">Installations</h2>
          {pc.installations.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No installations recorded.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500">
                  <th className="pb-2">Game</th>
                  <th className="pb-2">Version</th>
                  <th className="pb-2">State</th>
                  <th className="pb-2">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {pc.installations.map((inst) => (
                  <tr key={inst.id}>
                    <td className="py-2 text-zinc-200">{inst.game_name}</td>
                    <td className="py-2 text-zinc-400">{inst.version_label}</td>
                    <td className="py-2">
                      <Badge tone={INSTALL_STATE_TONE[inst.state]}>{inst.state}</Badge>
                    </td>
                    <td className="py-2 text-zinc-500">{formatDateTime(inst.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400">Recent commands</h2>
          {pc.commands.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No commands issued yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {pc.commands.map((cmd) => (
                <li
                  key={cmd.id}
                  className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-zinc-300">{cmd.type}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{formatTime(cmd.issued_at)}</span>
                    <Badge tone={COMMAND_STATUS_TONE[cmd.status] ?? "zinc"}>{cmd.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmModal
        open={confirmEnd}
        title="End session"
        body={`End the active session on ${pc.name}? Remaining time is forfeited immediately.`}
        confirmLabel="End session"
        danger
        busy={endSession.isPending}
        onConfirm={() => session && endSession.mutate(session.id)}
        onClose={() => setConfirmEnd(false)}
      />
    </div>
  );
}

const START_PRESETS = [30, 60, 90, 120];

function StartSessionPanel({ pcId, disabled }: { pcId: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [minutes, setMinutes] = useState(60);

  const start = useMutation({
    mutationFn: (plannedMinutes: number) =>
      api("/sessions", { method: "POST", body: { pc_id: pcId, planned_minutes: plannedMinutes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pc", pcId] });
      void queryClient.invalidateQueries({ queryKey: ["pcs"] });
      toast.push("Session started");
    },
    onError: (error) => toast.push(error instanceof Error ? error.message : "Start failed", "error"),
  });

  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-zinc-500">No active session. Start one for a walk-in customer:</p>
      <div className="flex flex-wrap gap-2">
        {START_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setMinutes(preset)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              minutes === preset
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            {preset} min
          </button>
        ))}
        <input
          type="number"
          min={5}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(Number.parseInt(e.target.value, 10) || 0)}
          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          aria-label="Custom minutes"
        />
      </div>
      <button
        type="button"
        disabled={disabled || start.isPending || minutes < 5}
        onClick={() => start.mutate(minutes)}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {start.isPending ? "Starting�" : `Start ${minutes} min session`}
      </button>
      {disabled ? (
        <p className="text-xs text-amber-400">This PC is {disabled ? "not available" : ""} � set it online in settings first.</p>
      ) : null}
    </div>
  );
}
