import type { CommandDto, CommandType } from "@gaming-cafe/shared";
import { db } from "../../db/index.js";
import { pcCommands } from "../../db/schema.js";
import { publishToCafe } from "../realtime/service.js";

export function toCommandDto(row: typeof pcCommands.$inferSelect): CommandDto {
  return {
    id: row.id,
    pc_id: row.pcId,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    issued_at: row.issuedAt.toISOString(),
  };
}

/** Persists and SSE-publishes a PC command (used by session transitions and the admin API). */
export async function issuePcCommand(args: {
  cafeId: string;
  pcId: string;
  type: CommandType;
  payload?: Record<string, unknown>;
  issuedBy: string;
  confirmedBy?: string | null;
  requiresConfirm?: boolean;
}): Promise<typeof pcCommands.$inferSelect> {
  const now = new Date();
  const inserted = await db
    .insert(pcCommands)
    .values({
      cafeId: args.cafeId,
      pcId: args.pcId,
      type: args.type,
      payload: args.payload ?? {},
      requiresConfirm: args.requiresConfirm ?? false,
      confirmedBy: args.confirmedBy ?? null,
      status: "pending",
      issuedBy: args.issuedBy,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    })
    .returning();
  const cmd = inserted[0]!;

  publishToCafe(args.cafeId, {
    event: "command",
    pc_id: args.pcId,
    data: toCommandDto(cmd),
  });
  return cmd;
}
