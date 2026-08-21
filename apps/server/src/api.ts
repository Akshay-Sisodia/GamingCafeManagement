import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { registerErrorHandler } from "./lib/problem.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerPcRoutes } from "./modules/pcs/routes.js";
import { registerCommandRoutes } from "./modules/commands/routes.js";
import { registerSessionRoutes } from "./modules/sessions/routes.js";
import { registerSyncRoutes } from "./modules/sync/routes.js";
import { registerRealtimeRoutes } from "./modules/realtime/routes.js";
import { registerMenuRoutes } from "./modules/menu/routes.js";
import { registerOrderRoutes } from "./modules/orders/routes.js";
import { registerGameRoutes } from "./modules/games/routes.js";
import { registerCustomerRoutes } from "./modules/customers/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { registerPaymentRoutes } from "./modules/payments/routes.js";
import { registerNotificationRoutes } from "./modules/notifications/routes.js";
import { registerAuditRoutes } from "./modules/audit/routes.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  registerErrorHandler(app);

  void app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  app.register(registerAuthRoutes, { prefix: "/v1" });
  app.register(registerPcRoutes, { prefix: "/v1" });
  app.register(registerCommandRoutes, { prefix: "/v1" });
  app.register(registerSessionRoutes, { prefix: "/v1" });
  app.register(registerSyncRoutes, { prefix: "/v1" });
  app.register(registerRealtimeRoutes, { prefix: "/v1" });
  app.register(registerMenuRoutes, { prefix: "/v1" });
  app.register(registerOrderRoutes, { prefix: "/v1" });
  app.register(registerGameRoutes, { prefix: "/v1" });
  app.register(registerCustomerRoutes, { prefix: "/v1" });
  app.register(registerReportRoutes, { prefix: "/v1" });
  app.register(registerPaymentRoutes, { prefix: "/v1" });
  app.register(registerNotificationRoutes, { prefix: "/v1" });
  app.register(registerAuditRoutes, { prefix: "/v1" });

  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const app = buildServer();
  app
    .listen({ port: config.PORT, host: "0.0.0.0" })
    .then(() => app.log.info(`api listening on :${config.PORT}`))
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });

  // Single-service deployments (e.g. Koyeb free tier): run BullMQ workers
  // in-process instead of a separate worker deployable.
  if (config.SINGLE_PROCESS) {
    const { startWorker } = await import("./worker.js");
    await startWorker();
    app.log.info("single-process mode: workers started alongside api");
  }
}
