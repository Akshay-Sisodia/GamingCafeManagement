import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDto } from "@gaming-cafe/shared";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";

export type StaffOrderAction = "accept" | "prepare" | "ready" | "deliver" | "complete";

export function useOrdersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cancelTarget, setCancelTarget] = useState<OrderDto | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<OrderDto[]>("/orders?status=placed,accepted,preparing,ready,delivered"),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const cancelOrder = useMutation({
    mutationFn: (orderId: string) => api(`/orders/${orderId}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => {
      setCancelTarget(null);
      invalidate();
      toast.push("Order cancelled");
    },
    onError: (error) => {
      setCancelTarget(null);
      toast.push(error instanceof Error ? error.message : "Cancel failed", "error");
    },
  });

  const act = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: StaffOrderAction }) =>
      api(`/orders/${orderId}/${action}`, { method: "POST", body: {} }),
    onSuccess: () => {
      invalidate();
      toast.push("Order updated");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Action failed", "error"),
  });

  const orders = [...(ordersQuery.data ?? [])].sort((a, b) => b.placed_at.localeCompare(a.placed_at));

  return {
    ordersQuery,
    cancelOrder,
    act,
    cancelTarget,
    setCancelTarget,
    orders,
  };
}
