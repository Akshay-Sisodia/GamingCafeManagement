export function HealthBar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0;
  const color =
    pct === null ? "bg-zinc-600" : value >= 90 ? "bg-red-500" : value >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">{pct === null ? "—" : `${Math.round(value)}%`}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-zinc-800">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}
