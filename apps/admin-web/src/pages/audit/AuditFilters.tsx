import type { FormEvent } from "react";

export function AuditFilters({
  action,
  from,
  to,
  onActionChange,
  onFromChange,
  onToChange,
  onApply,
}: {
  action: string;
  from: string;
  to: string;
  onActionChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onApply} className="flex flex-wrap items-end gap-3">
      <label className="block text-xs text-zinc-400">
        Action
        <input
          value={action}
          onChange={(e) => onActionChange(e.target.value)}
          placeholder="e.g. session.end"
          className="mt-1 w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500"
        />
      </label>
      <label className="block text-xs text-zinc-400">
        From
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
      </label>
      <label className="block text-xs text-zinc-400">
        To
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Apply filters
      </button>
    </form>
  );
}
