import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { customers, sessions } from "../../db/schema.js";
import { requireUser } from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const query = req.query as { search?: string };
    const search = query.search?.trim();

    const where = search
      ? and(
          eq(customers.cafeId, user.cafe_id),
          or(
            ilike(customers.name, `%${search}%`),
            ilike(customers.email, `%${search}%`),
            ilike(customers.phone, `%${search}%`),
          ),
        )
      : eq(customers.cafeId, user.cafe_id);

    const rows = await db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(200);

    return {
      customers: rows.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        status: c.status,
        created_at: c.createdAt?.toISOString() ?? null,
      })),
    };
  });

  app.post("/customers", { preHandler: requireUser(["owner", "manager", "staff"]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(
      z.object({
        name: z.string().min(1).max(120),
        email: z.string().email().optional(),
        phone: z.string().min(5).max(20).optional(),
        password: z.string().min(8).max(128).optional(),
      }),
      req.body,
    );
    if (!input.email && !input.phone) {
      throw problem(400, "Bad Request", "CONTACT_REQUIRED", "email or phone is required");
    }

    let passwordHash: string | null = null;
    if (input.password) {
      const { hash } = await import("@node-rs/argon2");
      passwordHash = await hash(input.password);
    }

    const inserted = await db
      .insert(customers)
      .values({
        cafeId: user.cafe_id,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        authMethod: input.password ? "password" : "none",
        passwordHash,
      })
      .onConflictDoNothing()
      .returning();
    const customer = inserted[0];
    if (!customer) throw problem(409, "Conflict", "CUSTOMER_EXISTS");

    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "CUSTOMER_CREATED",
      source: "online",
      entityType: "customer",
      entityId: customer.id,
      metadata: { name: customer.name },
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  });

  app.get("/customers/:id", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.cafeId, user.cafe_id)))
      .limit(1);
    const customer = rows[0];
    if (!customer) throw problem(404, "Not Found", "CUSTOMER_NOT_FOUND");

    const stats = await db
      .select({
        total_sessions: sql<number>`count(*)::int`,
        total_minutes: sql<number>`coalesce(sum(${sessions.plannedMinutes} + ${sessions.extendedMinutes}), 0)::int`,
      })
      .from(sessions)
      .where(and(eq(sessions.customerId, id), eq(sessions.cafeId, user.cafe_id)));

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        created_at: customer.createdAt?.toISOString() ?? null,
      },
      play_stats: stats[0] ?? { total_sessions: 0, total_minutes: 0 },
    };
  });
}
