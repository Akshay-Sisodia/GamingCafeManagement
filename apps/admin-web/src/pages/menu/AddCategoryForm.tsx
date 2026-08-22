import type { FormEvent } from "react";
import { useAddCategory } from "./useAddCategory";

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";

export function AddCategoryForm({
  compact = false,
  onCreated,
}: {
  compact?: boolean;
  onCreated?: () => void;
}) {
  const form = useAddCategory(onCreated);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "flex flex-wrap items-end gap-2" : "space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"}
    >
      {!compact ? (
        <p className="text-sm text-zinc-400">
          Create a category first — items need one before you can add them to the menu.
        </p>
      ) : null}
      <label className={compact ? "min-w-[12rem] flex-1 text-xs text-zinc-400" : "block text-xs text-zinc-400"}>
        {compact ? null : "Category name"}
        <input
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          required
          placeholder="Burgers, Drinks…"
          className={fieldClass}
        />
      </label>
      <button
        type="submit"
        disabled={form.pending}
        className={
          compact
            ? "rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            : "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        }
      >
        {form.pending ? "Saving…" : "Add category"}
      </button>
    </form>
  );
}
