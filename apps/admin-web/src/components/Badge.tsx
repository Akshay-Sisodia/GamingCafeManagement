import type { ReactNode } from "react";

const TONES = {
  zinc: "bg-zinc-800 text-zinc-300 ring-zinc-700",
  emerald: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  red: "bg-red-500/10 text-red-400 ring-red-500/30",
  sky: "bg-sky-500/10 text-sky-400 ring-sky-500/30",
  violet: "bg-violet-500/10 text-violet-400 ring-violet-500/30",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone = "zinc", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
