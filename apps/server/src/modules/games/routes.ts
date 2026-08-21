import type { FastifyInstance } from "fastify";
import { requireDevice, requireUser } from "../../auth/guards.js";
import { handleCreateDeployment } from "./deployment.js";
import {
  handleAgentDeploymentsActive,
  handleCreateGame,
  handleCreateGameVersion,
  handleDeploymentTargetComplete,
  handleDeploymentTargetFail,
  handleDeploymentTargetProgress,
  handleListDeployments,
  handleListGames,
  handlePatchGame,
  handlePauseDeploymentTarget,
  handleResumeDeploymentTarget,
} from "./handlers.js";

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get("/games", { preHandler: requireUser() }, handleListGames);
  app.post("/games", { preHandler: requireUser(["owner", "manager"]) }, handleCreateGame);
  app.patch("/games/:id", { preHandler: requireUser(["owner", "manager"]) }, handlePatchGame);
  app.post(
    "/games/:id/versions",
    { preHandler: requireUser(["owner", "manager"]) },
    handleCreateGameVersion,
  );
  app.get("/deployments", { preHandler: requireUser() }, handleListDeployments);
  app.post("/deployments", { preHandler: requireUser(["owner", "manager"]) }, handleCreateDeployment);
  app.post(
    "/deployment-targets/:id/pause",
    { preHandler: requireUser(["owner", "manager"]) },
    handlePauseDeploymentTarget,
  );
  app.post(
    "/deployment-targets/:id/resume",
    { preHandler: requireUser(["owner", "manager"]) },
    handleResumeDeploymentTarget,
  );
  app.get(
    "/agent/deployments/active",
    { preHandler: requireDevice() },
    handleAgentDeploymentsActive,
  );
  app.post(
    "/deployments/:jobId/targets/:pcId/progress",
    { preHandler: requireDevice() },
    handleDeploymentTargetProgress,
  );
  app.post(
    "/deployments/:jobId/targets/:pcId/complete",
    { preHandler: requireDevice() },
    handleDeploymentTargetComplete,
  );
  app.post(
    "/deployments/:jobId/targets/:pcId/fail",
    { preHandler: requireDevice() },
    handleDeploymentTargetFail,
  );
}
