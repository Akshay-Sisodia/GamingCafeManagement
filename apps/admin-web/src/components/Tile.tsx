import type { ReactNode } from "react";

export function Tile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>
        {icon ? <span className="text-emerald-400">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-zinc-50">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}
