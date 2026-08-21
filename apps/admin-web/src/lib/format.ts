export function formatMoney(minorUnits: number): string {
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(minorUnits) / 100).toFixed(2)}`;
}

export function formatCountdown(msRemaining: number | null): string {
  if (msRemaining === null) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutesSince(iso: string, nowMs?: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor(((nowMs ?? Date.now()) - then) / 60000));
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
