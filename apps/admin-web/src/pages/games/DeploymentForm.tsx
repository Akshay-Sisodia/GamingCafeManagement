import type { FormEvent } from "react";
import { Rocket } from "lucide-react";
import type { GameDto, PcDto } from "../../lib/types";

export function DeploymentForm({
  games,
  pcs,
  onlinePcs,
  gameId,
  versionId,
  masterPcId,
  targets,
  pending,
  onGameIdChange,
  onVersionIdChange,
  onMasterPcIdChange,
  onToggleTarget,
  onSubmit,
}: {
  games: GameDto[];
  pcs: PcDto[];
  onlinePcs: PcDto[];
  gameId: string;
  versionId: string;
  masterPcId: string;
  targets: Set<string>;
  pending: boolean;
  onGameIdChange: (value: string) => void;
  onVersionIdChange: (value: string) => void;
  onMasterPcIdChange: (value: string) => void;
  onToggleTarget: (pcId: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-400">
        <Rocket className="h-4 w-4 text-emerald-400" /> New deployment
      </h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-zinc-400">
            Game
            <select
              value={gameId}
              onChange={(e) => onGameIdChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            >
              <option value="">Select game…</option>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-zinc-400">
            Target version
            <input
              value={versionId}
              onChange={(e) => onVersionIdChange(e.target.value)}
              placeholder="version id or label"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500"
            />
          </label>
        </div>
        <label className="block text-xs text-zinc-400">
          Master PC (LAN source)
          <select
            value={masterPcId}
            onChange={(e) => onMasterPcIdChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          >
            <option value="">Select master PC…</option>
            {onlinePcs.map((pc) => (
              <option key={pc.id} value={pc.id}>
                {pc.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="text-xs text-zinc-400">Target PCs ({targets.size} selected)</legend>
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-zinc-800 p-2 sm:grid-cols-3">
            {pcs.map((pc) => (
              <label
                key={pc.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={targets.has(pc.id)}
                  onChange={() => onToggleTarget(pc.id)}
                  className="h-4 w-4 accent-emerald-500"
                />
                {pc.name}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Deploying…" : "Create deployment"}
        </button>
      </form>
    </section>
  );
}
