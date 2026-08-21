import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/guards.js";
import {
  handleCreateMenuCategory,
  handleCreateMenuItem,
  handleDeleteMenuItem,
  handleGetMenu,
  handlePatchMenuItem,
} from "./handlers.js";

export async function registerMenuRoutes(app: FastifyInstance): Promise<void> {
  app.get("/menu", { preHandler: requireUser() }, handleGetMenu);
  app.post(
    "/menu/categories",
    { preHandler: requireUser(["owner", "manager"]) },
    handleCreateMenuCategory,
  );
  app.post(
    "/menu/items",
    { preHandler: requireUser(["owner", "manager"]) },
    handleCreateMenuItem,
  );
  app.patch(
    "/menu/items/:id",
    { preHandler: requireUser(["owner", "manager"]) },
    handlePatchMenuItem,
  );
  app.delete(
    "/menu/items/:id",
    { preHandler: requireUser(["owner", "manager"]) },
    handleDeleteMenuItem,
  );
}
