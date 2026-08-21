import { and, desc, eq, inArray } from "drizzle-orm";
import { createOrderSchema, type OrderDto, type OrderStatus } from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { orders, pcs, sessions } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { parseBody, parseQuery, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { createOrderInTx, loadOrderItemsMap, toOrderDto, transitionOrder } from "./service.js";

const ORDER_ROLES = ["owner", "manager", "staff", "kitchen"] as const;

async function doTransition(
  req: FastifyRequest,
  to: OrderStatus,
): Promise<{ order: OrderDto }> {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  let reason: string | null = null;
  if (to === "cancelled") {
    const body = parseBody(z.object({ reason: z.string().max(300).optional() }), req.body);
    reason = body.reason ?? null;
  }
  const order = await transitionOrder({
    orderId: id,
    cafeId: user.cafe_id,
    to,
    actor: { type: "user", id: user.sub },
    reason,
  });
  return { order };
}

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/orders", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(createOrderSchema, req.body);

    if (input.pc_id) {
      const pcRows = await db
        .select({ id: pcs.id })
        .from(pcs)
        .where(and(eq(pcs.id, input.pc_id), eq(pcs.cafeId, user.cafe_id)))
        .limit(1);
      if (!pcRows[0]) throw problem(404, "Not Found", "PC_NOT_FOUND");
    }
    if (input.session_id) {
      const sessionRows = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, input.session_id), eq(sessions.cafeId, user.cafe_id)))
        .limit(1);
      if (!sessionRows[0]) throw problem(404, "Not Found", "SESSION_NOT_FOUND");
    }

    const { order, items } = await db.transaction((tx) =>
      createOrderInTx(tx, {
        cafeId: user.cafe_id,
        input,
        actor: { type: "user", id: user.sub },
      }),
    );

    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "ORDER_CREATED",
      source: "online",
      entityType: "order",
      entityId: order.id,
      metadata: {
        number: order.number,
        total_amount: order.totalAmount,
        item_count: items.length,
      },
    });

    publishToCafe(user.cafe_id, {
      event: "order.updated",
      data: {
        order_id: order.id,
        order_number: order.number,
        pc_id: order.pcId,
        status: order.status,
        at: new Date().toISOString(),
      },
    });

    return { order: toOrderDto(order, items) };
  });

  app.post("/orders/:id/accept", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "accepted"),
  );
  app.post("/orders/:id/prepare", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "preparing"),
  );
  app.post("/orders/:id/ready", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "ready"),
  );
  app.post("/orders/:id/deliver", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "delivered"),
  );
  app.post("/orders/:id/complete", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "completed"),
  );
  app.post("/orders/:id/cancel", { preHandler: requireUser([...ORDER_ROLES]) }, async (req) =>
    doTransition(req, "cancelled"),
  );

  app.get("/orders", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const query = parseQuery(z.object({ status: z.string().optional() }), req.query);

    const conditions = [eq(orders.cafeId, user.cafe_id)];
    if (query.status) {
      const statuses = query.status
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0) as OrderStatus[];
      if (statuses.length > 0) conditions.push(inArray(orders.status, statuses));
    }

    const rows = await db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.placedAt))
      .limit(100);
    const itemsMap = await loadOrderItemsMap(rows.map((r) => r.id));
    // Frontend contract (OrderDto[]): bare array.
    return rows.map((r) => toOrderDto(r, itemsMap.get(r.id) ?? []));
  });
}
