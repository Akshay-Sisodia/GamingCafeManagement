import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { orders, pcs, payments, sessions } from "../../db/schema.js";

function dayStart(dateStr?: string): Date {
  if (dateStr) return new Date(`${dateStr}T00:00:00.000Z`);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function handleDashboard(req: FastifyRequest) {
  const user = req.user!;
  const today = dayStart();

  const [paymentRevenue] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` })
    .from(payments)
    .where(
      and(
        eq(payments.cafeId, user.cafe_id),
        eq(payments.status, "success"),
        gte(payments.createdAt, today),
      ),
    );

  const [sessionRevenue] = await db
    .select({ total: sql<number>`coalesce(sum(${sessions.priceAmount}), 0)::bigint` })
    .from(sessions)
    .where(
      and(
        eq(sessions.cafeId, user.cafe_id),
        sql`${sessions.status} in ('ended','expired')`,
        gte(sessions.startedAt, today),
      ),
    );

  const [pcCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      offline: sql<number>`count(*) filter (where ${pcs.status} = 'offline')::int`,
    })
    .from(pcs)
    .where(eq(pcs.cafeId, user.cafe_id));

  const [occupied] = await db
    .select({ count: sql<number>`count(distinct ${sessions.pcId})::int` })
    .from(sessions)
    .where(and(eq(sessions.cafeId, user.cafe_id), eq(sessions.status, "active")));

  const [activeSessions] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.cafeId, user.cafe_id), eq(sessions.status, "active")));

  const [pendingOrders] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.cafeId, user.cafe_id),
        sql`${orders.status} in ('placed','accepted','preparing')`,
      ),
    );

  return {
    revenue_today: Number(paymentRevenue?.total ?? 0) + Number(sessionRevenue?.total ?? 0),
    pcs_total: pcCounts?.total ?? 0,
    pcs_occupied: occupied?.count ?? 0,
    active_sessions: activeSessions?.count ?? 0,
    pending_orders: pendingOrders?.count ?? 0,
    offline_pcs: pcCounts?.offline ?? 0,
  };
}

export async function handleSessionReport(req: FastifyRequest) {
  const user = req.user!;
  const query = req.query as { from?: string; to?: string };
  const from = dayStart(query.from);
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();

  const rows = await db
    .select({
      day: sql<string>`to_char(${sessions.startedAt}, 'YYYY-MM-DD')`,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${sessions.plannedMinutes} + ${sessions.extendedMinutes}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${sessions.priceAmount}), 0)::bigint`,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.cafeId, user.cafe_id),
        gte(sessions.startedAt, from),
        lte(sessions.startedAt, to),
      ),
    )
    .groupBy(sql`to_char(${sessions.startedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${sessions.startedAt}, 'YYYY-MM-DD')`);

  return { days: rows.map((r) => ({ ...r, revenue: Number(r.revenue) })) };
}

export async function handleFoodReport(req: FastifyRequest) {
  const user = req.user!;
  const query = req.query as { from?: string; to?: string };
  const from = dayStart(query.from);
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();

  const rows = await db
    .select({
      day: sql<string>`to_char(${orders.placedAt}, 'YYYY-MM-DD')`,
      orders: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::bigint`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.cafeId, user.cafe_id),
        sql`${orders.status} <> 'cancelled'`,
        gte(orders.placedAt, from),
        lte(orders.placedAt, to),
      ),
    )
    .groupBy(sql`to_char(${orders.placedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${orders.placedAt}, 'YYYY-MM-DD')`);

  return { days: rows.map((r) => ({ ...r, revenue: Number(r.revenue) })) };
}
