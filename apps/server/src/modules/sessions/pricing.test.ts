import { describe, expect, it } from "vitest";
import { computePrice, type PricingRuleInput } from "./pricing.js";

function rule(partial: Partial<PricingRuleInput>): PricingRuleInput {
  return {
    id: partial.id ?? "r",
    name: partial.name ?? "rule",
    tier_id: partial.tier_id ?? null,
    day_of_week: partial.day_of_week ?? [0, 1, 2, 3, 4, 5, 6],
    start_time: partial.start_time ?? "00:00",
    end_time: partial.end_time ?? "23:59",
    hourly_rate: partial.hourly_rate ?? 15000,
    priority: partial.priority ?? 0,
    active: partial.active ?? true,
  };
}

describe("computePrice", () => {
  it("prices a simple off-peak hour at the standard rate", () => {
    // Wednesday 10:00 local-to-UTC-safe: use UTC dates directly
    const start = new Date("2026-08-19T10:00:00Z"); // Wed
    const result = computePrice([rule({ hourly_rate: 15000 })], start, 60, null);
    expect(result.amount).toBe(15000);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]?.minutes).toBe(60);
  });

  it("splits when crossing into a peak window", () => {
    const standard = rule({ id: "std", name: "Standard", start_time: "00:00", end_time: "23:59", hourly_rate: 15000, priority: 0 });
    const peak = rule({ id: "peak", name: "Peak", start_time: "18:00", end_time: "23:00", hourly_rate: 20000, priority: 10 });
    const start = new Date("2026-08-19T17:30:00Z"); // Wed 17:30
    const result = computePrice([standard, peak], start, 60, null);
    expect(result.amount).toBe(17500); // 30min @150 + 30min @200
    expect(result.breakdown).toHaveLength(2);
  });

  it("applies weekend rate on Saturday", () => {
    const weekend = rule({ id: "wend", name: "Weekend", day_of_week: [0, 6], start_time: "00:00", end_time: "23:59", hourly_rate: 18000, priority: 5 });
    const weekday = rule({ id: "wd", name: "Weekday", day_of_week: [1, 2, 3, 4, 5], start_time: "00:00", end_time: "23:59", hourly_rate: 15000, priority: 5 });
    const saturday = new Date("2026-08-22T10:00:00Z");
    expect(computePrice([weekend, weekday], saturday, 30, null).amount).toBe(9000);
    const wednesday = new Date("2026-08-19T10:00:00Z");
    expect(computePrice([weekend, weekday], wednesday, 30, null).amount).toBe(7500);
  });

  it("higher priority wins overlapping windows", () => {
    const low = rule({ id: "low", hourly_rate: 15000, priority: 1 });
    const high = rule({ id: "high", start_time: "10:00", end_time: "11:00", hourly_rate: 25000, priority: 100 });
    const start = new Date("2026-08-19T10:00:00Z");
    expect(computePrice([low, high], start, 60, null).amount).toBe(25000);
  });

  it("tier-specific rules only apply to that tier", () => {
    const premium = rule({ id: "prem", tier_id: "tier-premium", hourly_rate: 13000 });
    expect(computePrice([premium], new Date("2026-08-19T10:00:00Z"), 60, "tier-premium").amount).toBe(13000);
    expect(computePrice([premium], new Date("2026-08-19T10:00:00Z"), 60, null).amount).toBe(0);
  });

  it("inactive rules are ignored", () => {
    const inactive = rule({ hourly_rate: 99999, active: false });
    expect(computePrice([inactive], new Date("2026-08-19T10:00:00Z"), 60, null).amount).toBe(0);
  });

  it("handles overnight windows wrapping past midnight", () => {
    const night = rule({ id: "night", start_time: "22:00", end_time: "06:00", hourly_rate: 12000 });
    const late = new Date("2026-08-19T23:30:00Z");
    const result = computePrice([night], late, 60, null);
    expect(result.amount).toBe(12000); // full hour inside 22:00-06:00 window
  });
});
