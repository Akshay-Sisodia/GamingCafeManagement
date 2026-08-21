import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { MenuCategoryDto } from "../lib/types";
import { useCart } from "../lib/cart";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { MenuCategorySection } from "./menu/MenuCategorySection";

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
        <MenuCategorySection key={category.id} category={category} onAdd={cart.add} />
      ))}
    </div>
  );
}
