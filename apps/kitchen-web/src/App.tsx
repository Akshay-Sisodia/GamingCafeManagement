import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, LogOut } from "lucide-react";
import type { OrderDto } from "@gaming-cafe/shared";
import { API, api, auth } from "./lib/api";
import { useSSE } from "./hooks/useSSE";
import { useNow } from "./hooks/useNow";
import { LoginForm } from "./components/LoginForm";
import { OrderCard, type OrderAction } from "./components/OrderCard";

interface PcLite {
  id: string;
  name: string;
}

const COLUMNS = [
  { key: "new", title: "NEW", statuses: ["placed"], accent: "bg-sky-600" },
  { key: "preparing", title: "PREPARING", statuses: ["accepted", "preparing"], accent: "bg-amber-500" },
  { key: "ready", title: "READY", statuses: ["ready"], accent: "bg-emerald-600" },
] as const;

function Board({ onSignOut }: { onSignOut: () => void }) {
  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<string | null>(null);
  const now = useNow(15_000);

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
      if (event === "order.updated") {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      }
    });
  }, [subscribe, queryClient]);

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<OrderDto[]>("/orders?status=placed,accepted,preparing,ready"),
    refetchInterval: 10_000,
  });

  const pcsQuery = useQuery({
    queryKey: ["pcs"],
    queryFn: () => api<PcLite[]>("/pcs"),
    retry: false,
    staleTime: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: OrderAction }) =>
      api(`/orders/${orderId}/${action}`, { method: "POST", body: {} }),
    onSuccess: () => {
      setLastError(null);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) =>
      setLastError(error instanceof Error ? error.message : "Action failed"),
  });

  const pcNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const pc of pcsQuery.data ?? []) map.set(pc.id, pc.name);
    return map;
  }, [pcsQuery.data]);

  const orders = ordersQuery.data ?? [];

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <ChefHat className="h-7 w-7 text-emerald-600" />
          <h1 className="text-2xl font-bold tracking-tight">Kitchen Display</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-zinc-500">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                connected ? "animate-pulse bg-emerald-500" : "bg-red-500"
              }`}
            />
            {connected ? "Live" : "Reconnecting…"}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-2.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </header>

      {(lastError || ordersQuery.isError) && (
        <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-lg font-medium text-red-700">
          <span>
            {lastError ??
              (ordersQuery.error instanceof Error
                ? ordersQuery.error.message
                : "Could not load orders.")}
          </span>
          <button
            type="button"
            onClick={() => {
              setLastError(null);
              void ordersQuery.refetch();
            }}
            className="min-h-12 rounded-lg bg-red-600 px-5 text-base font-bold text-white hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      )}

      <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnOrders = orders.filter((order) =>
            (column.statuses as readonly string[]).includes(order.status),
          );
          return (
            <section key={column.key} className="rounded-2xl bg-white/60 p-2">
              <div className="flex items-center justify-between px-2 py-2">
                <span className="flex items-center gap-2 text-lg font-extrabold uppercase tracking-wide text-zinc-700">
                  <span className={`inline-block h-3 w-3 rounded-full ${column.accent}`} />
                  {column.title}
                </span>
                <span className="rounded-full bg-zinc-200 px-3 py-0.5 text-base font-bold text-zinc-700">
                  {columnOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                {columnOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    pcName={order.pc_id ? (pcNames.get(order.pc_id) ?? null) : null}
                    now={now}
                    busy={act.isPending}
                    onAction={(orderId, action) => act.mutate({ orderId, action })}
                  />
                ))}
                {columnOrders.length === 0 ? (
                  <p className="px-2 py-8 text-center text-lg text-zinc-400">Empty</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

export default function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(auth.token()));

  if (!signedIn) return <LoginForm onDone={() => setSignedIn(true)} />;

  return (
    <Board
      onSignOut={() => {
        auth.signOut();
        setSignedIn(false);
      }}
    />
  );
}
