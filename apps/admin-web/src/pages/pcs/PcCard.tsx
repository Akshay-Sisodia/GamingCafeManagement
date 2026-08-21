import { Link } from "react-router-dom";
import type { PcDto } from "../../lib/types";
import { Badge, type BadgeTone } from "../../components/Badge";
import { PcCardActions } from "./PcCardActions";
import { SessionLine } from "./SessionLine";

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

export function PcCard({
  pc,
  busy,
  onExtend,
  onPending,
}: {
  pc: PcDto;
  busy: boolean;
  onExtend: (sessionId: string, minutes: number) => void;
  onPending: (pc: PcDto, kind: DangerKind) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
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
      <PcCardActions pc={pc} busy={busy} onExtend={onExtend} onPending={onPending} />
    </div>
  );
}
