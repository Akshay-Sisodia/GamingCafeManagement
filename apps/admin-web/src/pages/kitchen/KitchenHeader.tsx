import { ChefHat } from "lucide-react";

export function KitchenHeader({ connected }: { connected: boolean }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <ChefHat className="h-7 w-7 text-emerald-600" />
        <h1 className="text-2xl font-bold tracking-tight">Kitchen Display</h1>
      </div>
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-500">
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            connected ? "animate-pulse bg-emerald-500" : "bg-red-500"
          }`}
        />
        {connected ? "Live" : "Reconnecting…"}
      </span>
    </header>
  );
}
