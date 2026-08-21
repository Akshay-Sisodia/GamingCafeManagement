export function formatMoney(minorUnits: number): string {
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(minorUnits) / 100).toFixed(2)}`;
}

export function minutesSince(iso: string, nowMs?: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor(((nowMs ?? Date.now()) - then) / 60000));
}
