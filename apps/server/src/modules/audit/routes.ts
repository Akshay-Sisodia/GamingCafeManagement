import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { auditLogs } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/audit-logs", { preHandler: requireUser(["owner", "manager"]) }, async (req) => {
    const user = req.user!;
    const query = req.query as {
      action?: string;
      from?: string;
      to?: string;
      actor_id?: string;
      limit?: string;
    };
    const limit = Math.min(Number.parseInt(query.limit ?? "100", 10) || 100, 500);

    const conditions = [eq(auditLogs.cafeId, user.cafe_id)];
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.actor_id) conditions.push(eq(auditLogs.actorId, query.actor_id));
    if (query.from) conditions.push(gte(auditLogs.occurredAt, new Date(`${query.from}T00:00:00.000Z`)));
    if (query.to) conditions.push(lte(auditLogs.occurredAt, new Date(`${query.to}T23:59:59.999Z`)));

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.id))
      .limit(limit);

    // Frontend contract (AuditLogDto[]): bare array.
    return rows.map((r) => ({
      id: r.id,
      at: r.occurredAt?.toISOString() ?? null,
      actor_type: r.actorType,
      actor_name: r.actorRole ? `${r.actorId} (${r.actorRole})` : r.actorId,
      action: r.action,
      target: r.entityType
        ? `${r.entityType}${r.entityId ? `:${r.entityId.slice(0, 8)}` : ""}`
        : null,
      detail: r.metadata ? JSON.stringify(r.metadata) : null,
    }));
  });
}
