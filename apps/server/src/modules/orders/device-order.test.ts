import { describe, expect, it } from "vitest";
import { createOrderSchema } from "@gaming-cafe/shared";

/** ponytail: guard device order body shape used by POST /v1/agent/orders */
describe("device order body", () => {
  it("accepts launcher items without staff-only fields", () => {
    const parsed = createOrderSchema.parse({
      source: "launcher",
      pc_id: "550e8400-e29b-41d4-a716-446655440000",
      items: [{ menu_item_id: "550e8400-e29b-41d4-a716-446655440001", qty: 2 }],
    });
    expect(parsed.items[0]?.qty).toBe(2);
  });
});
