import { and, desc, eq, inArray } from "drizzle-orm";
import {
  SessionStatus,
  extendSessionSchema,
  uuidv7,
  type SessionDto,
} from "@gaming-cafe/shared";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { pcs, sessionEvents, sessions } from "../../db/schema.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { issuePcCommand } from "../commands/issue.js";
import { loadPricingRules, publishSession, toSessionDto } from "./shared.js";
import { computePrice } from "./pricing.js";

export { handleStartSession } from "./start.js";

const TERMINAL_STATUSES: SessionStatus[] = ["ended", "cancelled", "expired"];

export async function handleExtendSession(req: FastifyRequest) {
  const user = req.user!;
  const { minutes } = parseBody(extendSessionSchema, req.body);
  const id = (req.params as { id: string }).id;

  const updated = await db.transaction(async (tx) => {
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
}

export function makeTerminalTransitionHandler(
  event: "ended" | "cancelled" | "paused" | "resumed",
  auditAction: string,
  apply: "end" | "cancel" | "pause" | "resume" | "none",
) {
  return async (req: FastifyRequest) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const updated = await db.transaction(async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.id, id)).for("update").limit(1);
      const session = rows[0];
      if (!session || session.cafeId !== user.cafe_id) {
        throw problem(404, "Not Found", "SESSION_NOT_FOUND");
      }
      if (TERMINAL_STATUSES.includes(session.status)) {
        throw problem(409, "Conflict", "SESSION_ALREADY_TERMINAL");
      }
      if (apply === "pause" && session.status !== "active") {
        throw problem(409, "Conflict", "SESSION_NOT_ACTIVE");
      }
      if (apply === "resume" && session.status !== "paused") {
        throw problem(409, "Conflict", "SESSION_NOT_PAUSED");
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
      } else if (apply === "pause") {
        const result = await tx
          .update(sessions)
          .set({ status: "paused" })
          .where(eq(sessions.id, id))
          .returning();
        next = result[0]!;
      } else if (apply === "resume") {
        const result = await tx
          .update(sessions)
          .set({ status: "active" })
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
    if (apply === "end" || apply === "cancel") {
      await issuePcCommand({
        cafeId: user.cafe_id,
        pcId: updated.pc_id,
        type: "end_session",
        payload: { reason: event },
        issuedBy: user.sub,
        confirmedBy: user.sub,
        requiresConfirm: true,
      });
    }
    return { session: updated, server_time_ms: Date.now() };
  };
}

export async function handlePcSession(req: FastifyRequest) {
  const user = req.user!;
  const pcId = (req.params as { id: string }).id;
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.pcId, pcId),
        eq(sessions.cafeId, user.cafe_id),
        inArray(sessions.status, ["active", "scheduled", "paused"]),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  const session = rows[0];
  return { session: session ? toSessionDto(session) : null, server_time_ms: Date.now() };
}

export async function handleSessionEvents(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const query = req.query as { limit?: string };
  const limit = Math.min(Number.parseInt(query.limit ?? "200", 10) || 200, 500);
  const rows = await db
    .select({ event: sessionEvents })
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessions.id, sessionEvents.sessionId))
    .where(and(eq(sessionEvents.sessionId, id), eq(sessions.cafeId, user.cafe_id)))
    .orderBy(sessionEvents.occurredAt)
    .limit(limit);
  return { events: rows.map((r) => r.event) };
}

export async function handleListSessions(req: FastifyRequest) {
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
}
