import { and, asc, desc, eq } from "drizzle-orm";
import {
  syncBatchSchema,
  uuidv7,
  type SyncBatchResponse,
  type SyncEventResult,
} from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import {
  offlineEvents,
  pcs,
  pricingRules,
  reconciliationBatches,
  sessionEvents,
  sessions,
} from "../../db/schema.js";
import { requireDevice, requireUser } from "../../auth/guards.js";
import { parseBody, parseQuery, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { computePrice, type PricingRuleInput } from "../sessions/pricing.js";
import { resolveOfflineEvent } from "./conflicts.js";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sync/events", { preHandler: requireDevice() }, async (req) => {
    const device = req.device!;
    const input = parseBody(syncBatchSchema, req.body);
    const events = [...input.events].sort((a, b) => a.seq - b.seq);

    const batchRows = await db
      .insert(reconciliationBatches)
      .values({
        pcId: device.pc_id,
        agentVersion: input.agent_version,
        lastServerSeq: input.last_server_seq,
        eventCount: events.length,
      })
      .returning();
    const batchId = batchRows[0]!.id;

    const results: SyncEventResult[] = [];

    for (const evt of events) {
      const result = await db.transaction(async (tx): Promise<SyncEventResult> => {
        const existing = await tx
          .select({ id: offlineEvents.id })
          .from(offlineEvents)
          .where(eq(offlineEvents.id, evt.event_id))
          .limit(1);
        if (existing[0]) {
          return { event_id: evt.event_id, seq: evt.seq, state: "duplicate" };
        }
        const seqClash = await tx
          .select({ id: offlineEvents.id })
          .from(offlineEvents)
          .where(and(eq(offlineEvents.pcId, device.pc_id), eq(offlineEvents.seq, evt.seq)))
          .limit(1);
        if (seqClash[0]) {
          return { event_id: evt.event_id, seq: evt.seq, state: "duplicate" };
        }

        // Record the event FIRST (PK = event_id is the global idempotency key).
        // Concurrent replays of the same id lose this insert and return duplicate.
        const insertedEvent = await tx
          .insert(offlineEvents)
          .values({
            id: evt.event_id,
            cafeId: device.cafe_id,
            pcId: device.pc_id,
            seq: evt.seq,
            type: evt.type,
            occurredAt: new Date(evt.occurred_at),
            payload: evt.payload as Record<string, unknown>,
            state: "accepted", // provisional; updated with the final decision below
          })
          .onConflictDoNothing({ target: offlineEvents.id })
          .returning();
        if (!insertedEvent[0]) {
          return { event_id: evt.event_id, seq: evt.seq, state: "duplicate" };
        }

        const occurredAt = new Date(evt.occurred_at);
        const now = new Date();

        const activeRows = await tx
          .select()
          .from(sessions)
          .where(and(eq(sessions.pcId, device.pc_id), eq(sessions.status, "active")))
          .orderBy(desc(sessions.startedAt))
          .limit(1);
        const activeSession = activeRows[0] ?? null;
        const decision = resolveOfflineEvent(
          activeSession ? { id: activeSession.id, status: activeSession.status } : null,
          evt,
        );

        let state: "accepted" | "conflicted" | "duplicate" =
          decision.action === "conflict"
            ? "conflicted"
            : decision.action === "duplicate"
              ? "duplicate"
              : "accepted";
        let appliedSessionId: string | null = null;

        if (decision.action === "accept_start") {
          const payload = asRecord(evt.payload);
          const plannedMinutes = Math.max(
            5,
            Math.min(24 * 60, Number.parseInt(String(payload.planned_minutes ?? "60"), 10) || 60),
          );
          let expiresAt = new Date(occurredAt.getTime() + plannedMinutes * 60_000);
          let status: "active" | "expired" = "active";
          let endedAt: Date | null = null;
          if (expiresAt.getTime() <= now.getTime()) {
            status = "expired";
            endedAt = expiresAt;
            expiresAt = now;
          }
          const pcRows = await tx.select().from(pcs).where(eq(pcs.id, device.pc_id)).limit(1);
          const pc = pcRows[0]!;
          const ruleRows = await tx
            .select()
            .from(pricingRules)
            .where(and(eq(pricingRules.cafeId, device.cafe_id), eq(pricingRules.active, true)));
          const rules: PricingRuleInput[] = ruleRows.map((r) => ({
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
          const price = computePrice(rules, occurredAt, plannedMinutes, pc.tierId);

          const insertedSession = await tx
            .insert(sessions)
            .values({
              id: uuidv7(),
              cafeId: device.cafe_id,
              pcId: device.pc_id,
              customerId: null,
              startedAt: occurredAt,
              expiresAt,
              endedAt,
              plannedMinutes,
              extendedMinutes: 0,
              priceAmount: price.amount,
              currency: "INR",
              pricingBreakdown: price.breakdown as unknown as Record<string, unknown>[],
              status,
              origin: "superadmin_offline",
              createdBy: null,
            })
            .returning();
          const session = insertedSession[0]!;
          appliedSessionId = session.id;

          await tx.insert(sessionEvents).values({
            id: uuidv7(),
            sessionId: session.id,
            type: "started",
            actorType: "pc",
            actorId: device.pc_id,
            occurredAt,
            payload: { planned_minutes: plannedMinutes, offline: true },
          });
          await writeAudit(tx, {
            cafeId: device.cafe_id,
            actorType: "pc",
            actorId: device.pc_id,
            action: "SUPERADMIN_SESSION_STARTED",
            source: "offline",
            pcId: device.pc_id,
            entityType: "session",
            entityId: session.id,
            metadata: { event_id: evt.event_id, seq: evt.seq },
          });
          publishToCafe(device.cafe_id, {
            event: "session.updated",
            pc_id: device.pc_id,
            data: {
              session_id: session.id,
              pc_id: device.pc_id,
              expires_at: expiresAt.toISOString(),
              status,
            },
          });
        } else if (decision.action === "accept_extend" && activeSession) {
          const payload = asRecord(evt.payload);
          const minutes = Math.max(
            5,
            Math.min(24 * 60, Number.parseInt(String(payload.minutes ?? payload.planned_minutes ?? "0"), 10) || 0),
          );
          const newExpires = new Date(activeSession.expiresAt.getTime() + minutes * 60_000);
          const updated = await tx
            .update(sessions)
            .set({
              expiresAt: newExpires,
              extendedMinutes: activeSession.extendedMinutes + minutes,
            })
            .where(eq(sessions.id, activeSession.id))
            .returning();
          appliedSessionId = activeSession.id;
          await tx.insert(sessionEvents).values({
            id: uuidv7(),
            sessionId: activeSession.id,
            type: "extended",
            actorType: "pc",
            actorId: device.pc_id,
            occurredAt,
            payload: { minutes, offline: true },
          });
          await writeAudit(tx, {
            cafeId: device.cafe_id,
            actorType: "pc",
            actorId: device.pc_id,
            action: "SUPERADMIN_SESSION_EXTENDED",
            source: "offline",
            pcId: device.pc_id,
            entityType: "session",
            entityId: activeSession.id,
            metadata: { event_id: evt.event_id, minutes },
          });
          publishToCafe(device.cafe_id, {
            event: "session.updated",
            pc_id: device.pc_id,
            data: {
              session_id: activeSession.id,
              pc_id: device.pc_id,
              expires_at: newExpires.toISOString(),
              status: updated[0]?.status ?? "active",
            },
          });
        } else if (decision.action === "accept_end" && activeSession) {
          const endedAt = occurredAt.getTime() > now.getTime() ? now : occurredAt;
          const nextStatus = evt.type === "SESSION_CANCELLED" ? "cancelled" : "ended";
          await tx
            .update(sessions)
            .set({ status: nextStatus, endedAt })
            .where(eq(sessions.id, activeSession.id));
          appliedSessionId = activeSession.id;
          await tx.insert(sessionEvents).values({
            id: uuidv7(),
            sessionId: activeSession.id,
            type: nextStatus === "cancelled" ? "cancelled" : "ended",
            actorType: "pc",
            actorId: device.pc_id,
            occurredAt: endedAt,
            payload: { offline: true },
          });
          await writeAudit(tx, {
            cafeId: device.cafe_id,
            actorType: "pc",
            actorId: device.pc_id,
            action:
              nextStatus === "cancelled" ? "SUPERADMIN_SESSION_CANCELLED" : "SUPERADMIN_SESSION_ENDED",
            source: "offline",
            pcId: device.pc_id,
            entityType: "session",
            entityId: activeSession.id,
            metadata: { event_id: evt.event_id },
          });
          publishToCafe(device.cafe_id, {
            event: "session.updated",
            pc_id: device.pc_id,
            data: {
              session_id: activeSession.id,
              pc_id: device.pc_id,
              expires_at: endedAt.toISOString(),
              status: nextStatus,
            },
          });
        } else if (decision.action === "conflict") {
          await writeAudit(tx, {
            cafeId: device.cafe_id,
            actorType: "system",
            actorId: "sync",
            action: "SUPERADMIN_CONFLICT",
            source: "offline",
            pcId: device.pc_id,
            entityType: "offline_event",
            entityId: evt.event_id,
            metadata: { reason: decision.reason, seq: evt.seq },
          });
          publishToCafe(device.cafe_id, {
            event: "sync.conflict",
            data: { event_id: evt.event_id, pc_id: device.pc_id, reason: decision.reason ?? "" },
          });
        }

        await tx
          .update(offlineEvents)
          .set({
            state,
            conflictReason: decision.reason ?? null,
            appliedSessionId,
            receivedBatchId: batchId,
          })
          .where(eq(offlineEvents.id, evt.event_id));

        const base: SyncEventResult = {
          event_id: evt.event_id,
          seq: evt.seq,
          state,
        };
        if (decision.reason) base.reason = decision.reason;
        if (appliedSessionId) base.session_id = appliedSessionId;
        return base;
      });
      // NOTE: real failures must propagate (HTTP 500) so the agent retries the
      // batch — silently acking as "duplicate" would lose offline events.

      results.push(result);
    }

    results.sort((a, b) => a.seq - b.seq);
    let ackSeq = input.last_server_seq;
    for (const r of results) {
      if (r.seq !== ackSeq + 1) break;
      if (r.state === "accepted" || r.state === "duplicate") {
        ackSeq = r.seq;
      } else {
        break;
      }
    }

    const response: SyncBatchResponse = { results, ack_seq: ackSeq };
    return response;
  });

  app.get(
    "/sync/conflicts",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const query = parseQuery(
        z.object({ state: z.string().optional() }),
        req.query,
      );
      const stateFilter = query.state ?? "conflicted";
      const rows = await db
        .select({ event: offlineEvents, pc_name: pcs.name })
        .from(offlineEvents)
        .innerJoin(pcs, eq(pcs.id, offlineEvents.pcId))
        .where(
          and(
            eq(offlineEvents.cafeId, user.cafe_id),
            eq(
              offlineEvents.state,
              stateFilter as "accepted" | "duplicate" | "conflicted",
            ),
          ),
        )
        .orderBy(desc(offlineEvents.receivedAt))
        .limit(200);
      return {
        conflicts: rows.map((r) => ({
          ...r.event,
          pc_name: r.pc_name,
        })),
      };
    },
  );

  app.post(
    "/sync/conflicts/:id/resolve",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const id = (req.params as { id: string }).id;
      const input = parseBody(
        z.object({ resolution: z.enum(["accept_server", "accept_offline", "manual"]) }),
        req.body,
      );

      const rows = await db
        .select()
        .from(offlineEvents)
        .where(and(eq(offlineEvents.id, id), eq(offlineEvents.cafeId, user.cafe_id)))
        .limit(1);
      const event = rows[0];
      if (!event) throw problem(404, "Not Found", "EVENT_NOT_FOUND");
      if (event.state !== "conflicted") throw problem(409, "Conflict", "NOT_CONFLICTED");

      if (input.resolution === "accept_server") {
        await db
          .update(offlineEvents)
          .set({ state: "duplicate" })
          .where(eq(offlineEvents.id, id));
      } else if (input.resolution === "manual") {
        await db.update(offlineEvents).set({ state: "accepted" }).where(eq(offlineEvents.id, id));
      } else {
        const activeRows = await db
          .select()
          .from(sessions)
          .where(and(eq(sessions.pcId, event.pcId), eq(sessions.status, "active")))
          .limit(1);
        const activeSession = activeRows[0] ?? null;
        const decision = resolveOfflineEvent(
          activeSession ? { id: activeSession.id, status: activeSession.status } : null,
          {
            event_id: event.id,
            seq: Number(event.seq),
            type: event.type as
              | "SESSION_STARTED"
              | "SESSION_EXTENDED"
              | "SESSION_ENDED"
              | "SESSION_CANCELLED"
              | "CUSTOMER_ASSIGNED"
              | "ORDER_CREATED"
              | "SUPERADMIN_ENTERED"
              | "SUPERADMIN_LOGIN_FAILED"
              | "TAMPER_SUSPECTED",
            occurred_at: event.occurredAt.toISOString(),
            payload: asRecord(event.payload),
          },
        );
        if (decision.action === "accept_extend" && activeSession && event.type === "SESSION_EXTENDED") {
          const payload = asRecord(event.payload);
          const minutes = Number(payload.minutes ?? 0);
          await db
            .update(sessions)
            .set({
              expiresAt: new Date(activeSession.expiresAt.getTime() + minutes * 60_000),
              extendedMinutes: activeSession.extendedMinutes + minutes,
            })
            .where(eq(sessions.id, activeSession.id));
        }
        await db
          .update(offlineEvents)
          .set({ state: "accepted", conflictReason: null })
          .where(eq(offlineEvents.id, id));
      }

      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "SUPERADMIN_CONFLICT_RESOLVED",
        source: "online",
        pcId: event.pcId,
        entityType: "offline_event",
        entityId: id,
        metadata: { resolution: input.resolution },
      });

      return { ok: true, resolution: input.resolution };
    },
  );

  app.get("/sync/batches", { preHandler: requireUser(["owner", "manager"]) }, async (req) => {
    const user = req.user!;
    const rows = await db
      .select({ batch: reconciliationBatches, pc_name: pcs.name })
      .from(reconciliationBatches)
      .innerJoin(pcs, eq(pcs.id, reconciliationBatches.pcId))
      .where(eq(reconciliationBatches.pcId, pcs.id))
      .orderBy(asc(reconciliationBatches.receivedAt))
      .limit(100);
    void user;
    return { batches: rows.map((r) => ({ ...r.batch, pc_name: r.pc_name })) };
  });
}
