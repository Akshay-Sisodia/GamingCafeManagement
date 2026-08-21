import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { PcDetailDto } from "../../lib/types";
import { Badge } from "../../components/Badge";

export function PcDetailHeader({ pc }: { pc: PcDetailDto }) {
  return (
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
  );
}
