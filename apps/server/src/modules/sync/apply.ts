import { uuidv7 } from "@gaming-cafe/shared";
import type { SyncEventResult } from "@gaming-cafe/shared";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { offlineEvents, sessionEvents, sessions } from "../../db/schema.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { computePrice, type PricingRuleInput } from "../sessions/pricing.js";
import { resolveOfflineEvent } from "./conflicts.js";
import type { SyncContext, SyncEvent, SyncTx } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

type ActiveSession = InferSelectModel<typeof sessions>;

async function applyAcceptStart(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  occurredAt: Date,
  now: Date,
): Promise<string> {
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
  const price = computePrice(ctx.pricingRules, occurredAt, plannedMinutes, ctx.pc.tierId);

  const insertedSession = await tx
    .insert(sessions)
    .values({
      id: uuidv7(),
      cafeId: ctx.cafeId,
      pcId: ctx.pcId,
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

  await tx.insert(sessionEvents).values({
    id: uuidv7(),
    sessionId: session.id,
    type: "started",
    actorType: "pc",
    actorId: ctx.pcId,
    occurredAt,
    payload: { planned_minutes: plannedMinutes, offline: true },
  });
  await writeAudit(tx, {
    cafeId: ctx.cafeId,
    actorType: "pc",
    actorId: ctx.pcId,
    action: "SUPERADMIN_SESSION_STARTED",
    source: "offline",
    pcId: ctx.pcId,
    entityType: "session",
    entityId: session.id,
    metadata: { event_id: evt.event_id, seq: evt.seq },
  });
  publishToCafe(ctx.cafeId, {
    event: "session.updated",
    pc_id: ctx.pcId,
    data: {
      session_id: session.id,
      pc_id: ctx.pcId,
      expires_at: expiresAt.toISOString(),
      status,
    },
  });
  return session.id;
}

async function applyAcceptExtend(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  activeSession: ActiveSession,
  occurredAt: Date,
): Promise<string> {
  const payload = asRecord(evt.payload);
  const minutes = Math.max(
    5,
    Math.min(
      24 * 60,
      Number.parseInt(String(payload.minutes ?? payload.planned_minutes ?? "0"), 10) || 0,
    ),
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

  await tx.insert(sessionEvents).values({
    id: uuidv7(),
    sessionId: activeSession.id,
    type: "extended",
    actorType: "pc",
    actorId: ctx.pcId,
    occurredAt,
    payload: { minutes, offline: true },
  });
  await writeAudit(tx, {
    cafeId: ctx.cafeId,
    actorType: "pc",
    actorId: ctx.pcId,
    action: "SUPERADMIN_SESSION_EXTENDED",
    source: "offline",
    pcId: ctx.pcId,
    entityType: "session",
    entityId: activeSession.id,
    metadata: { event_id: evt.event_id, minutes },
  });
  publishToCafe(ctx.cafeId, {
    event: "session.updated",
    pc_id: ctx.pcId,
    data: {
      session_id: activeSession.id,
      pc_id: ctx.pcId,
      expires_at: newExpires.toISOString(),
      status: updated[0]?.status ?? "active",
    },
  });
  return activeSession.id;
}

async function applyAcceptEnd(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  activeSession: ActiveSession,
  occurredAt: Date,
  now: Date,
): Promise<string> {
  const endedAt = occurredAt.getTime() > now.getTime() ? now : occurredAt;
  const nextStatus = evt.type === "SESSION_CANCELLED" ? "cancelled" : "ended";
  await tx
    .update(sessions)
    .set({ status: nextStatus, endedAt })
    .where(eq(sessions.id, activeSession.id));

  await tx.insert(sessionEvents).values({
    id: uuidv7(),
    sessionId: activeSession.id,
    type: nextStatus === "cancelled" ? "cancelled" : "ended",
    actorType: "pc",
    actorId: ctx.pcId,
    occurredAt: endedAt,
    payload: { offline: true },
  });
  await writeAudit(tx, {
    cafeId: ctx.cafeId,
    actorType: "pc",
    actorId: ctx.pcId,
    action:
      nextStatus === "cancelled" ? "SUPERADMIN_SESSION_CANCELLED" : "SUPERADMIN_SESSION_ENDED",
    source: "offline",
    pcId: ctx.pcId,
    entityType: "session",
    entityId: activeSession.id,
    metadata: { event_id: evt.event_id },
  });
  publishToCafe(ctx.cafeId, {
    event: "session.updated",
    pc_id: ctx.pcId,
    data: {
      session_id: activeSession.id,
      pc_id: ctx.pcId,
      expires_at: endedAt.toISOString(),
      status: nextStatus,
    },
  });
  return activeSession.id;
}

async function applyConflict(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  reason: string | undefined,
): Promise<void> {
  await writeAudit(tx, {
    cafeId: ctx.cafeId,
    actorType: "system",
    actorId: "sync",
    action: "SUPERADMIN_CONFLICT",
    source: "offline",
    pcId: ctx.pcId,
    entityType: "offline_event",
    entityId: evt.event_id,
    metadata: { reason, seq: evt.seq },
  });
  publishToCafe(ctx.cafeId, {
    event: "sync.conflict",
    data: { event_id: evt.event_id, pc_id: ctx.pcId, reason: reason ?? "" },
  });
}

export async function applyOfflineDecision(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  activeSession: ActiveSession | null,
  occurredAt: Date,
  now: Date,
  decision: ReturnType<typeof resolveOfflineEvent>,
): Promise<{ state: "accepted" | "conflicted" | "duplicate"; sessionId: string | null }> {
  let state: "accepted" | "conflicted" | "duplicate" =
    decision.action === "conflict"
      ? "conflicted"
      : decision.action === "duplicate"
        ? "duplicate"
        : "accepted";
  let sessionId: string | null = null;

  if (decision.action === "accept_start") {
    sessionId = await applyAcceptStart(tx, evt, ctx, occurredAt, now);
  } else if (decision.action === "accept_extend" && activeSession) {
    sessionId = await applyAcceptExtend(tx, evt, ctx, activeSession, occurredAt);
  } else if (decision.action === "accept_end" && activeSession) {
    sessionId = await applyAcceptEnd(tx, evt, ctx, activeSession, occurredAt, now);
  } else if (decision.action === "conflict") {
    await applyConflict(tx, evt, ctx, decision.reason);
  }

  return { state, sessionId };
}

export async function loadActiveSession(tx: SyncTx, pcId: string): Promise<ActiveSession | null> {
  const activeRows = await tx
    .select()
    .from(sessions)
    .where(and(eq(sessions.pcId, pcId), eq(sessions.status, "active")))
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return activeRows[0] ?? null;
}

export async function recordOfflineEvent(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
): Promise<SyncEventResult | null> {
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
    .where(and(eq(offlineEvents.pcId, ctx.pcId), eq(offlineEvents.seq, evt.seq)))
    .limit(1);
  if (seqClash[0]) {
    return { event_id: evt.event_id, seq: evt.seq, state: "duplicate" };
  }

  const insertedEvent = await tx
    .insert(offlineEvents)
    .values({
      id: evt.event_id,
      cafeId: ctx.cafeId,
      pcId: ctx.pcId,
      seq: evt.seq,
      type: evt.type,
      occurredAt: new Date(evt.occurred_at),
      payload: evt.payload as Record<string, unknown>,
      state: "accepted",
    })
    .onConflictDoNothing({ target: offlineEvents.id })
    .returning();
  if (!insertedEvent[0]) {
    return { event_id: evt.event_id, seq: evt.seq, state: "duplicate" };
  }
  return null;
}

export async function finalizeOfflineEvent(
  tx: SyncTx,
  evt: SyncEvent,
  ctx: SyncContext,
  state: "accepted" | "conflicted" | "duplicate",
  decision: ReturnType<typeof resolveOfflineEvent>,
  sessionId: string | null,
): Promise<SyncEventResult> {
  await tx
    .update(offlineEvents)
    .set({
      state,
      conflictReason: decision.reason ?? null,
      appliedSessionId: sessionId,
      receivedBatchId: ctx.batchId,
    })
    .where(eq(offlineEvents.id, evt.event_id));

  const base: SyncEventResult = { event_id: evt.event_id, seq: evt.seq, state };
  if (decision.reason) base.reason = decision.reason;
  if (sessionId) base.session_id = sessionId;
  return base;
}
