import type { AuditLogDto } from "../../lib/types";
import { Badge, type BadgeTone } from "../../components/Badge";
import { formatDateTime } from "../../lib/format";

const ACTOR_TONE: Record<string, BadgeTone> = {
  user: "sky",
  pc: "violet",
  system: "zinc",
  customer: "amber",
  superadmin_local: "red",
};

export function AuditLogTable({ logs }: { logs: AuditLogDto[] }) {
  return (
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
          {logs.map((log) => (
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
  );
}
