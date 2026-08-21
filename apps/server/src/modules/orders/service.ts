import { and, eq, inArray } from "drizzle-orm";
import { ORDER_TRANSITIONS, type OrderDto, type OrderStatus } from "@gaming-cafe/shared";
import { db } from "../../db/index.js";
import { orderItems, orderStatusHistory, orders } from "../../db/schema.js";
import { problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";

export function toOrderDto(
  order: typeof orders.$inferSelect,
  items: Array<typeof orderItems.$inferSelect>,
): OrderDto {
  return {
    id: order.id,
    number: order.number,
    pc_id: order.pcId,
    status: order.status,
    total_amount: order.totalAmount,
    currency: order.currency,
    placed_at: order.placedAt.toISOString(),
    items: items.map((i) => ({
      name_snapshot: i.nameSnapshot,
      qty: i.qty,
      unit_price: i.unitPrice,
      line_total: i.lineTotal,
    })),
  };
}

export async function loadOrderItemsMap(
  orderIds: string[],
): Promise<Map<string, Array<typeof orderItems.$inferSelect>>> {
  const map = new Map<string, Array<typeof orderItems.$inferSelect>>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));
  for (const row of rows) {
    const list = map.get(row.orderId) ?? [];
    list.push(row);
    map.set(row.orderId, list);
  }
  return map;
}

export interface OrderActor {
  type: "user" | "pc" | "system" | "customer";
  id: string;
}

export async function transitionOrder(args: {
  orderId: string;
  cafeId: string;
  to: OrderStatus;
  actor: OrderActor;
  reason?: string | null;
}): Promise<OrderDto> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, args.orderId), eq(orders.cafeId, args.cafeId)))
      .limit(1);
    const order = rows[0];
    if (!order) throw problem(404, "Not Found", "ORDER_NOT_FOUND");

    const allowed = ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(args.to)) {
      throw problem(
        409,
        "Conflict",
        "ORDER_INVALID_TRANSITION",
        `Cannot transition order #${order.number} from ${order.status} to ${args.to}`,
      );
    }

    const updated = await tx
      .update(orders)
      .set({
        status: args.to,
        ...(args.reason !== undefined ? { cancelledReason: args.reason } : {}),
      })
      .where(eq(orders.id, order.id))
      .returning();
    const next = updated[0]!;

    await tx.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: order.status,
      toStatus: args.to,
      actorType: args.actor.type,
      actorId: args.actor.id,
    });

    await writeAudit(tx, {
      cafeId: args.cafeId,
      actorType: args.actor.type,
      actorId: args.actor.id,
      action: `ORDER_${args.to.toUpperCase()}`,
      source: "online",
      entityType: "order",
      entityId: order.id,
      metadata: { from: order.status, to: args.to },
    });

    publishToCafe(args.cafeId, {
      event: "order.updated",
      data: {
        order_id: order.id,
        order_number: order.number,
        pc_id: order.pcId,
        status: args.to,
        at: new Date().toISOString(),
      },
    });

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    return toOrderDto(next, items);
  });
}
