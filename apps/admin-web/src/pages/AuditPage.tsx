import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { AuditLogDto } from "../lib/types";
import { Badge, type BadgeTone } from "../components/Badge";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { formatDateTime } from "../lib/format";

const ACTOR_TONE: Record<string, BadgeTone> = {
  user: "sky",
  pc: "violet",
  system: "zinc",
  customer: "amber",
  superadmin_local: "red",
};

export function AuditPage() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ action: "", from: "", to: "" });

  const logsQuery = useQuery({
    queryKey: ["audit", applied],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied.action) params.set("action", applied.action);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      const qs = params.toString();
      return api<AuditLogDto[]>(`/audit-logs${qs ? `?${qs}` : ""}`);
    },
  });

  function handleApply(event: FormEvent) {
    event.preventDefault();
    setApplied({ action, from, to });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>

      <form onSubmit={handleApply} className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-zinc-400">
          Action
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. session.end"
            className="mt-1 w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Apply filters
        </button>
      </form>

      {logsQuery.isLoading ? (
        <LoadingBlock />
      ) : logsQuery.isError ? (
        <ErrorState
          message={logsQuery.error instanceof Error ? logsQuery.error.message : undefined}
          onRetry={() => void logsQuery.refetch()}
        />
      ) : (logsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-zinc-500">No audit entries match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {(logsQuery.data ?? []).map((log) => (
                <tr key={log.id} className="hover:bg-zinc-900/60">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                    {formatDateTime(log.at)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={ACTOR_TONE[log.actor_type] ?? "zinc"}>
                      {log.actor_name ?? log.actor_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-200">{log.action}</td>
                  <td className="px-4 py-3 text-zinc-400">{log.target ?? "—"}</td>
                  <td className="max-w-md truncate px-4 py-3 text-zinc-500">{log.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
