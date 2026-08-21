import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { api } from "../lib/api";
import type { DeploymentDto, GameDto, PcDto } from "../lib/types";
import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { useToast } from "../components/Toasts";
import { formatDateTime } from "../lib/format";
import type { DeploymentTargetState } from "@gaming-cafe/shared";

const TARGET_STATE_TONE: Record<DeploymentTargetState, BadgeTone> = {
  queued: "zinc",
  downloading: "sky",
  verifying: "violet",
  installing: "amber",
  ready: "emerald",
  paused: "amber",
  failed: "red",
  offline: "zinc",
};

const JOB_STATUS_TONE: Record<string, BadgeTone> = {
  queued: "zinc",
  running: "sky",
  completed: "emerald",
  failed: "red",
  cancelled: "zinc",
};

export function GamesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [gameId, setGameId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [masterPcId, setMasterPcId] = useState("");
  const [targets, setTargets] = useState<Set<string>>(new Set());

  const gamesQuery = useQuery({ queryKey: ["games"], queryFn: () => api<GameDto[]>("/games") });
  const pcsQuery = useQuery({ queryKey: ["pcs"], queryFn: () => api<PcDto[]>("/pcs") });
  const deploymentsQuery = useQuery({
    queryKey: ["deployments"],
    queryFn: () => api<DeploymentDto[]>("/deployments"),
  });

  const createDeployment = useMutation({
    mutationFn: (body: {
      game_id: string;
      target_version_id: string;
      master_pc_id: string;
      pc_ids: string[];
    }) => api<DeploymentDto>("/deployments", { method: "POST", body }),
    onSuccess: () => {
      setVersionId("");
      setTargets(new Set());
      void queryClient.invalidateQueries({ queryKey: ["deployments"] });
      toast.push("Deployment created");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Deploy failed", "error"),
  });

  function toggleTarget(pcId: string) {
    setTargets((current) => {
      const next = new Set(current);
      if (next.has(pcId)) next.delete(pcId);
      else next.add(pcId);
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !masterPcId || targets.size === 0 || !versionId.trim()) {
      toast.push("Select a game, version, master PC and at least one target.", "error");
      return;
    }
    createDeployment.mutate({
      game_id: gameId,
      target_version_id: versionId.trim(),
      master_pc_id: masterPcId,
      pc_ids: [...targets],
    });
  }

  if (gamesQuery.isLoading || pcsQuery.isLoading) return <LoadingBlock />;
  if (gamesQuery.isError) {
    return (
      <ErrorState
        message={gamesQuery.error instanceof Error ? gamesQuery.error.message : undefined}
        onRetry={() => void gamesQuery.refetch()}
      />
    );
  }

  const games = gamesQuery.data ?? [];
  const pcs = pcsQuery.data ?? [];
  const onlinePcs = pcs.filter((pc) => pc.status === "online");
  const deployments = [...(deploymentsQuery.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Games & Deployments</h1>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-medium text-zinc-400">Game catalog</h2>
          {games.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No games in the catalog.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Platform</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {games.map((game) => (
                  <tr key={game.id}>
                    <td className="py-2 text-zinc-200">{game.name}</td>
                    <td className="py-2 text-zinc-400">{game.platform}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <Rocket className="h-4 w-4 text-emerald-400" /> New deployment
          </h2>
          <form onSubmit={handleSubmit} className="mt-3 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-zinc-400">
                Game
                <select
                  value={gameId}
                  onChange={(e) => setGameId(e.target.value)}
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
                  onChange={(e) => setVersionId(e.target.value)}
                  placeholder="version id or label"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500"
                />
              </label>
            </div>
            <label className="block text-xs text-zinc-400">
              Master PC (LAN source)
              <select
                value={masterPcId}
                onChange={(e) => setMasterPcId(e.target.value)}
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
                      onChange={() => toggleTarget(pc.id)}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    {pc.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="submit"
              disabled={createDeployment.isPending}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {createDeployment.isPending ? "Deploying…" : "Create deployment"}
            </button>
          </form>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400">Deployments</h2>
        {deploymentsQuery.isLoading ? (
          <LoadingBlock />
        ) : deploymentsQuery.isError ? (
          <ErrorState
            message={
              deploymentsQuery.error instanceof Error ? deploymentsQuery.error.message : undefined
            }
            onRetry={() => void deploymentsQuery.refetch()}
          />
        ) : deployments.length === 0 ? (
          <p className="text-sm text-zinc-500">No deployments yet.</p>
        ) : (
          deployments.map((deployment) => (
            <div key={deployment.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-zinc-100">{deployment.game_name}</span>
                <Badge tone={JOB_STATUS_TONE[deployment.status] ?? "zinc"}>{deployment.status}</Badge>
                <span className="ml-auto text-xs text-zinc-500">
                  {formatDateTime(deployment.created_at)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {deployment.targets.map((target) => (
                  <span
                    key={target.pc_id}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
                  >
                    {target.pc_name}
                    <Badge tone={TARGET_STATE_TONE[target.state] ?? "zinc"}>
                      {target.state}
                      {target.progress_pct != null ? ` ${Math.round(target.progress_pct)}%` : ""}
                    </Badge>
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
