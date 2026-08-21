import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { CommandsPanel } from "./pc-detail/CommandsPanel";
import { CurrentSessionPanel } from "./pc-detail/CurrentSessionPanel";
import { InstallationsPanel } from "./pc-detail/InstallationsPanel";
import { PcDetailHeader } from "./pc-detail/PcDetailHeader";
import { PcHealthPanel } from "./pc-detail/PcHealthPanel";
import { usePcDetailPage } from "./pc-detail/usePcDetailPage";

export function PcDetailPage() {
  const page = usePcDetailPage();

  if (page.detailQuery.isPending) return <LoadingBlock />;
  if (page.detailQuery.isError) {
    return (
      <ErrorState
        message={page.detailQuery.error instanceof Error ? page.detailQuery.error.message : undefined}
        onRetry={() => void page.detailQuery.refetch()}
      />
    );
  }

  if (!page.pc) return <ErrorState message="PC not found." />;

  return (
    <div className="space-y-6">
      <PcDetailHeader pc={page.pc} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CurrentSessionPanel
          pc={page.pc}
          busy={page.busy}
          onExtend={(sessionId, minutes) => page.extend.mutate({ sessionId, minutes })}
          onEnd={() => page.setConfirmEnd(true)}
        />
        <PcHealthPanel pc={page.pc} />
        <InstallationsPanel pc={page.pc} />
        <CommandsPanel pc={page.pc} />
      </div>
      <ConfirmModal
        open={page.confirmEnd}
        title="End session"
        body={`End the active session on ${page.pc.name}? Remaining time is forfeited immediately.`}
        confirmLabel="End session"
        danger
        busy={page.endSession.isPending}
        onConfirm={() => page.session && page.endSession.mutate(page.session.id)}
        onClose={() => page.setConfirmEnd(false)}
      />
    </div>
  );
}
