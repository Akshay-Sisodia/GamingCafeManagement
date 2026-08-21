export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400"
      style={{ width: size, height: size }}
      role="status"
      aria-label="loading"
    />
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
