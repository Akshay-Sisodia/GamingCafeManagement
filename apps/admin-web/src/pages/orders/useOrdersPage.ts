import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDto } from "@gaming-cafe/shared";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toasts";

export function useOrdersPage() {
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

  const orders = [...(ordersQuery.data ?? [])].sort((a, b) => b.placed_at.localeCompare(a.placed_at));

  return { ordersQuery, cancelOrder, cancelTarget, setCancelTarget, orders };
}
