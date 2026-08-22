import type { FastifyInstance } from "fastify";
import { requireDevice, requireUser } from "../../auth/guards.js";
import {
  handleAgentBootstrap,
  handleAgentConfig,
  handleAgentHealth,
  handleAgentTimeCheck,
  handleCreatePc,
  handleGetPc,
  handleListPcs,
  handlePatchPc,
  handlePcHealthLatest,
  handleSuperadminVerify,
} from "./handlers.js";
import { handleAgentGetMenu } from "../menu/handlers.js";
import { handleCreateOrderFromDevice } from "../orders/handlers.js";

export async function registerPcRoutes(app: FastifyInstance): Promise<void> {
  app.get("/pcs", { preHandler: requireUser() }, handleListPcs);
  app.get("/pcs/:id", { preHandler: requireUser() }, handleGetPc);
  app.post("/pcs", { preHandler: requireUser(["owner", "manager"]) }, handleCreatePc);
  app.patch("/pcs/:id", { preHandler: requireUser(["owner", "manager"]) }, handlePatchPc);
  app.post("/agent/health", { preHandler: requireDevice() }, handleAgentHealth);
  app.get("/pcs/:id/health/latest", { preHandler: requireUser() }, handlePcHealthLatest);
  app.get("/agent/bootstrap", { preHandler: requireDevice() }, handleAgentBootstrap);
  app.get("/agent/config", { preHandler: requireDevice() }, handleAgentConfig);
  app.get("/agent/time-check", { preHandler: requireDevice() }, handleAgentTimeCheck);
  app.get("/agent/menu", { preHandler: requireDevice() }, handleAgentGetMenu);
  app.post("/agent/orders", { preHandler: requireDevice() }, handleCreateOrderFromDevice);
  app.post(
    "/pcs/:id/superadmin/verify",
    { preHandler: requireDevice() },
    handleSuperadminVerify,
  );
}
