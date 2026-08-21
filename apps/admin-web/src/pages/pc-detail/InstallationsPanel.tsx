import type { PcDetailDto } from "../../lib/types";
import type { BadgeTone } from "../../components/Badge";
import { Badge } from "../../components/Badge";
import { formatDateTime } from "../../lib/format";

const INSTALL_STATE_TONE: Record<PcDetailDto["installations"][number]["state"], BadgeTone> = {
  not_installed: "zinc",
  installing: "amber",
  ready: "emerald",
  failed: "red",
};

export function InstallationsPanel({ pc }: { pc: PcDetailDto }) {
  return (
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
  );
}
