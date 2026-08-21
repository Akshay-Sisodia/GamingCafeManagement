/**
 * Money is always integer minor units (paise) plus an ISO-4217 currency code.
 * Never use floats for money.
 */
export interface Money {
  amount: number; // minor units
  currency: string; // e.g. "INR"
}

export function money(amount: number, currency = "INR"): Money {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid money amount: ${amount}`);
  }
  return { amount, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("Currency mismatch");
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function formatMoney(m: Money): string {
  return `${(m.amount / 100).toFixed(2)} ${m.currency}`;
}
