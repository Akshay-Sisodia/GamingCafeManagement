import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import {
  handleDeviceEnroll,
  handleDevicePair,
  handleEnrollToken,
  handleLogin,
  handleMe,
  handlePairingCode,
  handleRefresh,
} from "./handlers.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", handleLogin);
  app.post("/auth/refresh", handleRefresh);
  app.post("/auth/devices/pair", handleDevicePair);
  app.post(
    "/pcs/:id/pairing-code",
    { preHandler: requireUser(["owner", "manager"]) },
    handlePairingCode,
  );
  app.get("/me", { preHandler: requireUser() }, handleMe);
  app.post(
    "/auth/enroll-tokens",
    { preHandler: requireUser(["owner", "manager"]) },
    handleEnrollToken,
  );
  app.post("/auth/devices/enroll", handleDeviceEnroll);
}
