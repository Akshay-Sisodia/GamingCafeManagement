import { and, desc, eq, inArray } from "drizzle-orm";
import {
  SessionStatus,
  extendSessionSchema,
  startSessionSchema,
  uuidv7,
  type SessionDto,
} from "@gaming-cafe/shared";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { pcs, pricingRules, sessionEvents, sessions } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { computePrice, type PricingRuleInput } from "./pricing.js";

const TERMINAL_STATUSES: SessionStatus[] = ["ended", "cancelled", "expired"];

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
    .where(and(eq(pricingRules.cafeId, cafeId), eq(pricingRules.active, true)));
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

function publishSession(
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

async function getSessionOr404(id: string) {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw problem(404, "Not Found", "SESSION_NOT_FOUND");
  return row;
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sessions", { preHandler: requireUser(["owner", "manager", "staff"]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(startSessionSchema, req.body);

    return db.transaction(async (tx) => {
      if (input.idempotency_key) {
        const existing = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.idempotencyKey, input.idempotency_key))
          .limit(1);
        const found = existing[0];
        if (found) return { session: toSessionDto(found), server_time_ms: Date.now(), existing: true };
      }

      const pcRows = await tx
        .select()
        .from(pcs)
        .where(and(eq(pcs.id, input.pc_id), eq(pcs.cafeId, user.cafe_id)))
        .limit(1);
      const pc = pcRows[0];
      if (!pc) throw problem(404, "Not Found", "PC_NOT_FOUND");
      if (pc.status === "disabled" || pc.status === "maintenance") {
        throw problem(409, "Conflict", "PC_NOT_AVAILABLE", `PC is ${pc.status}`);
      }
      const activeRows = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.pcId, pc.id), inArray(sessions.status, ["active", "scheduled"])))
        .limit(1);
      if (activeRows[0]) throw problem(409, "Conflict", "PC_BUSY");

      const now = new Date();
      const rules = await loadPricingRules(user.cafe_id);
      const price = computePrice(rules, now, input.planned_minutes, pc.tierId);
      const expires = new Date(now.getTime() + input.planned_minutes * 60_000);

      let created: typeof sessions.$inferSelect | null = null;
      if (input.idempotency_key) {
        const inserted = await tx
          .insert(sessions)
          .values({
            id: uuidv7(),
            cafeId: user.cafe_id,
            pcId: pc.id,
            customerId: input.customer_id ?? null,
            startedAt: now,
            expiresAt: expires,
            plannedMinutes: input.planned_minutes,
            extendedMinutes: 0,
            priceAmount: price.amount,
            currency: "INR",
            pricingBreakdown: price.breakdown as unknown as Record<string, unknown>[],
            status: "active",
            origin: input.origin,
            createdBy: user.sub,
            idempotencyKey: input.idempotency_key,
          })
          .onConflictDoNothing({ target: sessions.idempotencyKey })
          .returning();
        created = inserted[0] ?? null;
        if (!created) {
          const again = await tx
            .select()
            .from(sessions)
            .where(eq(sessions.idempotencyKey, input.idempotency_key))
            .limit(1);
          const found = again[0];
          if (!found) throw problem(500, "Internal Server Error", "IDEMPOTENCY_FAILED");
          return { session: toSessionDto(found), server_time_ms: Date.now(), existing: true };
        }
      } else {
        const inserted = await tx
          .insert(sessions)
          .values({
            id: uuidv7(),
            cafeId: user.cafe_id,
            pcId: pc.id,
            customerId: input.customer_id ?? null,
            startedAt: now,
            expiresAt: expires,
            plannedMinutes: input.planned_minutes,
            extendedMinutes: 0,
            priceAmount: price.amount,
            currency: "INR",
            pricingBreakdown: price.breakdown as unknown as Record<string, unknown>[],
            status: "active",
            origin: input.origin,
            createdBy: user.sub,
          })
          .returning();
        created = inserted[0]!;
      }

      await tx.insert(sessionEvents).values({
        id: uuidv7(),
        sessionId: created.id,
        type: "started",
        actorType: "user",
        actorId: user.sub,
        payload: { planned_minutes: input.planned_minutes, price_amount: price.amount },
      });
      await writeAudit(tx, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "SESSION_STARTED",
        source: "online",
        pcId: pc.id,
        entityType: "session",
        entityId: created.id,
        metadata: { planned_minutes: input.planned_minutes, price_amount: price.amount },
      });

      const dto = toSessionDto(created);
      publishSession(user.cafe_id, pc.id, dto, "session.started");
      return { session: dto, server_time_ms: Date.now(), warnings: [600, 300, 60], existing: false };
    });
  });

  app.post(
    "/sessions/:id/extend",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    async (req) => {
      const user = req.user!;
      const { minutes } = parseBody(extendSessionSchema, req.body);
      const id = (req.params as { id: string }).id;

      const updated = await db.transaction(async (tx) => {
        // Lock the session row first for consistent lock ordering across all
        // transitions — prevents deadlocks under concurrent admin commands.
        const rows = await tx.select().from(sessions).where(eq(sessions.id, id)).for("update").limit(1);
        const session = rows[0];
        if (!session || session.cafeId !== user.cafe_id) {
          throw problem(404, "Not Found", "SESSION_NOT_FOUND");
        }
        if (session.status !== "active") {
          throw problem(409, "Conflict", "SESSION_NOT_ACTIVE");
        }
        const pcRows = await tx.select().from(pcs).where(eq(pcs.id, session.pcId)).limit(1);
        const pc = pcRows[0]!;
        const rules = await loadPricingRules(user.cafe_id);
        const totalMinutes = session.plannedMinutes + session.extendedMinutes + minutes;
        const newPrice = computePrice(rules, session.startedAt, totalMinutes, pc.tierId);
        const delta = newPrice.amount - session.priceAmount;
        const newExpires = new Date(session.expiresAt.getTime() + minutes * 60_000);

        const result = await tx
          .update(sessions)
          .set({
            expiresAt: newExpires,
            extendedMinutes: session.extendedMinutes + minutes,
            priceAmount: newPrice.amount,
            pricingBreakdown: newPrice.breakdown as unknown as Record<string, unknown>[],
          })
          .where(eq(sessions.id, id))
          .returning();
        const next = result[0]!;

        await tx.insert(sessionEvents).values({
          id: uuidv7(),
          sessionId: id,
          type: "extended",
          actorType: "user",
          actorId: user.sub,
          payload: { minutes, delta_amount: delta, new_expires_at: newExpires.toISOString() },
        });
        await writeAudit(tx, {
          cafeId: user.cafe_id,
          actorType: "user",
          actorId: user.sub,
          actorRole: user.role,
          action: "SESSION_EXTENDED",
          source: "online",
          pcId: session.pcId,
          entityType: "session",
          entityId: id,
          metadata: { minutes, delta_amount: delta },
        });

        const dto = toSessionDto(next);
        publishSession(user.cafe_id, session.pcId, dto);
        return dto;
      });
      return { session: updated, server_time_ms: Date.now() };
    },
  );

  const terminalTransition = (
    event: "ended" | "cancelled" | "paused" | "resumed",
    auditAction: string,
    apply: "end" | "cancel" | "none",
  ) => {
    return async (req: { user?: { sub: string; cafe_id: string; role: string }; params?: unknown }) => {
      const user = req.user!;
      const id = (req.params as { id: string }).id;
      const updated = await db.transaction(async (tx) => {
        // Lock the session row first (consistent ordering, see extend).
        const rows = await tx.select().from(sessions).where(eq(sessions.id, id)).for("update").limit(1);
        const session = rows[0];
        if (!session || session.cafeId !== user.cafe_id) {
          throw problem(404, "Not Found", "SESSION_NOT_FOUND");
        }
        if (TERMINAL_STATUSES.includes(session.status)) {
          throw problem(409, "Conflict", "SESSION_ALREADY_TERMINAL");
        }
        let next = session;
        if (apply === "end") {
          const result = await tx
            .update(sessions)
            .set({ status: "ended", endedAt: new Date() })
            .where(eq(sessions.id, id))
            .returning();
          next = result[0]!;
        } else if (apply === "cancel") {
          const result = await tx
            .update(sessions)
            .set({ status: "cancelled", endedAt: new Date() })
            .where(eq(sessions.id, id))
            .returning();
          next = result[0]!;
        }
        await tx.insert(sessionEvents).values({
          id: uuidv7(),
          sessionId: id,
          type: event,
          actorType: "user",
          actorId: user.sub,
          payload: {},
        });
        await writeAudit(tx, {
          cafeId: user.cafe_id,
          actorType: "user",
          actorId: user.sub,
          actorRole: user.role,
          action: auditAction,
          source: "online",
          pcId: session.pcId,
          entityType: "session",
          entityId: id,
        });
        const dto = toSessionDto(next);
        publishSession(
          user.cafe_id,
          session.pcId,
          dto,
          event === "ended" ? "session.ended" : undefined,
        );
        return dto;
      });
      return { session: updated, server_time_ms: Date.now() };
    };
  };

  app.post(
    "/sessions/:id/end",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    terminalTransition("ended", "SESSION_ENDED", "end"),
  );
  app.post(
    "/sessions/:id/cancel",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    terminalTransition("cancelled", "SESSION_CANCELLED", "cancel"),
  );
  app.post(
    "/sessions/:id/pause",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    terminalTransition("paused", "SESSION_PAUSED", "none"),
  );
  app.post(
    "/sessions/:id/resume",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    terminalTransition("resumed", "SESSION_RESUMED", "none"),
  );

  app.get("/pcs/:id/session", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const pcId = (req.params as { id: string }).id;
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.pcId, pcId),
          eq(sessions.cafeId, user.cafe_id),
          inArray(sessions.status, ["active", "scheduled"]),
        ),
      )
      .orderBy(desc(sessions.startedAt))
      .limit(1);
    const session = rows[0];
    return { session: session ? toSessionDto(session) : null, server_time_ms: Date.now() };
  });

  app.get("/sessions/:id/events", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const rows = await db
      .select({ event: sessionEvents })
      .from(sessionEvents)
      .innerJoin(sessions, eq(sessions.id, sessionEvents.sessionId))
      .where(and(eq(sessionEvents.sessionId, id), eq(sessions.cafeId, user.cafe_id)))
      .orderBy(sessionEvents.occurredAt);
    return { events: rows.map((r) => r.event) };
  });

  app.get("/sessions", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const query = req.query as { status?: string; limit?: string };
    const limit = Math.min(Number.parseInt(query.limit ?? "50", 10) || 50, 200);
    const conditions = [eq(sessions.cafeId, user.cafe_id)];
    if (query.status) {
      conditions.push(inArray(sessions.status, [query.status as SessionStatus]));
    }
    const rows = await db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.startedAt))
      .limit(limit);
    return { sessions: rows.map(toSessionDto) };
  });
}
