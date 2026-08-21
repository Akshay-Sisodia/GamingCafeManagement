import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";
import type { CreateOrderInput, OrderDto } from "@gaming-cafe/shared";
import { api } from "../lib/api";
import { useCart } from "../lib/cart";
import { formatMoney } from "../lib/format";
import type { MenuCategoryDto } from "../lib/types";

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart();
  const queryClient = useQueryClient();
  const [placedOrder, setPlacedOrder] = useState<OrderDto | null>(null);

  const menuQuery = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuCategoryDto[]>("/menu"),
    enabled: open,
  });

  const placeOrder = useMutation({
    mutationFn: (body: CreateOrderInput) => api<OrderDto>("/orders", { method: "POST", body }),
    onSuccess: (order) => {
      setPlacedOrder(order);
      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (!open) return null;

  const prices = new Map<string, { name: string; price_amount: number }>();
  for (const category of menuQuery.data ?? []) {
    for (const item of category.items) {
      prices.set(item.id, { name: item.name, price_amount: item.price_amount });
    }
  }

  const lines = Object.entries(cart.cart)
    .filter(([, qty]) => qty > 0)
    .map(([itemId, qty]) => ({ itemId, qty, info: prices.get(itemId) }));
  const total = lines.reduce((sum, line) => sum + (line.info?.price_amount ?? 0) * line.qty, 0);

  function handlePlace() {
    if (lines.length === 0) return;
    placeOrder.mutate({
      source: "customer_web",
      items: lines.map((line) => ({ menu_item_id: line.itemId, qty: line.qty })),
    });
  }

  function handleClose() {
    setPlacedOrder(null);
    placeOrder.reset();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} aria-hidden="true" />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <ShoppingCart className="h-5 w-5 text-emerald-400" /> Your order
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close cart"
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {placedOrder ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-lg font-semibold text-emerald-400">Order placed!</p>
            <p className="text-sm text-zinc-400">
              Order #{placedOrder.number} — {formatMoney(placedOrder.total_amount)}. It will be
              delivered to your seat shortly.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <ShoppingCart className="h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500">Your cart is empty. Add something tasty!</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {lines.map((line) => (
                <div
                  key={line.itemId}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-100">
                      {line.info?.name ?? "Menu item"}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {formatMoney((line.info?.price_amount ?? 0) * line.qty)}
                    </div>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => cart.setQty(line.itemId, line.qty - 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-6 text-center font-semibold tabular-nums">{line.qty}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => cart.setQty(line.itemId, line.qty + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-zinc-800 p-4">
              {placeOrder.isError ? (
                <p className="mb-3 text-sm text-red-400">
                  {placeOrder.error instanceof Error
                    ? placeOrder.error.message
                    : "Could not place the order."}
                </p>
              ) : null}
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-zinc-400">Total</span>
                <span className="font-semibold text-zinc-100">{formatMoney(total)}</span>
              </div>
              <button
                type="button"
                onClick={handlePlace}
                disabled={placeOrder.isPending}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {placeOrder.isPending ? "Placing order…" : "Place order"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
