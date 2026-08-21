import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import {
  handleExtendSession,
  handleListSessions,
  handlePcSession,
  handleSessionEvents,
  handleStartSession,
  makeTerminalTransitionHandler,
} from "./handlers.js";

export { getSessionOr404, loadPricingRules, publishSession, toSessionDto } from "./shared.js";

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sessions", { preHandler: requireUser(["owner", "manager", "staff"]) }, handleStartSession);
  app.post(
    "/sessions/:id/extend",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    handleExtendSession,
  );
  app.post(
    "/sessions/:id/end",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    makeTerminalTransitionHandler("ended", "SESSION_ENDED", "end"),
  );
  app.post(
    "/sessions/:id/cancel",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    makeTerminalTransitionHandler("cancelled", "SESSION_CANCELLED", "cancel"),
  );
  app.post(
    "/sessions/:id/pause",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    makeTerminalTransitionHandler("paused", "SESSION_PAUSED", "none"),
  );
  app.post(
    "/sessions/:id/resume",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    makeTerminalTransitionHandler("resumed", "SESSION_RESUMED", "none"),
  );
  app.get("/pcs/:id/session", { preHandler: requireUser() }, handlePcSession);
  app.get("/sessions/:id/events", { preHandler: requireUser() }, handleSessionEvents);
  app.get("/sessions", { preHandler: requireUser() }, handleListSessions);
}
