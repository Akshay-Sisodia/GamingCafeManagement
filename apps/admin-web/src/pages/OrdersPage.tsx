import { ConfirmModal } from "../components/ConfirmModal";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { StaffOrderCard } from "./orders/StaffOrderCard";
import { useOrdersPage } from "./orders/useOrdersPage";

export function OrdersPage() {
  const { ordersQuery, cancelOrder, cancelTarget, setCancelTarget, orders } = useOrdersPage();

  if (ordersQuery.isLoading) return <LoadingBlock />;
  if (ordersQuery.isError) {
    return (
      <ErrorState
        message={ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined}
        onRetry={() => void ordersQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
      {orders.length === 0 ? (
        <p className="text-sm text-zinc-500">No recent orders.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => (
            <StaffOrderCard
              key={order.id}
              order={order}
              cancelPending={cancelOrder.isPending}
              onCancel={setCancelTarget}
            />
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
