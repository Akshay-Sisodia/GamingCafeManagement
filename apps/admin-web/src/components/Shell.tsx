import { Outlet, useNavigate } from "react-router-dom";
import { auth } from "../lib/api";
import { ShellHeader } from "./shell/ShellHeader";
import { ShellNav } from "./shell/ShellNav";
import { useShellRealtime } from "./shell/useShellRealtime";

export function Shell() {
  const navigate = useNavigate();
  const { user, connected } = useShellRealtime();

  function signOut() {
    auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <ShellNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellHeader user={user} connected={connected} onSignOut={signOut} />
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
