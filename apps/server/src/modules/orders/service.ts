import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  ORDER_TRANSITIONS,
  type CreateOrderInput,
  type OrderDto,
  type OrderStatus,
} from "@gaming-cafe/shared";
import type { DbOrTx } from "../../db/index.js";
import { db } from "../../db/index.js";
import { menuItems, menuVariants, orderItems, orderStatusHistory, orders } from "../../db/schema.js";
import { problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: T[] };
  return maybe.rows ?? [];
}

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

export async function createOrderInTx(
  tx: DbOrTx,
  args: {
    cafeId: string;
    input: CreateOrderInput;
    actor: OrderActor;
  },
): Promise<{ order: typeof orders.$inferSelect; items: Array<typeof orderItems.$inferSelect> }> {
  const { cafeId, input, actor } = args;

  const itemIds = [...new Set(input.items.map((l) => l.menu_item_id))];
  const itemRows = await tx
    .select()
    .from(menuItems)
    .where(
      and(
        eq(menuItems.cafeId, cafeId),
        inArray(menuItems.id, itemIds),
        isNull(menuItems.deletedAt),
      ),
    );
  const itemsById = new Map(itemRows.map((r) => [r.id, r]));
  for (const line of input.items) {
    const item = itemsById.get(line.menu_item_id);
    if (!item) {
      throw problem(400, "Bad Request", "MENU_ITEM_NOT_FOUND", `Unknown menu item ${line.menu_item_id}`);
    }
    if (!item.available) {
      throw problem(409, "Conflict", "ITEM_UNAVAILABLE", `${item.name} is currently unavailable`);
    }
  }

  const variantIds = [
    ...new Set(
      input.items
        .map((l) => l.variant_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const variantRows =
    variantIds.length > 0
      ? await tx.select().from(menuVariants).where(inArray(menuVariants.id, variantIds))
      : [];
  const variantsById = new Map(variantRows.map((v) => [v.id, v]));

  // Gap-free per-café daily sequence under a transaction-scoped advisory lock.
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext('order_seq:' || ${cafeId}::text || ':' || to_char(current_date, 'YYYY-MM-DD')))
  `);
  const numResult = await tx.execute(sql`
    select coalesce(max(number), 0) + 1 as next_number
    from ${orders}
    where ${orders.cafeId} = ${cafeId} and ${orders.placedAt}::date = current_date
  `);
  const nextNumber = Number(
    rowsOf<{ next_number: string | number }>(numResult)[0]?.next_number ?? 1,
  );

  const lines = input.items.map((line) => {
    const item = itemsById.get(line.menu_item_id)!;
    const variant = line.variant_id ? variantsById.get(line.variant_id) : undefined;
    const unitPrice = item.basePrice + (variant?.priceDelta ?? 0);
    return {
      menuItemId: item.id,
      variantId: line.variant_id ?? null,
      nameSnapshot: item.name,
      unitPrice,
      qty: line.qty,
      lineTotal: unitPrice * line.qty,
    };
  });
  const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const insertedOrder = await tx
    .insert(orders)
    .values({
      cafeId,
      pcId: input.pc_id ?? null,
      sessionId: input.session_id ?? null,
      customerId: null,
      number: nextNumber,
      status: "placed",
      totalAmount,
      currency: "INR",
      source: input.source,
    })
    .returning();
  const order = insertedOrder[0]!;

  const insertedItems = await tx
    .insert(orderItems)
    .values(lines.map((l) => ({ orderId: order.id, ...l })))
    .returning();

  await tx.insert(orderStatusHistory).values({
    orderId: order.id,
    fromStatus: null,
    toStatus: "placed",
    actorType: actor.type,
    actorId: actor.id,
  });

  return { order, items: insertedItems };
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
