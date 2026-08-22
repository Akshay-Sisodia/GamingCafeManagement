import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { healthReportSchema } from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import argon2 from "@node-rs/argon2";
import { db } from "../../db/index.js";
import { rowsOf } from "../../db/rows.js";
import {
  customers,
  gameVersions,
  games,
  pcCommands,
  pcConfigurations,
  pcGameInstallations,
  pcHealthSnapshots,
  pcTiers,
  pcs,
  sessions,
  superadminVerifiers,
  users,
} from "../../db/schema.js";
import { parseBody, parseQuery, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";
import { toSessionDto } from "../sessions/routes.js";

const superadminAttempts = new Map<string, { count: number; lockedUntil: number }>();

export async function handleListPcs(req: FastifyRequest) {
  const user = req.user!;
  const rows = await db
    .select({
      pc: pcs,
      tierName: pcTiers.name,
      activeSession: sql<
        | {
            id: string;
            customer_name: string | null;
            started_at: string;
            expires_at: string;
            planned_minutes: number;
          }
        | null
      >`(select json_build_object(
              'id', s.id,
              'customer_name', coalesce(c.name, null),
              'started_at', s.started_at,
              'expires_at', s.expires_at,
              'planned_minutes', s.planned_minutes)
         from ${sessions} s
         left join ${customers} c on c.id = s.customer_id
        where s.pc_id = ${pcs.id} and s.status in ('active','scheduled')
        order by s.started_at desc limit 1)`,
    })
    .from(pcs)
    .leftJoin(pcTiers, eq(pcTiers.id, pcs.tierId))
    .where(eq(pcs.cafeId, user.cafe_id))
    .orderBy(pcs.name)
    .limit(500);

  return rows.map((r) => ({
    id: r.pc.id,
    name: r.pc.name,
    status: r.pc.status,
    tier_name: r.tierName ?? "Standard",
    agent_version: r.pc.agentVersion ?? "",
    current_session: r.activeSession
      ? {
          id: r.activeSession.id,
          customer_name: r.activeSession.customer_name,
          started_at: new Date(r.activeSession.started_at).toISOString(),
          expires_at: new Date(r.activeSession.expires_at).toISOString(),
          planned_minutes: r.activeSession.planned_minutes,
          game_name: null,
        }
      : null,
  }));
}

export async function handleGetPc(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const pcRows = await db
    .select({ pc: pcs, tierName: pcTiers.name })
    .from(pcs)
    .leftJoin(pcTiers, eq(pcTiers.id, pcs.tierId))
    .where(and(eq(pcs.id, id), eq(pcs.cafeId, user.cafe_id)))
    .limit(1);
  const row = pcRows[0];
  if (!row) throw problem(404, "Not Found", "PC_NOT_FOUND");

  const healthRows = await db
    .select()
    .from(pcHealthSnapshots)
    .where(eq(pcHealthSnapshots.pcId, id))
    .orderBy(desc(pcHealthSnapshots.capturedAt))
    .limit(1);
  const installations = await db
    .select({
      installation: pcGameInstallations,
      game_name: games.name,
      version: gameVersions.version,
    })
    .from(pcGameInstallations)
    .innerJoin(games, eq(games.id, pcGameInstallations.gameId))
    .leftJoin(gameVersions, eq(gameVersions.id, pcGameInstallations.installedVersionId))
    .where(eq(pcGameInstallations.pcId, id))
    .limit(200);

  const sessionRows = await db
    .select({
      session: sessions,
      customerName: customers.name,
    })
    .from(sessions)
    .leftJoin(customers, eq(customers.id, sessions.customerId))
    .where(
      and(
        eq(sessions.pcId, id),
        inArray(sessions.status, ["active", "scheduled", "paused"]),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);

  const commandRows = await db
    .select()
    .from(pcCommands)
    .where(eq(pcCommands.pcId, id))
    .orderBy(desc(pcCommands.issuedAt))
    .limit(20);

  return {
    id: row.pc.id,
    name: row.pc.name,
    status: row.pc.status,
    tier_name: row.tierName ?? "Standard",
    agent_version: row.pc.agentVersion ?? "",
    current_session: sessionRows[0]
      ? {
          id: sessionRows[0].session.id,
          customer_name: sessionRows[0].customerName,
          started_at: sessionRows[0].session.startedAt.toISOString(),
          expires_at: sessionRows[0].session.expiresAt.toISOString(),
          planned_minutes: sessionRows[0].session.plannedMinutes,
          game_name: null,
        }
      : null,
    health: healthRows[0]
      ? {
          cpu_pct: healthRows[0].cpuPct,
          ram_pct: healthRows[0].ramPct,
          gpu_pct: healthRows[0].gpuPct,
          disk_pct: healthRows[0].diskPct,
          disk_free_bytes: Number(healthRows[0].diskFreeBytes),
          uptime_s: healthRows[0].uptimeS,
          agent_status: healthRows[0].agentStatus,
        }
      : null,
    installations: installations.map((i) => ({
      id: i.installation.id,
      game_name: i.game_name,
      version_label: i.version ?? "—",
      state: i.installation.state,
      updated_at:
        i.installation.lastVerifiedAt?.toISOString() ?? new Date(0).toISOString(),
    })),
    commands: commandRows.map((c) => ({
      id: c.id,
      type: c.type,
      payload: (c.payload ?? {}) as Record<string, unknown>,
      status: c.status,
      issued_at: c.issuedAt.toISOString(),
    })),
  };
}

export async function handleCreatePc(req: FastifyRequest) {
  const user = req.user!;
  const input = parseBody(
    z.object({
      name: z.string().min(1).max(50),
      tier_id: z.string().uuid().nullable().optional(),
    }),
    req.body,
  );
  const inserted = await db
    .insert(pcs)
    .values({ cafeId: user.cafe_id, name: input.name, tierId: input.tier_id ?? null })
    .returning();
  const pc = inserted[0]!;
  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "PC_CREATED",
    source: "online",
    pcId: pc.id,
    entityType: "pc",
    entityId: pc.id,
  });
  publishToCafe(user.cafe_id, {
    event: "pc.status",
    data: { pc_id: pc.id, status: pc.status, at: new Date().toISOString() },
  });
  return { pc };
}

export async function handlePatchPc(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const input = parseBody(
    z.object({
      name: z.string().min(1).max(50).optional(),
      tier_id: z.string().uuid().nullable().optional(),
      status: z.enum(["online", "offline", "maintenance", "disabled"]).optional(),
    }),
    req.body,
  );
  const updated = await db
    .update(pcs)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.tier_id !== undefined ? { tierId: input.tier_id } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(and(eq(pcs.id, id), eq(pcs.cafeId, user.cafe_id)))
    .returning();
  const pc = updated[0];
  if (!pc) throw problem(404, "Not Found", "PC_NOT_FOUND");
  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "CONFIG_CHANGED",
    source: "online",
    pcId: pc.id,
    entityType: "pc",
    entityId: pc.id,
    metadata: input as Record<string, unknown>,
  });
  if (input.status !== undefined) {
    publishToCafe(user.cafe_id, {
      event: "pc.status",
      data: { pc_id: pc.id, status: pc.status, at: new Date().toISOString() },
    });
  }
  return { pc };
}

export async function handleAgentHealth(req: FastifyRequest) {
  const device = req.device!;
  const input = parseBody(healthReportSchema, req.body);
  const now = new Date();

  await db.insert(pcHealthSnapshots).values({
    pcId: device.pc_id,
    capturedAt: now,
    cpuPct: input.cpu_pct,
    ramPct: input.ram_pct,
    gpuPct: input.gpu_pct ?? null,
    diskPct: input.disk_pct,
    diskFreeBytes: input.disk_free_bytes,
    netRxBps: input.net_rx_bps ?? null,
    netTxBps: input.net_tx_bps ?? null,
    uptimeS: input.uptime_s,
    currentGameId: input.current_game_id ?? null,
    agentStatus: input.agent_status,
  });

  const raw = await db.execute(sql`
    UPDATE pcs
    SET status = case when status in ('offline','online') then 'online'::pc_status else status end,
        last_heartbeat_at = now()
    WHERE id = ${device.pc_id}
    RETURNING cafe_id, status
  `);
  const row = rowsOf<{ cafe_id: string; status: string }>(raw)[0];

  if (row && row.status === "online") {
    publishToCafe(row.cafe_id, {
      event: "pc.status",
      data: { pc_id: device.pc_id, status: "online", at: now.toISOString() },
    });
  }
  return { ok: true, server_time_ms: Date.now() };
}

export async function handlePcHealthLatest(req: FastifyRequest) {
  const user = req.user!;
  const id = (req.params as { id: string }).id;
  const owned = await db
    .select({ id: pcs.id })
    .from(pcs)
    .where(and(eq(pcs.id, id), eq(pcs.cafeId, user.cafe_id)))
    .limit(1);
  if (!owned[0]) throw problem(404, "Not Found", "PC_NOT_FOUND");
  const rows = await db
    .select()
    .from(pcHealthSnapshots)
    .where(eq(pcHealthSnapshots.pcId, id))
    .orderBy(desc(pcHealthSnapshots.capturedAt))
    .limit(1);
  return { health: rows[0] ?? null };
}

export async function handleAgentBootstrap(req: FastifyRequest) {
  const device = req.device!;
  const pcId = device.pc_id;

  const pcRows = await db.select().from(pcs).where(eq(pcs.id, pcId)).limit(1);
  const pc = pcRows[0]!;

  const configRows = await db
    .select()
    .from(pcConfigurations)
    .where(eq(pcConfigurations.pcId, pcId))
    .orderBy(desc(pcConfigurations.version))
    .limit(1);

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.pcId, pcId), eq(sessions.status, "active")))
    .limit(1);

  const gameRows = await db
    .select({ game: games, installation: pcGameInstallations })
    .from(games)
    .leftJoin(
      pcGameInstallations,
      and(eq(pcGameInstallations.gameId, games.id), eq(pcGameInstallations.pcId, pcId)),
    )
    .where(and(eq(games.cafeId, device.cafe_id), eq(games.enabled, true)))
    .orderBy(games.displayOrder)
    .limit(500);

  const pendingCommands = await db.execute(sql`
    SELECT id, type, payload, issued_at FROM pc_commands
    WHERE pc_id = ${pcId} AND status IN ('pending','sent') AND expires_at > now()
    ORDER BY issued_at ASC
  `);
  const commandRows = rowsOf<Record<string, unknown>>(pendingCommands).map((r) => ({
    id: String(r.id),
    pc_id: pcId,
    type: String(r.type),
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    status: "pending",
    issued_at: new Date(String(r.issued_at)).toISOString(),
  }));

  const verifierRows = await db
    .select({ version: superadminVerifiers.version })
    .from(superadminVerifiers)
    .where(eq(superadminVerifiers.pcId, pcId))
    .orderBy(desc(superadminVerifiers.version))
    .limit(1);

  return {
    pc,
    config: configRows[0]
      ? { version: configRows[0].version, config: configRows[0].config }
      : null,
    active_session: sessionRows[0] ? toSessionDto(sessionRows[0]) : null,
    games: gameRows.map((g) => ({ game: g.game, installation: g.installation })),
    pending_commands: commandRows,
    verifier_version: verifierRows[0]?.version ?? 0,
    server_time_ms: Date.now(),
  };
}

export async function handleAgentConfig(req: FastifyRequest) {
  const device = req.device!;
  const query = parseQuery(
    z.object({ version: z.coerce.number().int().optional() }),
    req.query,
  );
  const rows = await db
    .select()
    .from(pcConfigurations)
    .where(eq(pcConfigurations.pcId, device.pc_id))
    .orderBy(desc(pcConfigurations.version))
    .limit(1);
  const latest = rows[0];
  if (!latest) return { version: 0, config: {}, unchanged: false };
  if (query.version !== undefined && query.version === latest.version) {
    return { version: latest.version, config: null, unchanged: true };
  }
  return { version: latest.version, config: latest.config, unchanged: false };
}

export async function handleAgentTimeCheck() {
  return { server_time_ms: Date.now() };
}

export async function handleSuperadminVerify(req: FastifyRequest) {
  const device = req.device!;
  const id = (req.params as { id: string }).id;
  if (id !== device.pc_id) throw problem(403, "Forbidden", "NOT_YOUR_PC");

  const input = parseBody(z.object({ password: z.string().min(1).max(128) }), req.body);

  const now = Date.now();
  const state = superadminAttempts.get(id) ?? { count: 0, lockedUntil: 0 };
  if (state.lockedUntil > now) {
    return {
      ok: false,
      retry_after_s: Math.ceil((state.lockedUntil - now) / 1000),
    };
  }

  const ownerRows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.cafeId, device.cafe_id), eq(users.role, "owner")));

  const verifyResults = await Promise.all(
    ownerRows.map(async (owner) => {
      try {
        return await argon2.verify(owner.passwordHash, input.password);
      } catch {
        console.error("Malformed password hash for owner in cafe", device.cafe_id);
        return false;
      }
    }),
  );
  const ok = verifyResults.some(Boolean);

  if (ok) {
    superadminAttempts.delete(id);
  } else {
    state.count++;
    state.lockedUntil =
      state.count >= 5 ? now + Math.min(30_000 * 2 ** (state.count - 5), 900_000) : 0;
    superadminAttempts.set(id, state);
  }

  await writeAudit(db, {
    cafeId: device.cafe_id,
    actorType: ok ? "superadmin_local" : "pc",
    actorId: id,
    action: ok ? "SUPERADMIN_ENTERED" : "SUPERADMIN_LOGIN_FAILED",
    source: "online",
    pcId: id,
    metadata: { connection: "online" },
  });

  return { ok, retry_after_s: 0 };
}
