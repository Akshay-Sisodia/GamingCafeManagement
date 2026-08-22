import { and, desc, eq, inArray } from "drizzle-orm";
import { createOrderSchema, type OrderDto, type OrderStatus, type CreateOrderInput } from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { orders, pcs, sessions } from "../../db/schema.js";
import { parseBody, parseQuery, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { createOrderInTx } from "./create.js";
import { loadOrderItemsMap, toOrderDto, transitionOrder } from "./service.js";

const ORDER_ROLES = ["owner", "manager", "staff", "kitchen"] as const;

export async function handleCreateOrder(req: FastifyRequest) {
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
}

const deviceOrderBodySchema = z.object({
  items: createOrderSchema.shape.items,
  session_id: z.string().uuid().nullable().optional(),
});

export async function handleCreateOrderFromDevice(req: FastifyRequest) {
  const device = req.device!;
  const body = parseBody(deviceOrderBodySchema, req.body);
  const input: CreateOrderInput = {
    source: "launcher",
    pc_id: device.pc_id,
    session_id: body.session_id ?? null,
    items: body.items,
  };

  const { order, items } = await db.transaction((tx) =>
    createOrderInTx(tx, {
      cafeId: device.cafe_id,
      input,
      actor: { type: "pc", id: device.pc_id },
    }),
  );

  await writeAudit(db, {
    cafeId: device.cafe_id,
    actorType: "pc",
    actorId: device.pc_id,
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

  publishToCafe(device.cafe_id, {
    event: "order.updated",
    data: {
      order_id: order.id,
      order_number: order.number,
      pc_id: order.pcId,
      status: order.status,
      at: new Date().toISOString(),
    },
  });

  return { order_number: order.number, order: toOrderDto(order, items) };
}

export async function handleOrderTransition(
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

export async function handleListOrders(req: FastifyRequest) {
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
  return rows.map((r) => toOrderDto(r, itemsMap.get(r.id) ?? []));
}
