import { auth } from "../lib/api";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { DeploymentForm } from "./games/DeploymentForm";
import { DeploymentsList } from "./games/DeploymentsList";
import { GameCatalog } from "./games/GameCatalog";
import { useGamesPage } from "./games/useGamesPage";

export function GamesPage() {
  const page = useGamesPage();
  const canDeploy = auth.user()?.role === "owner" || auth.user()?.role === "manager";

  if (page.gamesQuery.isLoading || page.pcsQuery.isLoading) return <LoadingBlock />;
  if (page.gamesQuery.isError) {
    return (
      <ErrorState
        message={page.gamesQuery.error instanceof Error ? page.gamesQuery.error.message : undefined}
        onRetry={() => void page.gamesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Games & Deployments</h1>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <GameCatalog games={page.games} />
        {canDeploy ? (
          <DeploymentForm
            games={page.games}
            pcs={page.pcs}
            onlinePcs={page.onlinePcs}
            gameId={page.gameId}
            versionId={page.versionId}
            masterPcId={page.masterPcId}
            targets={page.targets}
            pending={page.createPending}
            onGameIdChange={page.setGameId}
            onVersionIdChange={page.setVersionId}
            onMasterPcIdChange={page.setMasterPcId}
            onToggleTarget={page.toggleTarget}
            onSubmit={page.handleSubmit}
          />
        ) : (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-500">
            Deployments require owner or manager access.
          </section>
        )}
      </div>
      <DeploymentsList
        deployments={page.deployments}
        loading={page.deploymentsQuery.isLoading}
        error={page.deploymentsQuery.error instanceof Error ? page.deploymentsQuery.error : null}
        onRetry={() => void page.deploymentsQuery.refetch()}
      />
    </div>
  );
}
