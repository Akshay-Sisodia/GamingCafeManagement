import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import type { MenuCategoryDto } from "../lib/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingBlock } from "../components/Spinner";
import { useToast } from "../components/Toasts";
import { formatMoney } from "../lib/format";

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        checked ? "bg-emerald-500" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function MenuPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const menuQuery = useQuery({ queryKey: ["menu"], queryFn: () => api<MenuCategoryDto[]>("/menu") });

  const patchItem = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      api(`/menu/items/${id}`, { method: "PATCH", body: { available } }),
    onMutate: async ({ id, available }) => {
      await queryClient.cancelQueries({ queryKey: ["menu"] });
      const previous = queryClient.getQueryData<MenuCategoryDto[]>(["menu"]);
      queryClient.setQueryData<MenuCategoryDto[]>(["menu"], (old) =>
        old?.map((category) => ({
          ...category,
          items: category.items.map((item) =>
            item.id === id ? { ...item, available } : item,
          ),
        })),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["menu"], context.previous);
      toast.push(error instanceof Error ? error.message : "Update failed", "error");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["menu"] }),
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
          <section key={category.id}>
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
              {category.name}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {category.items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between rounded-xl border p-4 ${
                    item.available
                      ? "border-zinc-800 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-900/40 opacity-70"
                  }`}
                >
                  <div>
                    <div className="font-medium text-zinc-100">{item.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {formatMoney(item.price_amount)} · {item.prep_minutes} min prep
                    </div>
                  </div>
                  <Toggle
                    checked={item.available}
                    disabled={patchItem.isPending}
                    onChange={() =>
                      patchItem.mutate({ id: item.id, available: !item.available })
                    }
                    label={`Toggle ${item.name}`}
                  />
                </div>
              ))}
              {category.items.length === 0 ? (
                <p className="text-sm text-zinc-500">No items in this category.</p>
              ) : null}
            </div>
          </section>
        ))
      )}

      <AddItemModal
        open={addOpen}
        categories={categories}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

function AddItemModal({
  open,
  categories,
  onClose,
}: {
  open: boolean;
  categories: MenuCategoryDto[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("10");
  const [categoryId, setCategoryId] = useState("");

  const createItem = useMutation({
    mutationFn: (body: {
      category_id: string;
      name: string;
      price_amount: number;
      prep_minutes: number;
    }) => api("/menu/items", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["menu"] });
      setName("");
      setPrice("");
      setPrepMinutes("10");
      onClose();
      toast.push("Menu item added");
    },
    onError: (error) =>
      toast.push(error instanceof Error ? error.message : "Could not add item", "error"),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const priceRupees = Number.parseFloat(price);
    const prep = Number.parseInt(prepMinutes, 10);
    if (!name.trim() || !categoryId || Number.isNaN(priceRupees) || priceRupees < 0 || Number.isNaN(prep)) {
      toast.push("Fill in a valid name, price and prep time.", "error");
      return;
    }
    createItem.mutate({
      category_id: categoryId,
      name: name.trim(),
      price_amount: Math.round(priceRupees * 100),
      prep_minutes: prep,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-zinc-50">Add menu item</h2>
        <label className="block text-xs text-zinc-400">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setPrice(e.target.value)}
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
              onChange={(e) => setPrepMinutes(e.target.value)}
              required
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            />
          </label>
        </div>
        <label className="block text-xs text-zinc-400">
          Category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          >
            <option value="">Select category…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
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
            disabled={createItem.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {createItem.isPending ? "Saving…" : "Add item"}
          </button>
        </div>
      </form>
    </div>
  );
}
