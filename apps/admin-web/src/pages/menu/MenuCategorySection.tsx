import type { MenuCategoryDto } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import { MenuToggle } from "./MenuToggle";

export function MenuCategorySection({
  category,
  patchPending,
  onToggleItem,
}: {
  category: MenuCategoryDto;
  patchPending: boolean;
  onToggleItem: (id: string, available: boolean) => void;
}) {
  return (
    <section>
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
            <MenuToggle
              checked={item.available}
              disabled={patchPending}
              onChange={() => onToggleItem(item.id, !item.available)}
              label={`Toggle ${item.name}`}
            />
          </div>
        ))}
        {category.items.length === 0 ? (
          <p className="text-sm text-zinc-500">No items in this category.</p>
        ) : null}
      </div>
    </section>
  );
}
