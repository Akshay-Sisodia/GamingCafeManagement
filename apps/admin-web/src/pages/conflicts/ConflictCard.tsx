import type { SyncConflictDto } from "../../lib/types";
import { Badge, type BadgeTone } from "../../components/Badge";
import { formatDateTime } from "../../lib/format";

const REASON_TONE: Record<string, BadgeTone> = {
  DUPLICATE_SESSION: "amber",
  SESSION_ALREADY_ENDED: "red",
  CLOCK_SKEW: "violet",
  UNKNOWN_EVENT_TYPE: "zinc",
};

export function ConflictCard({
  conflict,
  busy,
  onResolve,
}: {
  conflict: SyncConflictDto;
  busy: boolean;
  onResolve: (id: string, resolution: "accept_server" | "accept_offline") => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={REASON_TONE[conflict.reason] ?? "amber"}>{conflict.reason}</Badge>
        <span className="text-sm font-medium text-zinc-100">{conflict.event_type}</span>
        <span className="ml-auto text-xs text-zinc-500">
          {formatDateTime(conflict.occurred_at)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-zinc-500">PC</dt>
        <dd className="font-mono text-zinc-300">{conflict.pc_name ?? conflict.pc_id}</dd>
        <dt className="text-zinc-500">Event</dt>
        <dd className="truncate font-mono text-zinc-300">{conflict.event_id}</dd>
      </dl>
      {conflict.state === "conflicted" ? (
        <div className="mt-4 flex gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve(conflict.id, "accept_server")}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Accept server
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve(conflict.id, "accept_offline")}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            Accept offline
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <Badge tone="emerald">{conflict.state}</Badge>
        </div>
      )}
    </div>
  );
}
