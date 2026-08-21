import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDto, OrderStatus } from "@gaming-cafe/shared";
import { api } from "../lib/api";
import { Badge, type BadgeTone } from "../components/Badge";
import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { useToast } from "../components/Toasts";
import { formatMoney, formatTime } from "../lib/format";

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  placed: "sky",
  accepted: "violet",
  preparing: "amber",
  ready: "emerald",
  delivered: "zinc",
  completed: "zinc",
  cancelled: "red",
};

const CANCELLABLE: OrderStatus[] = ["placed", "accepted", "preparing"];

export function OrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelTarget, setCancelTarget] = useState<OrderDto | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<OrderDto[]>("/orders?status=placed,accepted,preparing,ready,delivered"),
    refetchInterval: 15_000,
  });

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) => api(`/orders/${orderId}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => {
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.push("Order cancelled");
    },
    onError: (error) => {
      setCancelTarget(null);
      toast.push(error instanceof Error ? error.message : "Cancel failed", "error");
    },
  });

  if (ordersQuery.isLoading) return <LoadingBlock />;
  if (ordersQuery.isError) {
    return (
      <ErrorState
        message={ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined}
        onRetry={() => void ordersQuery.refetch()}
      />
    );
  }

  const orders = [...(ordersQuery.data ?? [])].sort((a, b) => b.placed_at.localeCompare(a.placed_at));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
      {orders.length === 0 ? (
        <p className="text-sm text-zinc-500">No recent orders.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-zinc-50">#{order.number}</span>
                <Badge tone={STATUS_TONE[order.status]}>{order.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {formatTime(order.placed_at)}
                {order.pc_id ? ` · PC ${order.pc_id.slice(0, 8)}` : ""}
              </div>
              <ul className="mt-3 space-y-1 text-sm text-zinc-300">
                {order.items.map((line, index) => (
                  <li key={`${order.id}-${index}`} className="flex justify-between gap-2">
                    <span>
                      {line.qty} × {line.name_snapshot}
                    </span>
                    <span className="text-zinc-500">{formatMoney(line.line_total)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3">
                <span className="font-semibold text-zinc-100">{formatMoney(order.total_amount)}</span>
                {CANCELLABLE.includes(order.status) ? (
                  <button
                    type="button"
                    onClick={() => setCancelTarget(order)}
                    disabled={cancelOrder.isPending}
                    className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/20 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={cancelTarget !== null}
        title={`Cancel order #${cancelTarget?.number ?? ""}`}
        body="Cancel this order? This cannot be undone."
        confirmLabel="Cancel order"
        danger
        busy={cancelOrder.isPending}
        onConfirm={() => cancelTarget && cancelOrder.mutate(cancelTarget.id)}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
