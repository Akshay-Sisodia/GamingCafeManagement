import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderDto } from "@gaming-cafe/shared";
import { api } from "../../lib/api";
import { useNow } from "../../hooks/useNow";
import type { OrderAction } from "../../components/OrderCard";

interface PcLite {
  id: string;
  name: string;
}

function kitchenErrorMessage(lastError: string | null, ordersError: unknown): string | null {
  if (lastError) return lastError;
  if (!ordersError) return null;
  return ordersError instanceof Error ? ordersError.message : "Could not load orders.";
}

export function useKitchenOrders() {
  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<string | null>(null);
  const now = useNow(15_000);

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
    (pcsQuery.data ?? []).forEach((pc) => map.set(pc.id, pc.name));
    return map;
  }, [pcsQuery.data]);

  return {
    now,
    orders: ordersQuery.data ?? [],
    pcNames,
    errorMessage: kitchenErrorMessage(lastError, ordersQuery.error),
    actPending: act.isPending,
    onAction: (orderId: string, action: OrderAction) => act.mutate({ orderId, action }),
    onRetry: () => {
      setLastError(null);
      void ordersQuery.refetch();
    },
  };
}
