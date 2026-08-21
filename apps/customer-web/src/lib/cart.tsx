import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type CartMap = Record<string, number>;

interface CartContextValue {
  cart: CartMap;
  add: (itemId: string) => void;
  setQty: (itemId: string, qty: number) => void;
  clear: () => void;
  count: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartMap>({});

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      add: (itemId) =>
        setCart((current) => ({ ...current, [itemId]: (current[itemId] ?? 0) + 1 })),
      setQty: (itemId, qty) =>
        setCart((current) => {
          const next = { ...current };
          if (qty <= 0) delete next[itemId];
          else next[itemId] = qty;
          return next;
        }),
      clear: () => setCart({}),
      count: Object.values(cart).reduce((sum, qty) => sum + qty, 0),
    }),
    [cart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
