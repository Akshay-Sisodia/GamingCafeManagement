import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import {
  gameDeploymentTargets,
  gameDeployments,
  gameVersions,
  games,
  pcs,
} from "../../db/schema.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { publishToCafe } from "../realtime/service.js";

const createDeploymentSchema = z.object({
  game_id: z.string().uuid(),
  target_version_id: z.string().uuid(),
  master_pc_id: z.string().uuid(),
  pc_ids: z.array(z.string().uuid()).min(1),
  policy: z.record(z.unknown()).optional(),
});

async function validateDeploymentRefs(
  cafeId: string,
  input: z.infer<typeof createDeploymentSchema>,
): Promise<string[]> {
  const gameRows = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.id, input.game_id), eq(games.cafeId, cafeId)))
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
    .where(and(eq(pcs.id, input.master_pc_id), eq(pcs.cafeId, cafeId)))
    .limit(1);
  if (!masterRows[0]) throw problem(404, "Not Found", "PC_NOT_FOUND");

  const targetPcIds = [...new Set(input.pc_ids)];
  const pcRows = await db
    .select({ id: pcs.id })
    .from(pcs)
    .where(and(inArray(pcs.id, targetPcIds), eq(pcs.cafeId, cafeId)));
  if (pcRows.length !== targetPcIds.length) {
    throw problem(400, "Bad Request", "PC_NOT_IN_CAFE", "One or more target PCs are not in this cafe");
  }
  return targetPcIds;
}

function publishDeploymentTargets(
  cafeId: string,
  jobId: string,
  targets: Array<typeof gameDeploymentTargets.$inferSelect>,
): void {
  targets.map((target) =>
    publishToCafe(cafeId, {
      event: "deployment.updated",
      pc_id: target.pcId,
      data: {
        job_id: jobId,
        pc_id: target.pcId,
        target_state: target.state,
        progress_pct: target.progressPct,
      },
    }),
  );
}

export async function handleCreateDeployment(req: FastifyRequest) {
  const user = req.user!;
  const input = parseBody(createDeploymentSchema, req.body);
  const targetPcIds = await validateDeploymentRefs(user.cafe_id, input);

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

  publishDeploymentTargets(user.cafe_id, job.id, insertedTargets);

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
}
