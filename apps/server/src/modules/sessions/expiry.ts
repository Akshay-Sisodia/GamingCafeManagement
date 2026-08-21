import { sql } from "drizzle-orm";
import { uuidv7 } from "@gaming-cafe/shared";
import { db } from "../../db/index.js";
import { rowsOf } from "../../db/rows.js";
import { sessionEvents } from "../../db/schema.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";

interface ExpiredRow {
  id: string;
  cafe_id: string;
  pc_id: string;
  expires_at: string | Date;
}

export async function expireDueSessions(dbClient = db): Promise<ExpiredRow[]> {
  const result = await dbClient.execute(sql`
    UPDATE sessions
    SET status = 'expired', ended_at = now()
    WHERE status = 'active' AND expires_at < now()
    RETURNING id, cafe_id, pc_id, expires_at
  `);
  const rows = rowsOf<ExpiredRow>(result);
  for (const row of rows) {
    await dbClient.insert(sessionEvents).values({
      id: uuidv7(),
      sessionId: row.id,
      type: "expired",
      actorType: "system",
      actorId: "worker",
      payload: { expires_at: new Date(row.expires_at).toISOString() },
    });
    await writeAudit(dbClient, {
      cafeId: row.cafe_id,
      actorType: "system",
      actorId: "worker",
      action: "SESSION_EXPIRED",
      source: "online",
      pcId: row.pc_id,
      entityType: "session",
      entityId: row.id,
    });
    publishToCafe(row.cafe_id, {
      event: "session.updated",
      pc_id: row.pc_id,
      data: {
        session_id: row.id,
        pc_id: row.pc_id,
        expires_at: new Date(row.expires_at).toISOString(),
        status: "expired",
      },
    });
  }
  return rows;
}

export async function markStalePcsOffline(): Promise<Array<{ id: string; cafe_id: string }>> {
  const result = await db.execute(sql`
    UPDATE pcs
    SET status = 'offline'
    WHERE status = 'online' AND last_heartbeat_at < now() - interval '10 minutes'
    RETURNING id, cafe_id
  `);
  const rows = rowsOf<{ id: string; cafe_id: string }>(result);
  for (const row of rows) {
    publishToCafe(row.cafe_id, {
      event: "pc.status",
      data: { pc_id: row.id, status: "offline", at: new Date().toISOString() },
    });
  }
  return rows;
}
