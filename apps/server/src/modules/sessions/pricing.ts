export interface PricingRuleInput {
  id?: string;
  name?: string;
  tier_id: string | null;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  hourly_rate: number;
  priority: number;
  active: boolean;
}

export interface PriceSegment {
  from: string;
  to: string;
  rule: string | null;
  hourly_rate: number;
  minutes: number;
}

export interface PriceResult {
  amount: number;
  breakdown: PriceSegment[];
}

function parseClock(value: string): number {
  const [h, m] = value.split(":");
  const hours = Number.parseInt(h ?? "0", 10);
  const minutes = Number.parseInt(m ?? "0", 10);
  return hours * 60 + minutes;
}

function ruleWindow(rule: PricingRuleInput): { startMin: number; endMin: number } {
  const startMin = parseClock(rule.start_time);
  let endMin = parseClock(rule.end_time);
  if (endMin <= startMin) endMin += 1440;
  return { startMin, endMin };
}

function ruleMatchesMinute(rule: PricingRuleInput, minuteOfDay: number): boolean {
  const { startMin, endMin } = ruleWindow(rule);
  if (endMin > 1440) {
    // Window wraps past midnight (e.g. 22:00 -> 06:00).
    return minuteOfDay >= startMin || minuteOfDay < endMin - 1440;
  }
  return minuteOfDay >= startMin && minuteOfDay < endMin;
}

function pickWinner(
  rules: PricingRuleInput[],
  tierId: string | null,
  dayOfWeek: number,
  minuteOfDay: number,
): PricingRuleInput | null {
  let winner: PricingRuleInput | null = null;
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.tier_id !== null && rule.tier_id !== tierId) continue;
    if (!rule.day_of_week.includes(dayOfWeek)) continue;
    if (!ruleMatchesMinute(rule, minuteOfDay)) continue;
    if (
      winner === null ||
      rule.priority > winner.priority ||
      (rule.priority === winner.priority && rule.hourly_rate > winner.hourly_rate)
    ) {
      winner = rule;
    }
  }
  return winner;
}

function ruleLabel(rule: PricingRuleInput | null): string | null {
  if (!rule) return null;
  return rule.name ?? rule.id ?? null;
}

export function computePrice(
  rules: PricingRuleInput[],
  startAt: Date,
  minutes: number,
  tierId: string | null,
): PriceResult {
  const breakdown: PriceSegment[] = [];
  let rateMinutes = 0;
  let current: { rule: PricingRuleInput | null; count: number; from: Date } | null = null;

  const flush = (): void => {
    if (!current) return;
    const to = new Date(current.from.getTime() + current.count * 60_000);
    breakdown.push({
      from: current.from.toISOString(),
      to: to.toISOString(),
      rule: ruleLabel(current.rule),
      hourly_rate: current.rule ? current.rule.hourly_rate : 0,
      minutes: current.count,
    });
    rateMinutes += (current.rule ? current.rule.hourly_rate : 0) * current.count;
  };

  // NOTE: rule windows are evaluated against the UTC wall clock of the
  // provided instant. The service layer is responsible for converting
  // cafe-local times before calling this function.
  for (let i = 0; i < minutes; i++) {
    const t = new Date(startAt.getTime() + i * 60_000);
    const winner = pickWinner(rules, tierId, t.getUTCDay(), t.getUTCHours() * 60 + t.getUTCMinutes());
    if (current && current.rule === winner) {
      current.count += 1;
    } else {
      flush();
      current = { rule: winner, count: 1, from: t };
    }
  }
  flush();

  return { amount: Math.round(rateMinutes / 60), breakdown };
}
