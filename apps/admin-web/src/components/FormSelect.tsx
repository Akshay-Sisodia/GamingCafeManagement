import type { SelectHTMLAttributes } from "react";

const selectClass =
  "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500 [color-scheme:dark]";

export function FormSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={className ? `${selectClass} ${className}` : selectClass} {...props}>
      {children}
    </select>
  );
}
