import { Clock, Monitor } from "lucide-react";
import type { OrderDto, OrderStatus } from "@gaming-cafe/shared";
import { minutesSince } from "../lib/format";

export type OrderAction = "accept" | "prepare" | "ready" | "deliver";

function nextAction(status: OrderStatus): { label: string; action: OrderAction } | null {
  switch (status) {
    case "placed":
      return { label: "Accept", action: "accept" };
    case "accepted":
      return { label: "Start Preparing", action: "prepare" };
    case "preparing":
      return { label: "Mark Ready", action: "ready" };
    case "ready":
      return { label: "Picked Up", action: "deliver" };
    default:
      return null;
  }
}

interface OrderCardProps {
  order: OrderDto;
  pcName: string | null;
  now: number;
  busy: boolean;
  onAction: (orderId: string, action: OrderAction) => void;
}

export function OrderCard({ order, pcName, now, busy, onAction }: OrderCardProps) {
  const mins = minutesSince(order.placed_at, now);
  const timeTone =
    mins > 20 ? "text-red-600" : mins > 10 ? "text-amber-600" : "text-zinc-500";
  const action = nextAction(order.status);

  return (
    <div className="rounded-2xl border-2 border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-zinc-900">
          #{order.number}
        </span>
        <span className={`flex items-center gap-1.5 text-xl font-bold ${timeTone}`}>
          <Clock className="h-5 w-5" />
          {mins}m
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-base font-medium text-zinc-500">
        <Monitor className="h-4 w-4" />
        {pcName ?? (order.pc_id ? `PC ${order.pc_id.slice(0, 8)}` : "Front counter")}
      </div>
      <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 text-xl font-medium text-zinc-800">
        {order.items.map((line, index) => (
          <li key={`${order.id}-${index}`}>
            {line.qty} × {line.name_snapshot}
          </li>
        ))}
      </ul>
      {action ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(order.id, action.action)}
          className="mt-4 min-h-16 w-full rounded-xl bg-zinc-900 text-xl font-bold text-white hover:bg-zinc-700 active:scale-[0.99] disabled:opacity-50"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
