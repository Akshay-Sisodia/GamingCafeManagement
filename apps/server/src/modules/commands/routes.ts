import type { FastifyInstance } from "fastify";
import { requireDevice, requireUser } from "../../auth/guards.js";
import {
  handleCommandAck,
  handleIssueCommand,
  handleListPcCommands,
} from "./handlers.js";

export async function registerCommandRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/pcs/:id/commands",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    handleIssueCommand,
  );
  app.post("/commands/:id/ack", { preHandler: requireDevice() }, handleCommandAck);
  app.get("/pcs/:id/commands", { preHandler: requireUser() }, handleListPcCommands);
}
