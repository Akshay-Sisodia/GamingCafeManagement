import type { OrderDto, OrderStatus } from "@gaming-cafe/shared";
import { Badge, type BadgeTone } from "../../components/Badge";
import { formatMoney, formatTime } from "../../lib/format";

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

export function StaffOrderCard({
  order,
  cancelPending,
  onCancel,
}: {
  order: OrderDto;
  cancelPending: boolean;
  onCancel: (order: OrderDto) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
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
            onClick={() => onCancel(order)}
            disabled={cancelPending}
            className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-500/30 hover:bg-red-500/20 disabled:opacity-40"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
