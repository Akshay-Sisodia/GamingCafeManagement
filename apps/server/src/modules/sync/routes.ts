import type { FastifyInstance } from "fastify";
import { requireDevice, requireUser } from "../../auth/guards.js";
import {
  handleResolveSyncConflict,
  handleSyncBatches,
  handleSyncConflicts,
  handleSyncEvents,
} from "./handlers.js";

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sync/events", { preHandler: requireDevice() }, handleSyncEvents);
  app.get(
    "/sync/conflicts",
    { preHandler: requireUser(["owner", "manager"]) },
    handleSyncConflicts,
  );
  app.post(
    "/sync/conflicts/:id/resolve",
    { preHandler: requireUser(["owner", "manager"]) },
    handleResolveSyncConflict,
  );
  app.get("/sync/batches", { preHandler: requireUser(["owner", "manager"]) }, handleSyncBatches);
}
