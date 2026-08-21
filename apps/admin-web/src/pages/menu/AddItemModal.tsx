import type { FormEvent } from "react";
import type { MenuCategoryDto } from "../../lib/types";
import { AddItemFields } from "./AddItemFields";
import { useAddItemModal } from "./useAddItemModal";

export function AddItemModal({
  open,
  categories,
  onClose,
}: {
  open: boolean;
  categories: MenuCategoryDto[];
  onClose: () => void;
}) {
  const form = useAddItemModal(onClose);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <AddItemFields
          name={form.name}
          price={form.price}
          prepMinutes={form.prepMinutes}
          categoryId={form.categoryId}
          categories={categories}
          pending={form.pending}
          onNameChange={form.setName}
          onPriceChange={form.setPrice}
          onPrepMinutesChange={form.setPrepMinutes}
          onCategoryIdChange={form.setCategoryId}
          onClose={onClose}
        />
      </form>
    </div>
  );
}
