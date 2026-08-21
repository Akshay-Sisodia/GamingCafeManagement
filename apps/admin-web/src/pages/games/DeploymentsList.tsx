import type { DeploymentDto } from "../../lib/types";
import type { DeploymentTargetState } from "@gaming-cafe/shared";
import { Badge, type BadgeTone } from "../../components/Badge";
import { ErrorState } from "../../components/ErrorState";
import { LoadingBlock } from "../../components/Spinner";
import { formatDateTime } from "../../lib/format";

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

export function DeploymentsList({
  deployments,
  loading,
  error,
  onRetry,
}: {
  deployments: DeploymentDto[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-zinc-400">Deployments</h2>
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorState message={error.message} onRetry={onRetry} />
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
  );
}
