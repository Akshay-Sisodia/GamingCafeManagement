import type { OrderDto, OrderStatus } from "@gaming-cafe/shared";
import { Badge, type BadgeTone } from "../../components/Badge";
import { formatMoney, formatTime } from "../../lib/format";
import type { StaffOrderAction } from "./useOrdersPage";

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

function nextAction(status: OrderStatus): { label: string; action: StaffOrderAction } | null {
  switch (status) {
    case "placed":
      return { label: "Accept", action: "accept" };
    case "accepted":
      return { label: "Start preparing", action: "prepare" };
    case "preparing":
      return { label: "Mark ready", action: "ready" };
    case "ready":
      return { label: "Delivered", action: "deliver" };
    case "delivered":
      return { label: "Complete", action: "complete" };
    default:
      return null;
  }
}

export function StaffOrderCard({
  order,
  cancelPending,
  actionPending,
  onCancel,
  onAction,
}: {
  order: OrderDto;
  cancelPending: boolean;
  actionPending: boolean;
  onCancel: (order: OrderDto) => void;
  onAction: (orderId: string, action: StaffOrderAction) => void;
}) {
  const action = nextAction(order.status);

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
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
        <span className="font-semibold text-zinc-100">{formatMoney(order.total_amount)}</span>
        <div className="flex gap-2">
          {action ? (
            <button
              type="button"
              onClick={() => onAction(order.id, action.action)}
              disabled={actionPending}
              className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {action.label}
            </button>
          ) : null}
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
    </div>
  );
}
