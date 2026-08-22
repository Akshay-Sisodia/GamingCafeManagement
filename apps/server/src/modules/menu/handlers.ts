import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { menuCategories, menuItems } from "../../db/schema.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";

export interface MenuCategoryDto {
  id: string;
  name: string;
  available: boolean;
  items: Array<{
    id: string;
    name: string;
    price_amount: number;
    currency: string;
    available: boolean;
    prep_minutes: number;
  }>;
}

export async function getMenuForCafe(cafeId: string): Promise<MenuCategoryDto[]> {
  const categories = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.cafeId, cafeId))
    .orderBy(asc(menuCategories.displayOrder), asc(menuCategories.name))
    .limit(100);
  const items = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.cafeId, cafeId), isNull(menuItems.deletedAt)))
    .orderBy(asc(menuItems.name))
    .limit(500);

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    available: c.available,
    items: items
      .filter((i) => i.categoryId === c.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        price_amount: i.basePrice,
        currency: i.currency,
        available: i.available,
        prep_minutes: i.prepMinutes,
      })),
  }));
}

export async function handleGetMenu(req: FastifyRequest) {
  return getMenuForCafe(req.user!.cafe_id);
}

/** Kiosk menu — available categories and items only, flat list for launcher. */
export async function handleAgentGetMenu(req: FastifyRequest) {
  const categories = await getMenuForCafe(req.device!.cafe_id);
  const items = categories
    .filter((c) => c.available)
    .flatMap((c) =>
      c.items
        .filter((i) => i.available)
        .map((i) => ({
          id: i.id,
          name: i.name,
          price_amount: i.price_amount,
          category: c.name,
        })),
    );
  return { items };
}

export async function handleCreateMenuCategory(req: FastifyRequest) {
  const user = req.user!;
  const input = parseBody(
    z.object({
      name: z.string().min(1).max(80),
      display_order: z.number().int().min(0).optional(),
      available: z.boolean().optional(),
    }),
    req.body,
  );
  const inserted = await db
    .insert(menuCategories)
    .values({
      cafeId: user.cafe_id,
      name: input.name,
      displayOrder: input.display_order ?? 0,
      available: input.available ?? true,
    })
    .returning();
  const category = inserted[0]!;
  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "MENU_CATEGORY_CREATED",
    source: "online",
    entityType: "menu_category",
    entityId: category.id,
    metadata: { name: category.name },
  });
  return { category };
}

export async function handleCreateMenuItem(req: FastifyRequest) {
  const user = req.user!;
  const input = parseBody(
    z.object({
      category_id: z.string().uuid(),
      name: z.string().min(1).max(120),
      description: z.string().max(500).nullable().optional(),
      price_amount: z.number().int().positive(),
      prep_minutes: z.number().int().min(0).max(240).optional(),
      available: z.boolean().optional(),
    }),
    req.body,
  );

  const catRows = await db
    .select({ id: menuCategories.id })
    .from(menuCategories)
    .where(
      and(
        eq(menuCategories.id, input.category_id),
        eq(menuCategories.cafeId, user.cafe_id),
      ),
    )
    .limit(1);
  if (!catRows[0]) throw problem(404, "Not Found", "MENU_CATEGORY_NOT_FOUND");

  const inserted = await db
    .insert(menuItems)
    .values({
      cafeId: user.cafe_id,
      categoryId: input.category_id,
      name: input.name,
      description: input.description ?? null,
      basePrice: input.price_amount,
      currency: "INR",
      prepMinutes: input.prep_minutes ?? 10,
      available: input.available ?? true,
    })
    .returning();
  const item = inserted[0]!;
  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "MENU_ITEM_CREATED",
    source: "online",
    entityType: "menu_item",
    entityId: item.id,
    metadata: { name: item.name, price_amount: item.basePrice },
  });
  return { item };
}

export async function handlePatchMenuItem(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const input = parseBody(
    z.object({
      name: z.string().min(1).max(120).optional(),
      price_amount: z.number().int().positive().optional(),
      prep_minutes: z.number().int().min(0).max(240).optional(),
      available: z.boolean().optional(),
    }),
    req.body,
  );

  const updated = await db
    .update(menuItems)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.price_amount !== undefined ? { basePrice: input.price_amount } : {}),
      ...(input.prep_minutes !== undefined ? { prepMinutes: input.prep_minutes } : {}),
      ...(input.available !== undefined ? { available: input.available } : {}),
    })
    .where(
      and(
        eq(menuItems.id, id),
        eq(menuItems.cafeId, user.cafe_id),
        isNull(menuItems.deletedAt),
      ),
    )
    .returning();
  const item = updated[0];
  if (!item) throw problem(404, "Not Found", "MENU_ITEM_NOT_FOUND");

  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "MENU_ITEM_UPDATED",
    source: "online",
    entityType: "menu_item",
    entityId: item.id,
    metadata: input as Record<string, unknown>,
  });
  return { item };
}

export async function handleDeleteMenuItem(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const updated = await db
    .update(menuItems)
    .set({ deletedAt: new Date(), available: false })
    .where(
      and(
        eq(menuItems.id, id),
        eq(menuItems.cafeId, user.cafe_id),
        isNull(menuItems.deletedAt),
      ),
    )
    .returning();
  const item = updated[0];
  if (!item) throw problem(404, "Not Found", "MENU_ITEM_NOT_FOUND");

  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "MENU_ITEM_DELETED",
    source: "online",
    entityType: "menu_item",
    entityId: item.id,
  });
  return { ok: true };
}
