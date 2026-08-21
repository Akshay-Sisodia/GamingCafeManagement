import { useEffect, useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  ChefHat,
  Gamepad2,
  LayoutDashboard,
  LogOut,
  Monitor,
  Receipt,
  ScrollText,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { API, auth } from "../lib/api";
import { useSSE } from "../hooks/useSSE";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/pcs", label: "PCs", icon: Monitor, end: false },
  { to: "/games", label: "Games & Deployments", icon: Gamepad2, end: false },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, end: false },
  { to: "/orders", label: "Orders", icon: Receipt, end: false },
{ to: "/kitchen", label: "Kitchen Display", icon: ChefHat, end: true },
  { to: "/customers", label: "Customers", icon: Users, end: false },
  { to: "/audit", label: "Audit", icon: ScrollText, end: false },
  { to: "/conflicts", label: "Conflicts", icon: AlertOctagon, end: false },
] as const;

export function Shell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = auth.user();
  const token = auth.token();

  const sseUrl = useMemo(
    () =>
      user && token
        ? `${API}/v1/realtime/admin?cafe=${encodeURIComponent(user.cafe_id)}&token=${encodeURIComponent(token)}`
        : null,
    [user, token],
  );
  const { connected, subscribe } = useSSE(sseUrl);

  useEffect(() => {
    return subscribe((event) => {
      switch (event) {
        case "pc.status":
        case "session.updated":
          void queryClient.invalidateQueries({ queryKey: ["pcs"] });
          void queryClient.invalidateQueries({ queryKey: ["pc"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "order.updated":
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
          void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          break;
        case "deployment.progress":
          void queryClient.invalidateQueries({ queryKey: ["deployments"] });
          break;
        case "sync.conflict":
          void queryClient.invalidateQueries({ queryKey: ["conflicts"] });
          break;
        default:
          break;
      }
    });
  }, [subscribe, queryClient]);

  function signOut() {
    auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50">
        <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
          <Gamepad2 className="h-5 w-5 text-emerald-400" />
          <span className="font-semibold tracking-tight">Gaming Café</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
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
              onClick={signOut}
              title="Sign out"
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
