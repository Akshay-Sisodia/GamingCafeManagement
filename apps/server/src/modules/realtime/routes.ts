import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyReply, FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { db } from "../../db/index.js";
import { pcCommands } from "../../db/schema.js";
import {
  requireDeviceForSse,
  requireUserForSse,
  type DevicePrincipal,
  type UserClaims,
} from "../../auth/guards.js";
import { problem } from "../../lib/problem.js";
import { corsHeadersFor } from "../../lib/cors.js";
import { getRedis } from "../../lib/redis.js";
import {
  allocateEntry,
  getReplay,
  matchesContext,
  rememberRemoteEntry,
  writeSseEvent,
  type SseContext,
} from "./service.js";

interface SseRequest {
  raw: IncomingMessage;
  headers: Record<string, unknown>;
  query: unknown;
}

function parseLastEventId(req: SseRequest): number | null {
  const header = req.headers["last-event-id"];
  if (typeof header === "string") {
    const parsed = Number.parseInt(header, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query.last_event_id === "string") {
    const parsed = Number.parseInt(query.last_event_id, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function streamEvents(
  req: SseRequest & { log?: unknown },
  reply: FastifyReply,
  cafeId: string,
  ctx: SseContext,
): Promise<void> {
  void req.log;
  reply.hijack();
  const res = reply.raw;
  // @fastify/cors headers are lost on hijacked replies — inject them manually
  // or browsers block the EventSource connection.
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    ...corsHeadersFor(req.headers.origin),
  });
  res.write("retry: 3000\n\n");

  const lastEventId = parseLastEventId(req);
  for (const entry of getReplay(cafeId, lastEventId, ctx)) {
    writeSseEvent(res, entry);
  }

  if (ctx.kind === "pc" && ctx.pcId) {
    const pending = await db
      .select()
      .from(pcCommands)
      .where(and(eq(pcCommands.pcId, ctx.pcId), inArray(pcCommands.status, ["pending", "sent"])))
      .orderBy(desc(pcCommands.issuedAt));
    for (const cmd of pending.reverse()) {
      const entry = allocateEntry(cafeId, {
        event: "command",
        pc_id: cmd.pcId,
        data: {
          id: cmd.id,
          pc_id: cmd.pcId,
          type: cmd.type,
          payload: (cmd.payload ?? {}) as Record<string, unknown>,
          status: cmd.status,
          issued_at: cmd.issuedAt.toISOString(),
        },
      });
      writeSseEvent(res, entry);
    }
  }

  const subscriber = getRedis().duplicate();
  await subscriber.subscribe(`events:${cafeId}`);
  subscriber.on("message", (_channel: string, message: string) => {
    const entry = rememberRemoteEntry(cafeId, message);
    if (!entry) return;
    if (!matchesContext(entry, ctx)) return;
    try {
      writeSseEvent(res, entry);
    } catch {
      // connection already closed
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {
      // ignore
    }
  }, 25_000);

  req.raw.on("close", () => {
    clearInterval(heartbeat);
    void subscriber.unsubscribe(`events:${cafeId}`).then(() => subscriber.disconnect());
    res.end();
  });
}

export async function registerRealtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/realtime/pc", async (req, reply) => {
    const device: DevicePrincipal = await requireDeviceForSse(req);
    await streamEvents(req as unknown as SseRequest, reply, device.cafe_id, {
      kind: "pc",
      pcId: device.pc_id,
    });
  });

  app.get("/realtime/admin", async (req, reply) => {
    const user: UserClaims = await requireUserForSse(req);
    const query = req.query as { cafe?: string };
    if (!query.cafe) throw problem(400, "Bad Request", "CAFE_REQUIRED");
    if (query.cafe !== user.cafe_id) throw problem(403, "Forbidden", "CROSS_CAFE");
    await streamEvents(req as unknown as SseRequest, reply, query.cafe, { kind: "admin" });
  });
}
