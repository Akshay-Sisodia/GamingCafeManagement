import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CreateOrderInput } from "@gaming-cafe/shared";
import type { DbOrTx } from "../../db/index.js";
import { rowsOf } from "../../db/rows.js";
import { menuItems, menuVariants, orderItems, orderStatusHistory, orders } from "../../db/schema.js";
import { problem } from "../../lib/problem.js";
import type { OrderActor } from "./service.js";

type MenuItemRow = typeof menuItems.$inferSelect;
type VariantRow = typeof menuVariants.$inferSelect;

interface OrderLine {
  menuItemId: string;
  variantId: string | null;
  nameSnapshot: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

async function loadMenuItemsById(
  tx: DbOrTx,
  cafeId: string,
  itemIds: string[],
): Promise<Map<string, MenuItemRow>> {
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
  return new Map(itemRows.map((r) => [r.id, r]));
}

function validateOrderItems(
  input: CreateOrderInput,
  itemsById: Map<string, MenuItemRow>,
): void {
  input.items.map((line) => {
    const item = itemsById.get(line.menu_item_id);
    if (!item) {
      throw problem(400, "Bad Request", "MENU_ITEM_NOT_FOUND", `Unknown menu item ${line.menu_item_id}`);
    }
    if (!item.available) {
      throw problem(409, "Conflict", "ITEM_UNAVAILABLE", `${item.name} is currently unavailable`);
    }
  });
}

async function loadVariantsById(
  tx: DbOrTx,
  input: CreateOrderInput,
): Promise<Map<string, VariantRow>> {
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
  return new Map(variantRows.map((v) => [v.id, v]));
}

async function nextOrderNumber(tx: DbOrTx, cafeId: string): Promise<number> {
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext('order_seq:' || ${cafeId}::text || ':' || to_char(current_date, 'YYYY-MM-DD')))
  `);
  const numResult = await tx.execute(sql`
    select coalesce(max(number), 0) + 1 as next_number
    from ${orders}
    where ${orders.cafeId} = ${cafeId} and ${orders.placedAt}::date = current_date
  `);
  return Number(rowsOf<{ next_number: string | number }>(numResult)[0]?.next_number ?? 1);
}

function buildOrderLines(
  input: CreateOrderInput,
  itemsById: Map<string, MenuItemRow>,
  variantsById: Map<string, VariantRow>,
): OrderLine[] {
  return input.items.map((line) => {
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
  const itemsById = await loadMenuItemsById(tx, cafeId, itemIds);
  validateOrderItems(input, itemsById);
  const variantsById = await loadVariantsById(tx, input);
  const nextNumber = await nextOrderNumber(tx, cafeId);
  const lines = buildOrderLines(input, itemsById, variantsById);
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
