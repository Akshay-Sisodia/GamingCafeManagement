import { and, eq } from "drizzle-orm";
import type { SessionDto } from "@gaming-cafe/shared";
import { db } from "../../db/index.js";
import { pricingRules, sessions } from "../../db/schema.js";
import { problem } from "../../lib/problem.js";
import { publishToCafe } from "../realtime/service.js";
import type { PricingRuleInput } from "./pricing.js";

export function toSessionDto(row: typeof sessions.$inferSelect): SessionDto {
  return {
    id: row.id,
    cafe_id: row.cafeId,
    pc_id: row.pcId,
    customer_id: row.customerId,
    started_at: row.startedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    ended_at: row.endedAt ? row.endedAt.toISOString() : null,
    planned_minutes: row.plannedMinutes,
    extended_minutes: row.extendedMinutes,
    price_amount: row.priceAmount,
    currency: row.currency,
    status: row.status,
    origin: row.origin,
  };
}

export async function loadPricingRules(cafeId: string): Promise<PricingRuleInput[]> {
  const rows = await db
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.cafeId, cafeId), eq(pricingRules.active, true)))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tier_id: r.tierId,
    day_of_week: r.dayOfWeek,
    start_time: r.startTime,
    end_time: r.endTime,
    hourly_rate: r.hourlyRate,
    priority: r.priority,
    active: r.active,
  }));
}

export function publishSession(
  cafeId: string,
  pcId: string,
  dto: SessionDto,
  adminEvent?: string,
): void {
  publishToCafe(cafeId, {
    event: "session.updated",
    pc_id: pcId,
    data: {
      session_id: dto.id,
      pc_id: dto.pc_id,
      expires_at: dto.expires_at,
      status: dto.status,
    },
  });
  if (adminEvent) {
    publishToCafe(cafeId, {
      event: adminEvent,
      data: {
        session_id: dto.id,
        pc_id: dto.pc_id,
        expires_at: dto.expires_at,
        status: dto.status,
      },
    });
  }
}

export async function getSessionOr404(id: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw problem(404, "Not Found", "SESSION_NOT_FOUND");
  return row;
}
