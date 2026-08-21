import { useQuery } from "@tanstack/react-query";
import { Plus, Clock } from "lucide-react";
import { api } from "../lib/api";
import type { MenuCategoryDto } from "../lib/types";
import { useCart } from "../lib/cart";
import { formatMoney } from "../lib/format";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";

export function MenuPage() {
  const cart = useCart();
  const menuQuery = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<MenuCategoryDto[]>("/menu"),
  });

  if (menuQuery.isLoading) return <LoadingBlock />;
  if (menuQuery.isError) {
    return (
      <ErrorState
        message={menuQuery.error instanceof Error ? menuQuery.error.message : undefined}
        onRetry={() => void menuQuery.refetch()}
      />
    );
  }

  const categories = menuQuery.data ?? [];

  if (categories.length === 0) {
    return <p className="p-4 text-sm text-zinc-500">The menu is empty right now.</p>;
  }

  return (
    <div className="space-y-6 p-4 pb-28">
      {categories.map((category) => (
        <section key={category.id}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {category.name}
          </h2>
          <div className="mt-3 space-y-2">
            {category.items.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3 ${
                  item.available ? "" : "opacity-50"
                }`}
              >
                <div>
                  <div className="font-medium text-zinc-100">{item.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                    {formatMoney(item.price_amount)}
                    <span>·</span>
                    <Clock className="h-3 w-3" />
                    {item.prep_minutes} min
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!item.available}
                  onClick={() => cart.add(item.id)}
                  aria-label={`Add ${item.name} to cart`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            ))}
            {category.items.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing here yet.</p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
