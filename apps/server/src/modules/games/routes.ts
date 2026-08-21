import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import {
  gameDeploymentTargets,
  gameDeployments,
  gameVersions,
  games,
  pcGameInstallations,
  pcs,
} from "../../db/schema.js";
import { requireUser, requireDevice } from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get("/games", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const gameRows = await db
      .select()
      .from(games)
      .where(eq(games.cafeId, user.cafe_id))
      .orderBy(asc(games.displayOrder), asc(games.name));
    const gameIds = gameRows.map((g) => g.id);

    const versionRows =
      gameIds.length > 0
        ? await db
            .select()
            .from(gameVersions)
            .where(inArray(gameVersions.gameId, gameIds))
            .orderBy(desc(gameVersions.publishedAt))
        : [];
    const countRows =
      gameIds.length > 0
        ? await db
            .select({
              gameId: pcGameInstallations.gameId,
              count: sql<number>`count(*)::int`,
            })
            .from(pcGameInstallations)
            .where(inArray(pcGameInstallations.gameId, gameIds))
            .groupBy(pcGameInstallations.gameId)
        : [];

    return {
      games: gameRows.map((g) => ({
        id: g.id,
        name: g.name,
        platform: g.platform,
        category: g.category,
        executable_path: g.executablePath,
        launch_args: g.launchArgs,
        enabled: g.enabled,
        display_order: g.displayOrder,
        versions: versionRows
          .filter((v) => v.gameId === g.id)
          .map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            size_bytes: v.sizeBytes,
            manifest_url: v.manifestUrl,
            published_at: v.publishedAt ? v.publishedAt.toISOString() : null,
          })),
        installation_count: countRows
          .filter((c) => c.gameId === g.id)
          .reduce((sum, c) => sum + Number(c.count), 0),
      })),
    };
  });

  app.post("/games", { preHandler: requireUser(["owner", "manager"]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(
      z.object({
        name: z.string().min(1).max(120),
        platform: z.enum(["steam", "epic", "riot", "ea", "battlenet", "standalone"]).optional(),
        category: z.string().max(80).nullable().optional(),
        executable_path: z.string().max(500).nullable().optional(),
        launch_args: z.string().max(500).nullable().optional(),
        display_order: z.number().int().min(0).optional(),
      }),
      req.body,
    );
    const inserted = await db
      .insert(games)
      .values({
        cafeId: user.cafe_id,
        name: input.name,
        platform: input.platform ?? "standalone",
        category: input.category ?? null,
        executablePath: input.executable_path ?? null,
        launchArgs: input.launch_args ?? null,
        displayOrder: input.display_order ?? 0,
        enabled: true,
      })
      .returning();
    const game = inserted[0]!;
    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "GAME_CREATED",
      source: "online",
      entityType: "game",
      entityId: game.id,
      metadata: { name: game.name },
    });
    return { game };
  });

  app.patch("/games/:id", { preHandler: requireUser(["owner", "manager"]) }, async (req) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const input = parseBody(
      z.object({
        name: z.string().min(1).max(120).optional(),
        category: z.string().max(80).nullable().optional(),
        executable_path: z.string().max(500).nullable().optional(),
        launch_args: z.string().max(500).nullable().optional(),
        enabled: z.boolean().optional(),
        display_order: z.number().int().min(0).optional(),
      }),
      req.body,
    );
    const updated = await db
      .update(games)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.executable_path !== undefined ? { executablePath: input.executable_path } : {}),
        ...(input.launch_args !== undefined ? { launchArgs: input.launch_args } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.display_order !== undefined ? { displayOrder: input.display_order } : {}),
      })
      .where(and(eq(games.id, id), eq(games.cafeId, user.cafe_id)))
      .returning();
    const game = updated[0];
    if (!game) throw problem(404, "Not Found", "GAME_NOT_FOUND");
    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "GAME_UPDATED",
      source: "online",
      entityType: "game",
      entityId: game.id,
      metadata: input as Record<string, unknown>,
    });
    return { game };
  });

  app.post(
    "/games/:id/versions",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const id = (req.params as { id: string }).id;
      const input = parseBody(
        z.object({
          version: z.string().min(1).max(50),
          size_bytes: z.number().int().nonnegative().optional(),
          manifest_url: z.string().max(500).optional(),
        }),
        req.body,
      );

      const gameRows = await db
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.id, id), eq(games.cafeId, user.cafe_id)))
        .limit(1);
      if (!gameRows[0]) throw problem(404, "Not Found", "GAME_NOT_FOUND");

      const inserted = await db
        .insert(gameVersions)
        .values({
          gameId: id,
          version: input.version,
          status: "published",
          publishedAt: new Date(),
          sizeBytes: input.size_bytes ?? null,
          manifestUrl: input.manifest_url ?? null,
        })
        .returning();
      const version = inserted[0]!;
      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "GAME_VERSION_PUBLISHED",
        source: "online",
        entityType: "game_version",
        entityId: version.id,
        metadata: { game_id: id, version: version.version },
      });
      return { version };
    },
  );

  app.get("/deployments", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    const jobRows = await db
      .select({ deployment: gameDeployments, game_name: games.name })
      .from(gameDeployments)
      .innerJoin(games, eq(games.id, gameDeployments.gameId))
      .where(eq(gameDeployments.cafeId, user.cafe_id))
      .orderBy(desc(gameDeployments.createdAt))
      .limit(100);
    const jobIds = jobRows.map((j) => j.deployment.id);
    const targetRows =
      jobIds.length > 0
        ? await db
            .select({ target: gameDeploymentTargets, pc_name: pcs.name })
            .from(gameDeploymentTargets)
            .innerJoin(pcs, eq(pcs.id, gameDeploymentTargets.pcId))
            .where(inArray(gameDeploymentTargets.deploymentId, jobIds))
        : [];

    return {
      deployments: jobRows.map((j) => ({
        id: j.deployment.id,
        game_id: j.deployment.gameId,
        game_name: j.game_name,
        target_version_id: j.deployment.targetVersionId,
        master_pc_id: j.deployment.masterPcId,
        policy: j.deployment.policy,
        status: j.deployment.status,
        created_by: j.deployment.createdBy,
        created_at: j.deployment.createdAt.toISOString(),
        targets: targetRows
          .filter((t) => t.target.deploymentId === j.deployment.id)
          .map((t) => ({
            id: t.target.id,
            pc_id: t.target.pcId,
            pc_name: t.pc_name,
            state: t.target.state,
            progress_pct: t.target.progressPct,
            bytes_transferred: t.target.bytesTransferred,
            error: t.target.error,
            started_at: t.target.startedAt ? t.target.startedAt.toISOString() : null,
            finished_at: t.target.finishedAt ? t.target.finishedAt.toISOString() : null,
          })),
      })),
    };
  });

  app.post("/deployments", { preHandler: requireUser(["owner", "manager"]) }, async (req) => {
    const user = req.user!;
    const input = parseBody(
      z.object({
        game_id: z.string().uuid(),
        target_version_id: z.string().uuid(),
        master_pc_id: z.string().uuid(),
        pc_ids: z.array(z.string().uuid()).min(1),
        policy: z.record(z.unknown()).optional(),
      }),
      req.body,
    );

    const gameRows = await db
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.id, input.game_id), eq(games.cafeId, user.cafe_id)))
      .limit(1);
    if (!gameRows[0]) throw problem(404, "Not Found", "GAME_NOT_FOUND");

    const versionRows = await db
      .select({ id: gameVersions.id })
      .from(gameVersions)
      .where(
        and(eq(gameVersions.id, input.target_version_id), eq(gameVersions.gameId, input.game_id)),
      )
      .limit(1);
    if (!versionRows[0]) throw problem(404, "Not Found", "GAME_VERSION_NOT_FOUND");

    const masterRows = await db
      .select({ id: pcs.id })
      .from(pcs)
      .where(and(eq(pcs.id, input.master_pc_id), eq(pcs.cafeId, user.cafe_id)))
      .limit(1);
    if (!masterRows[0]) throw problem(404, "Not Found", "PC_NOT_FOUND");

    const targetPcIds = [...new Set(input.pc_ids)];
    const pcRows = await db
      .select({ id: pcs.id })
      .from(pcs)
      .where(and(inArray(pcs.id, targetPcIds), eq(pcs.cafeId, user.cafe_id)));
    if (pcRows.length !== targetPcIds.length) {
      throw problem(400, "Bad Request", "PC_NOT_IN_CAFE", "One or more target PCs are not in this cafe");
    }

    const insertedJob = await db
      .insert(gameDeployments)
      .values({
        cafeId: user.cafe_id,
        gameId: input.game_id,
        targetVersionId: input.target_version_id,
        masterPcId: input.master_pc_id,
        policy: input.policy ?? null,
        status: "queued",
        createdBy: user.sub,
      })
      .returning();
    const job = insertedJob[0]!;

    const insertedTargets = await db
      .insert(gameDeploymentTargets)
      .values(targetPcIds.map((pcId) => ({ deploymentId: job.id, pcId, state: "queued" as const })))
      .returning();

    await writeAudit(db, {
      cafeId: user.cafe_id,
      actorType: "user",
      actorId: user.sub,
      actorRole: user.role,
      action: "GAME_DEPLOYMENT_CREATED",
      source: "online",
      entityType: "game_deployment",
      entityId: job.id,
      metadata: { game_id: job.gameId, target_count: insertedTargets.length },
    });

    for (const target of insertedTargets) {
      publishToCafe(user.cafe_id, {
        event: "deployment.updated",
        pc_id: target.pcId,
        data: {
          job_id: job.id,
          pc_id: target.pcId,
          target_state: target.state,
          progress_pct: target.progressPct,
        },
      });
    }

    return {
      deployment: {
        ...job,
        targets: insertedTargets.map((t) => ({
          id: t.id,
          pc_id: t.pcId,
          state: t.state,
          progress_pct: t.progressPct,
        })),
      },
    };
  });

  app.post(
    "/deployment-targets/:id/pause",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const id = (req.params as { id: string }).id;
      const rows = await db
        .select({ target: gameDeploymentTargets, cafeId: gameDeployments.cafeId })
        .from(gameDeploymentTargets)
        .innerJoin(gameDeployments, eq(gameDeployments.id, gameDeploymentTargets.deploymentId))
        .where(eq(gameDeploymentTargets.id, id))
        .limit(1);
      const row = rows[0];
      if (!row || row.cafeId !== user.cafe_id) {
        throw problem(404, "Not Found", "DEPLOYMENT_TARGET_NOT_FOUND");
      }
      if (row.target.state !== "downloading") {
        throw problem(
          409,
          "Conflict",
          "DEPLOYMENT_TARGET_INVALID_TRANSITION",
          `Cannot pause a target in state ${row.target.state}`,
        );
      }
      const updated = await db
        .update(gameDeploymentTargets)
        .set({ state: "paused" })
        .where(eq(gameDeploymentTargets.id, id))
        .returning();
      const target = updated[0]!;

      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "DEPLOYMENT_TARGET_PAUSED",
        source: "online",
        pcId: target.pcId,
        entityType: "game_deployment_target",
        entityId: target.id,
      });
      publishToCafe(user.cafe_id, {
        event: "deployment.updated",
        pc_id: target.pcId,
        data: {
          job_id: target.deploymentId,
          pc_id: target.pcId,
          target_state: target.state,
          progress_pct: target.progressPct,
        },
      });
      return { target };
    },
  );

  app.post(
    "/deployment-targets/:id/resume",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const id = (req.params as { id: string }).id;
      const rows = await db
        .select({ target: gameDeploymentTargets, cafeId: gameDeployments.cafeId })
        .from(gameDeploymentTargets)
        .innerJoin(gameDeployments, eq(gameDeployments.id, gameDeploymentTargets.deploymentId))
        .where(eq(gameDeploymentTargets.id, id))
        .limit(1);
      const row = rows[0];
      if (!row || row.cafeId !== user.cafe_id) {
        throw problem(404, "Not Found", "DEPLOYMENT_TARGET_NOT_FOUND");
      }
      if (row.target.state !== "paused") {
        throw problem(
          409,
          "Conflict",
          "DEPLOYMENT_TARGET_INVALID_TRANSITION",
          `Cannot resume a target in state ${row.target.state}`,
        );
      }
      const updated = await db
        .update(gameDeploymentTargets)
        .set({ state: "downloading", startedAt: row.target.startedAt ?? new Date() })
        .where(eq(gameDeploymentTargets.id, id))
        .returning();
      const target = updated[0]!;

      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "DEPLOYMENT_TARGET_RESUMED",
        source: "online",
        pcId: target.pcId,
        entityType: "game_deployment_target",
        entityId: target.id,
      });
      publishToCafe(user.cafe_id, {
        event: "deployment.updated",
        pc_id: target.pcId,
        data: {
          job_id: target.deploymentId,
          pc_id: target.pcId,
          target_state: target.state,
          progress_pct: target.progressPct,
        },
      });
      return { target };
    },
  );

  // ---- Agent-facing deployment endpoints (device auth) --------------------
  // Cloud coordinates metadata; bytes move over the café LAN (PRD §29-31).

  app.get("/agent/deployments/active", { preHandler: requireDevice() }, async (req) => {
    const device = req.device!;
    const rows = await db
      .select({
        job: gameDeployments,
        target: gameDeploymentTargets,
        version: gameVersions,
        masterName: pcs.name,
      })
      .from(gameDeploymentTargets)
      .innerJoin(gameDeployments, eq(gameDeployments.id, gameDeploymentTargets.deploymentId))
      .innerJoin(gameVersions, eq(gameVersions.id, gameDeployments.targetVersionId))
      .leftJoin(pcs, eq(pcs.id, gameDeployments.masterPcId))
      .where(
        and(
          eq(gameDeploymentTargets.pcId, device.pc_id),
          inArray(gameDeploymentTargets.state, ["queued", "downloading", "verifying", "installing", "paused"]),
        ),
      );

    return {
      deployments: rows.map((r) => ({
        job_id: r.job.id,
        game_id: r.job.gameId,
        target_state: r.target.state,
        progress_pct: r.target.progressPct,
        version: r.version.version,
        manifest_url: r.version.manifestUrl,
        manifest_hash: r.version.manifestHash,
        size_bytes: r.version.sizeBytes,
        policy: r.job.policy ?? {},
        lan_base_url: (r.job.policy as Record<string, unknown> | null)?.lan_base_url ?? null,
        master_pc_name: r.masterName,
      })),
    };
  });

  app.post(
    "/deployments/:jobId/targets/:pcId/progress",
    { preHandler: requireDevice() },
    async (req) => {
      const device = req.device!;
      const { jobId, pcId } = req.params as { jobId: string; pcId: string };
      if (pcId !== device.pc_id) throw problem(403, "Forbidden", "NOT_YOUR_TARGET");

      const input = parseBody(
        z.object({
          state: z.enum(["downloading", "verifying", "installing", "paused"]).optional(),
          progress_pct: z.number().min(0).max(100).optional(),
          bytes_transferred: z.number().int().nonnegative().optional(),
        }),
        req.body,
      );

      const owned = await db
        .select({ id: gameDeploymentTargets.id })
        .from(gameDeploymentTargets)
        .innerJoin(gameDeployments, eq(gameDeployments.id, gameDeploymentTargets.deploymentId))
        .where(
          and(
            eq(gameDeploymentTargets.deploymentId, jobId),
            eq(gameDeploymentTargets.pcId, pcId),
            eq(gameDeployments.cafeId, device.cafe_id),
          ),
        )
        .limit(1);
      if (!owned[0]) throw problem(404, "Not Found", "DEPLOYMENT_TARGET_NOT_FOUND");

      const updated = await db
        .update(gameDeploymentTargets)
        .set({
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.progress_pct !== undefined ? { progressPct: input.progress_pct } : {}),
          ...(input.bytes_transferred !== undefined
            ? { bytesTransferred: input.bytes_transferred }
            : {}),
        })
        .where(eq(gameDeploymentTargets.id, owned[0].id))
        .returning();
      const target = updated[0]!;

      publishToCafe(device.cafe_id, {
        event: "deployment.progress",
        pc_id: pcId,
        data: {
          job_id: jobId,
          pc_id: pcId,
          target_state: target.state,
          progress_pct: target.progressPct,
        },
      });
      return { ok: true };
    },
  );

  app.post(
    "/deployments/:jobId/targets/:pcId/complete",
    { preHandler: requireDevice() },
    async (req) => {
      const device = req.device!;
      const { jobId, pcId } = req.params as { jobId: string; pcId: string };
      if (pcId !== device.pc_id) throw problem(403, "Forbidden", "NOT_YOUR_TARGET");

      const input = parseBody(
        z.object({ manifest_hash_verified: z.boolean() }),
        req.body,
      );
      if (!input.manifest_hash_verified) {
        throw problem(
          400,
          "Bad Request",
          "MANIFEST_NOT_VERIFIED",
          "Only integrity-verified installations may be marked complete",
        );
      }

      const rows = await db
        .select({ job: gameDeployments })
        .from(gameDeployments)
        .where(and(eq(gameDeployments.id, jobId), eq(gameDeployments.cafeId, device.cafe_id)))
        .limit(1);
      const job = rows[0];
      if (!job) throw problem(404, "Not Found", "DEPLOYMENT_NOT_FOUND");

      const updated = await db
        .update(gameDeploymentTargets)
        .set({ state: "ready", progressPct: 100, finishedAt: new Date(), error: null })
        .where(
          and(
            eq(gameDeploymentTargets.deploymentId, jobId),
            eq(gameDeploymentTargets.pcId, pcId),
          ),
        )
        .returning();
      const target = updated[0]!;

      // Keep the installation record in sync (docs/02 §3).
      await db
        .update(pcGameInstallations)
        .set({ state: "ready", installedVersionId: job.job.targetVersionId, lastVerifiedAt: new Date() })
        .where(
          and(eq(pcGameInstallations.pcId, pcId), eq(pcGameInstallations.gameId, job.job.gameId)),
        );

      await writeAudit(db, {
        cafeId: device.cafe_id,
        actorType: "pc",
        actorId: pcId,
        action: "GAME_DEPLOYMENT_COMPLETED",
        source: "online",
        pcId,
        entityType: "game_deployment_target",
        entityId: target.id,
      });
      publishToCafe(device.cafe_id, {
        event: "deployment.updated",
        pc_id: pcId,
        data: { job_id: jobId, pc_id: pcId, target_state: "ready", progress_pct: 100 },
      });
      return { ok: true };
    },
  );

  app.post(
    "/deployments/:jobId/targets/:pcId/fail",
    { preHandler: requireDevice() },
    async (req) => {
      const device = req.device!;
      const { jobId, pcId } = req.params as { jobId: string; pcId: string };
      if (pcId !== device.pc_id) throw problem(403, "Forbidden", "NOT_YOUR_TARGET");

      const input = parseBody(
        z.object({ code: z.string().min(1).max(80), detail: z.string().max(500).optional() }),
        req.body,
      );

      const rows = await db
        .select({ cafeId: gameDeployments.cafeId })
        .from(gameDeployments)
        .where(eq(gameDeployments.id, jobId))
        .limit(1);
      if (!rows[0] || rows[0].cafeId !== device.cafe_id) {
        throw problem(404, "Not Found", "DEPLOYMENT_NOT_FOUND");
      }

      const updated = await db
        .update(gameDeploymentTargets)
        .set({
          state: "failed",
          error: `${input.code}: ${input.detail ?? ""}`.trim(),
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(gameDeploymentTargets.deploymentId, jobId),
            eq(gameDeploymentTargets.pcId, pcId),
          ),
        )
        .returning();

      await writeAudit(db, {
        cafeId: device.cafe_id,
        actorType: "pc",
        actorId: pcId,
        action: "GAME_DEPLOYMENT_FAILED",
        source: "online",
        pcId,
        entityType: "game_deployment_target",
        entityId: updated[0]!.id,
        metadata: { code: input.code, detail: input.detail },
      });
      publishToCafe(device.cafe_id, {
        event: "deployment.updated",
        pc_id: pcId,
        data: { job_id: jobId, pc_id: pcId, target_state: "failed" },
      });
      return { ok: true };
    },
  );
}
