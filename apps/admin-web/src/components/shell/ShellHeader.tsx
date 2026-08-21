import { LogOut } from "lucide-react";
import type { AuthUser } from "../../lib/api";

export function ShellHeader({
  user,
  connected,
  onSignOut,
}: {
  user: AuthUser | null;
  connected: boolean;
  onSignOut: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
      <div className="text-sm text-zinc-400">Staff Console</div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connected ? "animate-pulse bg-emerald-500" : "bg-red-500"
            }`}
          />
          {connected ? "Live" : "Disconnected"}
        </span>
        <span className="text-sm text-zinc-300">{user?.email ?? "staff"}</span>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
