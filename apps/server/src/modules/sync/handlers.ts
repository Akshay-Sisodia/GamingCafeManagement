import { and, asc, desc, eq } from "drizzle-orm";
import {
  syncBatchSchema,
  type SyncBatchResponse,
  type SyncEventResult,
} from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import {
  offlineEvents,
  pcs,
  pricingRules,
  reconciliationBatches,
  sessions,
} from "../../db/schema.js";
import { parseBody, parseQuery, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { type PricingRuleInput } from "../sessions/pricing.js";
import {
  applyOfflineDecision,
  finalizeOfflineEvent,
  loadActiveSession,
  recordOfflineEvent,
} from "./apply.js";
import { resolveOfflineEvent } from "./conflicts.js";
import type { SyncContext, SyncEvent } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

async function processSyncEvent(
  evt: SyncEvent,
  ctx: SyncContext,
): Promise<SyncEventResult> {
  return db.transaction(async (tx): Promise<SyncEventResult> => {
    const duplicate = await recordOfflineEvent(tx, evt, ctx);
    if (duplicate) return duplicate;

    const occurredAt = new Date(evt.occurred_at);
    const now = new Date();
    const activeSession = await loadActiveSession(tx, ctx.pcId);
    const decision = resolveOfflineEvent(
      activeSession ? { id: activeSession.id, status: activeSession.status } : null,
      evt,
    );
    const { state, sessionId } = await applyOfflineDecision(
      tx,
      evt,
      ctx,
      activeSession,
      occurredAt,
      now,
      decision,
    );
    return finalizeOfflineEvent(tx, evt, ctx, state, decision, sessionId);
  });
}

export async function handleSyncEvents(req: FastifyRequest): Promise<SyncBatchResponse> {
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

  const [pcRows, ruleRows] = await Promise.all([
    db.select().from(pcs).where(eq(pcs.id, device.pc_id)).limit(1),
    db
      .select()
      .from(pricingRules)
      .where(and(eq(pricingRules.cafeId, device.cafe_id), eq(pricingRules.active, true)))
      .limit(200),
  ]);
  const pc = pcRows[0];
  if (!pc) throw problem(404, "Not Found", "PC_NOT_FOUND");

  const pricingRuleInputs: PricingRuleInput[] = ruleRows.map((r) => ({
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

  const ctx: SyncContext = {
    cafeId: device.cafe_id,
    pcId: device.pc_id,
    batchId,
    pc,
    pricingRules: pricingRuleInputs,
  };

  const results: SyncEventResult[] = [];
  await events.reduce(async (prev, evt) => {
    await prev;
    const result = await processSyncEvent(evt, ctx);
    results.push(result);
  }, Promise.resolve());

  results.sort((a, b) => a.seq - b.seq);
  let ackSeq = input.last_server_seq;
  results.every((r) => {
    if (r.seq !== ackSeq + 1) return false;
    if (r.state === "accepted" || r.state === "duplicate") {
      ackSeq = r.seq;
      return true;
    }
    return false;
  });

  return { results, ack_seq: ackSeq };
}

export async function handleSyncConflicts(req: FastifyRequest) {
  const user = req.user!;
  const query = parseQuery(z.object({ state: z.string().optional() }), req.query);
  const stateFilter = query.state ?? "conflicted";
  const rows = await db
    .select({ event: offlineEvents, pc_name: pcs.name })
    .from(offlineEvents)
    .innerJoin(pcs, eq(pcs.id, offlineEvents.pcId))
    .where(
      and(
        eq(offlineEvents.cafeId, user.cafe_id),
        eq(offlineEvents.state, stateFilter as "accepted" | "duplicate" | "conflicted"),
      ),
    )
    .orderBy(desc(offlineEvents.receivedAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.event.id,
    event_id: r.event.id,
    pc_id: r.event.pcId,
    pc_name: r.pc_name,
    event_type: r.event.type,
    reason: r.event.conflictReason ?? "",
    state: r.event.state,
    occurred_at: r.event.occurredAt?.toISOString() ?? null,
  }));
}

export async function handleResolveSyncConflict(req: FastifyRequest) {
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
    await db.update(offlineEvents).set({ state: "duplicate" }).where(eq(offlineEvents.id, id));
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
}

export async function handleSyncBatches(req: FastifyRequest) {
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
}
