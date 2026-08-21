import { Plus } from "lucide-react";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { AddItemModal } from "./menu/AddItemModal";
import { MenuCategorySection } from "./menu/MenuCategorySection";
import { useMenuPage } from "./menu/useMenuPage";

export function MenuPage() {
  const { addOpen, setAddOpen, menuQuery, patchItem, categories } = useMenuPage();

  if (menuQuery.isLoading) return <LoadingBlock />;
  if (menuQuery.isError) {
    return (
      <ErrorState
        message={menuQuery.error instanceof Error ? menuQuery.error.message : undefined}
        onRetry={() => void menuQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Menu</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm text-zinc-500">No menu categories yet.</p>
      ) : (
        categories.map((category) => (
          <MenuCategorySection
            key={category.id}
            category={category}
            patchPending={patchItem.isPending}
            onToggleItem={(id, available) => patchItem.mutate({ id, available })}
          />
        ))
      )}

      <AddItemModal open={addOpen} categories={categories} onClose={() => setAddOpen(false)} />
    </div>
  );
}
