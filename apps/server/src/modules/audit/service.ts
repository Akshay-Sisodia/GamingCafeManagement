import { uuidv7 } from "@gaming-cafe/shared";
import type { DbOrTx } from "../../db/index.js";
import { auditLogs } from "../../db/schema.js";

export interface AuditInput {
  cafeId?: string | null;
  actorType: "user" | "pc" | "system" | "customer" | "superadmin_local";
  actorId: string;
  actorRole?: string | null;
  action: string;
  source: "online" | "offline" | "local";
  pcId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
}

export async function writeAudit(dbClient: DbOrTx, input: AuditInput): Promise<void> {
  await dbClient
    .insert(auditLogs)
    .values({
      eventId: uuidv7(),
      cafeId: input.cafeId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      action: input.action,
      source: input.source,
      pcId: input.pcId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
    })
    .onConflictDoNothing();
}
