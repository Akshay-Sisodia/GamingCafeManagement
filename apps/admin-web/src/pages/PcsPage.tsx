import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { PcCard } from "./pcs/PcCard";
import { CONFIRM_META, usePcsPage } from "./pcs/usePcsPage";

export function PcsPage() {
  const page = usePcsPage();

  if (page.pcsQuery.isLoading) return <LoadingBlock />;
  if (page.pcsQuery.isError) {
    return (
      <ErrorState
        message={page.pcsQuery.error instanceof Error ? page.pcsQuery.error.message : undefined}
        onRetry={() => void page.pcsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">PCs</h1>
      {page.pcs.length === 0 ? (
        <p className="text-sm text-zinc-500">No PCs registered yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {page.pcs.map((pc) => (
            <PcCard
              key={pc.id}
              pc={pc}
              busy={page.busy}
              onExtend={(sessionId, minutes) => page.extend.mutate({ sessionId, minutes })}
              onPending={(pcItem, kind) => page.setPending({ pc: pcItem, kind })}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={page.pending !== null}
        title={page.pending ? CONFIRM_META[page.pending.kind].title : ""}
        body={page.pending ? CONFIRM_META[page.pending.kind].body : ""}
        confirmLabel={page.pending ? CONFIRM_META[page.pending.kind].label : ""}
        danger
        busy={page.busy}
        onConfirm={page.runPending}
        onClose={() => page.setPending(null)}
      />
    </div>
  );
}
