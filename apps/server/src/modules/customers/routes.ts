import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import {
  handleCreateCustomer,
  handleGetCustomer,
  handleListCustomers,
} from "./handlers.js";

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/customers", { preHandler: requireUser() }, handleListCustomers);
  app.post(
    "/customers",
    { preHandler: requireUser(["owner", "manager", "staff"]) },
    handleCreateCustomer,
  );
  app.get("/customers/:id", { preHandler: requireUser() }, handleGetCustomer);
}
