import type { OrderDto } from "@gaming-cafe/shared";
import { OrderCard, type OrderAction } from "../../components/OrderCard";

export function KitchenColumn({
  title,
  accent,
  orders,
  pcNames,
  now,
  busy,
  onAction,
}: {
  title: string;
  accent: string;
  orders: OrderDto[];
  pcNames: Map<string, string>;
  now: number;
  busy: boolean;
  onAction: (orderId: string, action: OrderAction) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="flex items-center gap-2 text-lg font-extrabold uppercase tracking-wide text-zinc-200">
          <span className={`inline-block h-3 w-3 rounded-full ${accent}`} />
          {title}
        </span>
        <span className="rounded-full bg-zinc-800 px-3 py-0.5 text-base font-bold text-zinc-200">
          {orders.length}
        </span>
      </div>
      <div className="space-y-3">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            pcName={order.pc_id ? (pcNames.get(order.pc_id) ?? null) : null}
            now={now}
            busy={busy}
            onAction={onAction}
          />
        ))}
        {orders.length === 0 ? (
          <p className="px-2 py-8 text-center text-lg text-zinc-500">Empty</p>
        ) : null}
      </div>
    </section>
  );
}
