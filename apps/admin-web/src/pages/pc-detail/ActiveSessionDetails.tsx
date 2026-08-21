import type { PcDetailDto } from "../../lib/types";
import { CountdownText } from "../../components/CountdownText";
import { formatDateTime } from "../../lib/format";

export function ActiveSessionDetails({
  session,
  busy,
  onExtend,
  onEnd,
}: {
  session: NonNullable<PcDetailDto["current_session"]>;
  busy: boolean;
  onExtend: (sessionId: string, minutes: number) => void;
  onEnd: () => void;
}) {
  return (
    <div className="mt-3 space-y-4">
      <CountdownText expiresAt={session.expires_at} className="text-5xl font-semibold" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-zinc-500">Customer</dt>
        <dd className="text-zinc-200">{session.customer_name ?? "Walk-in"}</dd>
        <dt className="text-zinc-500">Started</dt>
        <dd className="text-zinc-200">{formatDateTime(session.started_at)}</dd>
        <dt className="text-zinc-500">Planned</dt>
        <dd className="text-zinc-200">{session.planned_minutes} min</dd>
        <dt className="text-zinc-500">Game</dt>
        <dd className="text-zinc-200">{session.game_name ?? "—"}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
        {[15, 30, 60].map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={busy}
            onClick={() => onExtend(session.id, minutes)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
          >
            +{minutes}m
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={onEnd}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
        >
          End session
        </button>
      </div>
    </div>
  );
}
