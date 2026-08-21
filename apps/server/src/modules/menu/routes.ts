import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { menuCategories, menuItems } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";

export async function registerMenuRoutes(app: FastifyInstance): Promise<void> {
  app.get("/menu", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const categories = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.cafeId, user.cafe_id))
      .orderBy(asc(menuCategories.displayOrder), asc(menuCategories.name));
    const items = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.cafeId, user.cafe_id), isNull(menuItems.deletedAt)))
      .orderBy(asc(menuItems.name));

    // Frontend contract (MenuCategoryDto[]): bare array.
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
  });

  app.post(
    "/menu/categories",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
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
    },
  );

  app.post(
    "/menu/items",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
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
    },
  );

  app.patch(
    "/menu/items/:id",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
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
    },
  );

  app.delete(
    "/menu/items/:id",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
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
    },
  );
}
