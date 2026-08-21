import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import { handleCreateOrder, handleListOrders, handleOrderTransition } from "./handlers.js";

const ORDER_ROLES = ["owner", "manager", "staff", "kitchen"] as const;

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/orders", { preHandler: requireUser([...ORDER_ROLES]) }, handleCreateOrder);
  app.post("/orders/:id/accept", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "accepted"),
  );
  app.post("/orders/:id/prepare", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "preparing"),
  );
  app.post("/orders/:id/ready", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "ready"),
  );
  app.post("/orders/:id/deliver", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "delivered"),
  );
  app.post("/orders/:id/complete", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "completed"),
  );
  app.post("/orders/:id/cancel", { preHandler: requireUser([...ORDER_ROLES]) }, (req) =>
    handleOrderTransition(req, "cancelled"),
  );
  app.get("/orders", { preHandler: requireUser() }, handleListOrders);
}
