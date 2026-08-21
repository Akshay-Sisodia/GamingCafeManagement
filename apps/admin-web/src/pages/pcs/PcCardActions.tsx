import { Lock, Power, RefreshCw, Square } from "lucide-react";
import type { PcDto } from "../../lib/types";
import { IconAction } from "./IconAction";

type DangerKind = "end" | "lock" | "restart" | "shutdown";

export function PcCardActions({
  pc,
  busy,
  onExtend,
  onPending,
}: {
  pc: PcDto;
  busy: boolean;
  onExtend: (sessionId: string, minutes: number) => void;
  onPending: (pc: PcDto, kind: DangerKind) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
      {[15, 30, 60].map((minutes) => (
        <button
          key={minutes}
          type="button"
          disabled={!pc.current_session || busy}
          onClick={() => {
            const sessionId = pc.current_session?.id;
            if (sessionId) onExtend(sessionId, minutes);
          }}
          className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          +{minutes}m
        </button>
      ))}
      <span className="flex-1" />
      <IconAction
        title="End session"
        danger
        disabled={!pc.current_session || busy}
        onClick={() => onPending(pc, "end")}
      >
        <Square className="h-4 w-4" />
      </IconAction>
      <IconAction title="Lock" disabled={busy} onClick={() => onPending(pc, "lock")}>
        <Lock className="h-4 w-4" />
      </IconAction>
      <IconAction title="Restart" disabled={busy} onClick={() => onPending(pc, "restart")}>
        <RefreshCw className="h-4 w-4" />
      </IconAction>
      <IconAction title="Shutdown" disabled={busy} onClick={() => onPending(pc, "shutdown")}>
        <Power className="h-4 w-4" />
      </IconAction>
    </div>
  );
}
