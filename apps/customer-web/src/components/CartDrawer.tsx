import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateOrderInput, OrderDto } from "@gaming-cafe/shared";
import { api } from "../lib/api";
import { useCart } from "../lib/cart";
import type { MenuCategoryDto } from "../lib/types";
import {
  CartDrawerHeader,
  CartFooter,
  CartLineRow,
  EmptyCartView,
  OrderPlacedView,
  buildCartLines,
  buildPriceMap,
  type CartLine,
} from "./cart/cart-drawer-parts";

function CartLineList({
  lines,
  onDecrease,
  onIncrease,
}: {
  lines: CartLine[];
  onDecrease: (itemId: string, qty: number) => void;
  onIncrease: (itemId: string, qty: number) => void;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {lines.map((line) => (
        <CartLineRow
          key={line.itemId}
          line={line}
          onDecrease={() => onDecrease(line.itemId, line.qty - 1)}
          onIncrease={() => onIncrease(line.itemId, line.qty + 1)}
        />
      ))}
    </div>
  );
}

function CartDrawerBody({
  placedOrder,
  lines,
  total,
  placeError,
  placePending,
  onClose,
  onPlace,
  onDecrease,
  onIncrease,
}: {
  placedOrder: OrderDto | null;
  lines: CartLine[];
  total: number;
  placeError: Error | null;
  placePending: boolean;
  onClose: () => void;
  onPlace: () => void;
  onDecrease: (itemId: string, qty: number) => void;
  onIncrease: (itemId: string, qty: number) => void;
}) {
  if (placedOrder) return <OrderPlacedView order={placedOrder} onClose={onClose} />;
  if (lines.length === 0) return <EmptyCartView />;
  return (
    <>
      <CartLineList lines={lines} onDecrease={onDecrease} onIncrease={onIncrease} />
      <CartFooter total={total} error={placeError} pending={placePending} onPlace={onPlace} />
    </>
  );
}

function CartDrawerContent({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const queryClient = useQueryClient();
  const [placedOrder, setPlacedOrder] = useState<OrderDto | null>(null);

  const menuQuery = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuCategoryDto[]>("/menu"),
  });

  const placeOrder = useMutation({
    mutationFn: (body: CreateOrderInput) => api<OrderDto>("/orders", { method: "POST", body }),
    onSuccess: (order) => {
      setPlacedOrder(order);
      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const prices = buildPriceMap(menuQuery.data);
  const lines = buildCartLines(cart.cart, prices);
  const total = lines.reduce((sum, line) => sum + (line.info?.price_amount ?? 0) * line.qty, 0);

  function handleClose() {
    setPlacedOrder(null);
    placeOrder.reset();
    onClose();
  }

  function handlePlace() {
    if (lines.length === 0) return;
    placeOrder.mutate({
      source: "customer_web",
      items: lines.map((line) => ({ menu_item_id: line.itemId, qty: line.qty })),
    });
  }

  return (
    <div className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
      <CartDrawerHeader onClose={handleClose} />
      <CartDrawerBody
        placedOrder={placedOrder}
        lines={lines}
        total={total}
        placeError={placeOrder.error}
        placePending={placeOrder.isPending}
        onClose={handleClose}
        onPlace={handlePlace}
        onDecrease={cart.setQty}
        onIncrease={cart.setQty}
      />
    </div>
  );
}

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <CartDrawerContent onClose={onClose} />
    </div>
  );
}
