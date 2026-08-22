import type { MenuCategoryDto } from "../../lib/types";
import { FormSelect } from "../../components/FormSelect";

export function AddItemFields({
  name,
  price,
  prepMinutes,
  categoryId,
  categories,
  pending,
  onNameChange,
  onPriceChange,
  onPrepMinutesChange,
  onCategoryIdChange,
  onClose,
}: {
  name: string;
  price: string;
  prepMinutes: string;
  categoryId: string;
  categories: MenuCategoryDto[];
  pending: boolean;
  onNameChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onPrepMinutesChange: (value: string) => void;
  onCategoryIdChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <h2 className="text-lg font-semibold text-zinc-50">Add menu item</h2>
      <label className="block text-xs text-zinc-400">
        Name
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          placeholder="Paneer tikka sandwich"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-zinc-400">
          Price (₹)
          <input
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            required
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            placeholder="120.00"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Prep minutes
          <input
            value={prepMinutes}
            onChange={(e) => onPrepMinutesChange(e.target.value)}
            required
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
      </div>
      <label className="block text-xs text-zinc-400">
        Category
        {categories.length === 0 ? (
          <p className="mt-1 text-sm text-amber-400/90">Add a category below before creating items.</p>
        ) : (
          <FormSelect
            value={categoryId}
            onChange={(e) => onCategoryIdChange(e.target.value)}
            required
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id} className="bg-zinc-900 text-zinc-100">
                {category.name}
              </option>
            ))}
          </FormSelect>
        )}
      </label>
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || categories.length === 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add item"}
        </button>
      </div>
    </>
  );
}
