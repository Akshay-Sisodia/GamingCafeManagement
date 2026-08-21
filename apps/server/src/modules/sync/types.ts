import type { syncBatchSchema } from "@gaming-cafe/shared";
import type { db } from "../../db/index.js";
import type { pcs, pricingRules } from "../../db/schema.js";
import type { PricingRuleInput } from "../sessions/pricing.js";

export type SyncEvent = (typeof syncBatchSchema)["_output"]["events"][number];
export type SyncTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SyncContext {
  cafeId: string;
  pcId: string;
  batchId: string;
  pc: typeof pcs.$inferSelect;
  pricingRules: PricingRuleInput[];
}
