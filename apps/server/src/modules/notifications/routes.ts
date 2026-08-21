import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { problem } from "../../lib/problem.js";

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const query = req.query as { unread?: string; limit?: string };
    const limit = Math.min(Number.parseInt(query.limit ?? "50", 10) || 50, 200);

    const conditions = [eq(notifications.cafeId, user.cafe_id)];
    if (query.unread === "1" || query.unread === "true") {
      conditions.push(isNull(notifications.readAt));
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return { notifications: rows };
  });

  app.post("/notifications/:id/read", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.cafeId, user.cafe_id)))
      .returning();
    if (!updated[0]) throw problem(404, "Not Found", "NOTIFICATION_NOT_FOUND");
    return { ok: true };
  });
}
