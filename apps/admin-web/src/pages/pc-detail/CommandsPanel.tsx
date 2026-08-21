import type { PcDetailDto } from "../../lib/types";
import type { BadgeTone } from "../../components/Badge";
import { Badge } from "../../components/Badge";
import { formatTime } from "../../lib/format";

const COMMAND_STATUS_TONE: Record<string, BadgeTone> = {
  pending: "amber",
  sent: "sky",
  applied: "emerald",
  failed: "red",
  expired: "zinc",
};

export function CommandsPanel({ pc }: { pc: PcDetailDto }) {
  return (
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
  );
}
