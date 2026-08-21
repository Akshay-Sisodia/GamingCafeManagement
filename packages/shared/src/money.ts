/** Formats integer paise (minor units) as an INR string. */
export function formatPaise(minorUnits: number): string {
  const sign = minorUnits < 0 ? "-" : "";
  return `${sign}₹${(Math.abs(minorUnits) / 100).toFixed(2)}`;
}
