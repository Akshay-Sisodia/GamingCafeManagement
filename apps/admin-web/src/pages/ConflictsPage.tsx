import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { ConflictCard } from "./conflicts/ConflictCard";
import { useConflictsPage } from "./conflicts/useConflictsPage";

export function ConflictsPage() {
  const { conflictsQuery, resolve } = useConflictsPage();

  if (conflictsQuery.isLoading) return <LoadingBlock />;
  if (conflictsQuery.isError) {
    return (
      <ErrorState
        message={conflictsQuery.error instanceof Error ? conflictsQuery.error.message : undefined}
        onRetry={() => void conflictsQuery.refetch()}
      />
    );
  }

  const conflicts = conflictsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Sync conflicts</h1>
      {conflicts.length === 0 ? (
        <p className="text-sm text-zinc-500">No unresolved conflicts. All synced cleanly.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              busy={resolve.isPending}
              onResolve={(id, resolution) => resolve.mutate({ id, resolution })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
