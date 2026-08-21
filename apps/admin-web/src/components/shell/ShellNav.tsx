import { NavLink } from "react-router-dom";
import {
  AlertOctagon,
  ChefHat,
  Gamepad2,
  LayoutDashboard,
  Monitor,
  Receipt,
  ScrollText,
  Users,
  UtensilsCrossed,
} from "lucide-react";

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

export function ShellNav() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/50">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-4">
        <Gamepad2 className="h-5 w-5 text-emerald-400" />
        <span className="font-semibold tracking-tight">PACMAN Gaming Cafe</span>
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
  );
}
