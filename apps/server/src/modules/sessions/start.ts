import { and, eq, inArray } from "drizzle-orm";
import { startSessionSchema, uuidv7 } from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db, type DbOrTx } from "../../db/index.js";
import { pcs, sessionEvents, sessions } from "../../db/schema.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { loadPricingRules, publishSession, toSessionDto } from "./shared.js";
import { computePrice } from "./pricing.js";

type StartInput = z.input<typeof startSessionSchema>;
type SessionRow = typeof sessions.$inferSelect;
type PcRow = typeof pcs.$inferSelect;
type AuthUser = NonNullable<FastifyRequest["user"]>;

function idempotentStartResponse(session: SessionRow) {
  return { session: toSessionDto(session), server_time_ms: Date.now(), existing: true };
}

async function findIdempotentSession(tx: DbOrTx, idempotencyKey: string): Promise<SessionRow | null> {
  const existing = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.idempotencyKey, idempotencyKey))
    .limit(1);
  return existing[0] ?? null;
}

async function validatePcForStart(tx: DbOrTx, pcId: string, cafeId: string): Promise<PcRow> {
  const pcRows = await tx
    .select()
    .from(pcs)
    .where(and(eq(pcs.id, pcId), eq(pcs.cafeId, cafeId)))
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
  return pc;
}

async function insertSessionRecord(
  tx: DbOrTx,
  args: {
    user: AuthUser;
    input: StartInput;
    pc: PcRow;
    now: Date;
    expires: Date;
    price: { amount: number; breakdown: unknown[] };
  },
): Promise<{ session: SessionRow; existing: boolean }> {
  const { user, input, pc, now, expires, price } = args;
  const baseValues = {
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
    status: "active" as const,
    origin: input.origin ?? "admin",
    createdBy: user.sub,
  };

  if (input.idempotency_key) {
    const inserted = await tx
      .insert(sessions)
      .values({ ...baseValues, idempotencyKey: input.idempotency_key })
      .onConflictDoNothing({ target: sessions.idempotencyKey })
      .returning();
    if (inserted[0]) return { session: inserted[0], existing: false };
    const again = await findIdempotentSession(tx, input.idempotency_key);
    if (!again) throw problem(500, "Internal Server Error", "IDEMPOTENCY_FAILED");
    return { session: again, existing: true };
  }

  const inserted = await tx.insert(sessions).values(baseValues).returning();
  return { session: inserted[0]!, existing: false };
}

async function recordSessionStart(
  tx: DbOrTx,
  args: {
    user: AuthUser;
    session: SessionRow;
    pc: PcRow;
    input: StartInput;
    price: { amount: number };
  },
): Promise<void> {
  const { user, session, pc, input, price } = args;
  await tx.insert(sessionEvents).values({
    id: uuidv7(),
    sessionId: session.id,
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
    entityId: session.id,
    metadata: { planned_minutes: input.planned_minutes, price_amount: price.amount },
  });
}

export async function handleStartSession(req: FastifyRequest) {
  const user = req.user!;
  const input = parseBody(startSessionSchema, req.body);

  return db.transaction(async (tx) => {
    if (input.idempotency_key) {
      const found = await findIdempotentSession(tx, input.idempotency_key);
      if (found) return idempotentStartResponse(found);
    }

    const pc = await validatePcForStart(tx, input.pc_id, user.cafe_id);
    const now = new Date();
    const rules = await loadPricingRules(user.cafe_id);
    const price = computePrice(rules, now, input.planned_minutes, pc.tierId);
    const expires = new Date(now.getTime() + input.planned_minutes * 60_000);
    const { session, existing } = await insertSessionRecord(tx, {
      user,
      input,
      pc,
      now,
      expires,
      price,
    });
    if (existing) return idempotentStartResponse(session);

    await recordSessionStart(tx, { user, session, pc, input, price });
    const dto = toSessionDto(session);
    publishSession(user.cafe_id, pc.id, dto, "session.started");
    return { session: dto, server_time_ms: Date.now(), warnings: [600, 300, 60], existing: false };
  });
}
