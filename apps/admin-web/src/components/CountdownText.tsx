import { formatCountdown } from "../lib/format";
import { useCountdown } from "../hooks/useCountdown";

export function CountdownText({
  expiresAt,
  className = "",
}: {
  expiresAt: string | null | undefined;
  className?: string;
}) {
  const ms = useCountdown(expiresAt);
  const expired = ms !== null && ms <= 0;
  return (
    <span
      className={`font-mono tabular-nums ${
        expired ? "text-red-400" : ms !== null && ms < 5 * 60_000 ? "text-amber-400" : "text-emerald-400"
      } ${className}`}
    >
      {formatCountdown(ms)}
    </span>
  );
}
