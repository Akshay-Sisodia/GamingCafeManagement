import type { PcDto } from "../../lib/types";
import { CountdownText } from "../../components/CountdownText";

export function SessionLine({ pc }: { pc: PcDto }) {
  const session = pc.current_session;
  if (!session) return <div className="text-xs text-zinc-500">Idle — no active session</div>;
  return (
    <div className="text-xs text-zinc-400">
      <span className="text-zinc-300">{session.customer_name ?? "Walk-in"}</span>
      {session.game_name ? <span> · {session.game_name}</span> : null}
      <span className="ml-2">
        remaining <CountdownText expiresAt={session.expires_at} />
      </span>
    </div>
  );
}
