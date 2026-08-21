import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { orders, payments, paymentTransactions, sessions } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";

export async function registerPaymentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/payments", { preHandler: requireUser(["owner", "manager", "staff"]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(
      z.object({
        session_id: z.string().uuid().nullable().optional(),
        order_id: z.string().uuid().nullable().optional(),
        method: z.enum(["cash", "upi", "card", "online", "wallet"]),
        amount: z.number().int().positive(),
        external_ref: z.string().max(120).nullable().optional(),
        idempotency_key: z.string().min(8).max(120),
      }),
      req.body,
    );

    if (input.session_id) {
      const rows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, input.session_id), eq(sessions.cafeId, user.cafe_id)))
        .limit(1);
      if (!rows[0]) throw problem(404, "Not Found", "SESSION_NOT_FOUND");
    }
    if (input.order_id) {
      const rows = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, input.order_id), eq(orders.cafeId, user.cafe_id)))
        .limit(1);
      if (!rows[0]) throw problem(404, "Not Found", "ORDER_NOT_FOUND");
    }

    // Idempotent insert: replaying the same key returns the original payment.
    const inserted = await db
      .insert(payments)
      .values({
        cafeId: user.cafe_id,
        sessionId: input.session_id ?? null,
        orderId: input.order_id ?? null,
        method: input.method,
        amount: input.amount,
        currency: "INR",
        status: "success",
        externalRef: input.external_ref ?? null,
        idempotencyKey: input.idempotency_key,
      })
      .onConflictDoNothing({ target: payments.idempotencyKey })
      .returning();

    const existing = inserted[0];
    if (!existing) {
      const prior = await db
        .select()
        .from(payments)
        .where(
          and(eq(payments.idempotencyKey, input.idempotency_key), eq(payments.cafeId, user.cafe_id)),
        )
        .limit(1);
      return { payment: prior[0]!, duplicate: true };
    }

    await db.insert(paymentTransactions).values({
      paymentId: existing.id,
      type: "charge",
      amount: existing.amount,
      actorId: user.sub,
      note: `method=${existing.method}`,
    });

    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "PAYMENT_CREATED",
      source: "online",
      entityType: "payment",
      entityId: existing.id,
      metadata: { amount: existing.amount, method: existing.method },
    });

    return { payment: existing, duplicate: false };
  });

  app.get("/payments", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const query = req.query as { limit?: string };
    const limit = Math.min(Number.parseInt(query.limit ?? "50", 10) || 50, 200);
    const rows = await db
      .select()
      .from(payments)
      .where(eq(payments.cafeId, user.cafe_id))
      .orderBy(desc(payments.createdAt))
      .limit(limit);
    return { payments: rows };
  });
}
