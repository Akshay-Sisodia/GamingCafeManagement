import { Minus, Plus, ShoppingCart, X } from "lucide-react";
import type { OrderDto } from "@gaming-cafe/shared";
import type { MenuCategoryDto } from "../../lib/types";
import { formatMoney } from "../../lib/format";

export type CartLine = {
  itemId: string;
  qty: number;
  info?: { name: string; price_amount: number };
};

export function CartDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
      <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
        <ShoppingCart className="h-5 w-5 text-emerald-400" /> Your order
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close cart"
        className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

export function OrderPlacedView({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold text-emerald-400">Order placed!</p>
      <p className="text-sm text-zinc-400">
        Order #{order.number} — {formatMoney(order.total_amount)}. It will be delivered to your seat
        shortly.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Done
      </button>
    </div>
  );
}

export function EmptyCartView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <ShoppingCart className="h-10 w-10 text-zinc-700" />
      <p className="text-sm text-zinc-500">Your cart is empty. Add something tasty!</p>
    </div>
  );
}

export function CartLineRow({
  line,
  onDecrease,
  onIncrease,
}: {
  line: CartLine;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="min-w-0">
        <div className="truncate font-medium text-zinc-100">{line.info?.name ?? "Menu item"}</div>
        <div className="text-xs text-zinc-500">
          {formatMoney((line.info?.price_amount ?? 0) * line.qty)}
        </div>
      </div>
      <div className="ml-3 flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={onDecrease}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center font-semibold tabular-nums">{line.qty}</span>
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={onIncrease}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function CartFooter({
  total,
  error,
  pending,
  onPlace,
}: {
  total: number;
  error: Error | null;
  pending: boolean;
  onPlace: () => void;
}) {
  return (
    <div className="border-t border-zinc-800 p-4">
      {error ? (
        <p className="mb-3 text-sm text-red-400">
          {error instanceof Error ? error.message : "Could not place the order."}
        </p>
      ) : null}
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-zinc-400">Total</span>
        <span className="font-semibold text-zinc-100">{formatMoney(total)}</span>
      </div>
      <button
        type="button"
        onClick={onPlace}
        disabled={pending}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {pending ? "Placing order…" : "Place order"}
      </button>
    </div>
  );
}

export function buildPriceMap(
  categories: MenuCategoryDto[] | undefined,
): Map<string, { name: string; price_amount: number }> {
  return new Map(
    (categories ?? []).flatMap((category) =>
      category.items.map(
        (item) =>
          [item.id, { name: item.name, price_amount: item.price_amount }] as [
            string,
            { name: string; price_amount: number },
          ],
      ),
    ),
  );
}

export function buildCartLines(
  cart: Record<string, number>,
  prices: Map<string, { name: string; price_amount: number }>,
): CartLine[] {
  return Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([itemId, qty]) => ({ itemId, qty, info: prices.get(itemId) }));
}
