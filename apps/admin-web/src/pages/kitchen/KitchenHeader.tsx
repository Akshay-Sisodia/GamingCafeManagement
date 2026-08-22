import { useNavigate } from "react-router-dom";
import { ChefHat, LogOut } from "lucide-react";
import { auth } from "../../lib/api";

export function KitchenHeader({ connected }: { connected: boolean }) {
  const navigate = useNavigate();

  function signOut() {
    auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-3">
      <div className="flex items-center gap-3">
        <ChefHat className="h-7 w-7 text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">PACMAN Kitchen</h1>
          <p className="text-sm text-zinc-500">Live order board</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-400">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connected ? "animate-pulse bg-emerald-500" : "bg-red-500"
            }`}
          />
          {connected ? "Live" : "Reconnecting…"}
        </span>
        <button
          type="button"
          onClick={signOut}
          title="Sign out"
          className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
