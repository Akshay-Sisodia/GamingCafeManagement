import { KitchenColumn } from "./kitchen/KitchenColumn";
import { KitchenErrorBanner } from "./kitchen/KitchenErrorBanner";
import { KitchenHeader } from "./kitchen/KitchenHeader";
import { useKitchenPage } from "./kitchen/useKitchenPage";

const COLUMNS = [
  { key: "new", title: "NEW", statuses: ["placed"], accent: "bg-sky-500" },
  { key: "preparing", title: "PREPARING", statuses: ["accepted", "preparing"], accent: "bg-amber-500" },
  { key: "ready", title: "READY", statuses: ["ready"], accent: "bg-emerald-500" },
] as const;

/**
 * Kitchen Display — standalone tablet-friendly board (no app shell).
 * Merged from the former kitchen-web app; same live SSE + 10s polling.
 */
export function KitchenPage() {
  const kitchen = useKitchenPage();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <KitchenHeader connected={kitchen.connected} />
      {kitchen.errorMessage ? (
        <KitchenErrorBanner message={kitchen.errorMessage} onRetry={kitchen.onRetry} />
      ) : null}
      <main className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
        {COLUMNS.map((column) => (
          <KitchenColumn
            key={column.key}
            title={column.title}
            accent={column.accent}
            orders={kitchen.orders.filter((order) =>
              (column.statuses as readonly string[]).includes(order.status),
            )}
            pcNames={kitchen.pcNames}
            now={kitchen.now}
            busy={kitchen.actPending}
            onAction={kitchen.onAction}
          />
        ))}
      </main>
    </div>
  );
}
