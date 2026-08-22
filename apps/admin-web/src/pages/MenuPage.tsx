import { Plus } from "lucide-react";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { AddCategoryForm } from "./menu/AddCategoryForm";
import { AddItemModal } from "./menu/AddItemModal";
import { MenuCategorySection } from "./menu/MenuCategorySection";
import { useMenuPage } from "./menu/useMenuPage";

export function MenuPage() {
  const { addOpen, setAddOpen, categoryOpen, setCategoryOpen, menuQuery, patchItem, categories } =
    useMenuPage();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Menu</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategoryOpen((open) => !open)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Add category
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={categories.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {categoryOpen ? (
        <AddCategoryForm compact onCreated={() => setCategoryOpen(false)} />
      ) : null}

      {categories.length === 0 ? (
        <AddCategoryForm />
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
