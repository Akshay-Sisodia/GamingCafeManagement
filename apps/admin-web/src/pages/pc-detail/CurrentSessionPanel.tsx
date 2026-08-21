import type { PcDetailDto } from "../../lib/types";
import { ActiveSessionDetails } from "./ActiveSessionDetails";
import { StartSessionPanel } from "./StartSessionPanel";

export function CurrentSessionPanel({
  pc,
  busy,
  onExtend,
  onEnd,
}: {
  pc: PcDetailDto;
  busy: boolean;
  onExtend: (sessionId: string, minutes: number) => void;
  onEnd: () => void;
}) {
  const session = pc.current_session;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-medium text-zinc-400">Current session</h2>
      {session ? (
        <ActiveSessionDetails session={session} busy={busy} onExtend={onExtend} onEnd={onEnd} />
      ) : (
        <StartSessionPanel
          pcId={pc.id}
          disabled={pc.status === "disabled" || pc.status === "maintenance"}
        />
      )}
    </section>
  );
}
