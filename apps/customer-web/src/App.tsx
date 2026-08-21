import { useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { CalendarClock, LogOut, ShoppingCart, UtensilsCrossed, Wallet } from "lucide-react";
import { auth } from "./lib/api";
import { CartProvider, useCart } from "./lib/cart";
import { CartDrawer } from "./components/CartDrawer";
import { LoginPage } from "./pages/LoginPage";
import { MenuPage } from "./pages/MenuPage";
import { SessionsPage } from "./pages/SessionsPage";
import { WalletPage } from "./pages/WalletPage";

const TABS = [
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/sessions", label: "Sessions", icon: CalendarClock },
  { to: "/wallet", label: "Wallet", icon: Wallet },
] as const;

function CustomerShell({ onSignOut }: { onSignOut: () => void }) {
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart();
  const user = auth.user();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4">
        <span className="font-semibold tracking-tight">Gaming Café</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label="Open cart"
            className="relative rounded-lg p-2 text-zinc-300 hover:bg-zinc-900"
          >
            <ShoppingCart className="h-5 w-5" />
            {cart.count > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-zinc-950">
                {cart.count}
              </span>
            ) : null}
          </button>
          <span className="hidden text-sm text-zinc-400 sm:inline">{user?.email}</span>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-800 bg-zinc-950">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                isActive ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300"
              }`
            }
          >
            <tab.icon className="h-5 w-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  );
}

export default function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(auth.token()));

  if (!signedIn) return <LoginPage onDone={() => setSignedIn(true)} />;

  return (
    <CartProvider>
      <CustomerShell onSignOut={() => setSignedIn(false)} />
    </CartProvider>
  );
}
