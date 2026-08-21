import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import {
  handleDashboard,
  handleFoodReport,
  handleSessionReport,
} from "./handlers.js";

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", { preHandler: requireUser() }, handleDashboard);
  app.get(
    "/reports/sessions",
    { preHandler: requireUser(["owner", "manager"]) },
    handleSessionReport,
  );
  app.get(
    "/reports/food",
    { preHandler: requireUser(["owner", "manager"]) },
    handleFoodReport,
  );
}
