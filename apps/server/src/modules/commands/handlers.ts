import { and, desc, eq } from "drizzle-orm";
import {
  DANGEROUS_COMMANDS,
  commandAckSchema,
  issueCommandSchema,
} from "@gaming-cafe/shared";
import type { FastifyRequest } from "fastify";
import { db } from "../../db/index.js";
import { pcCommands, pcs } from "../../db/schema.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";
import { issuePcCommand, toCommandDto } from "./issue.js";

export async function handleIssueCommand(req: FastifyRequest) {
  const user = req.user!;
  const pcId = (req.params as { id: string }).id;
  const input = parseBody(issueCommandSchema, req.body);

  const pcRows = await db
    .select()
    .from(pcs)
    .where(and(eq(pcs.id, pcId), eq(pcs.cafeId, user.cafe_id)))
    .limit(1);
  const pc = pcRows[0];
  if (!pc) throw problem(404, "Not Found", "PC_NOT_FOUND");

  const dangerous = (DANGEROUS_COMMANDS as readonly string[]).includes(input.type);
  if (dangerous && !input.confirm) {
    throw problem(
      400,
      "Bad Request",
      "CONFIRMATION_REQUIRED",
      `Command ${input.type} requires confirm:true`,
    );
  }

  const cmd = await issuePcCommand({
    cafeId: user.cafe_id,
    pcId: pc.id,
    type: input.type,
    payload: input.payload,
    issuedBy: user.sub,
    confirmedBy: dangerous ? user.sub : null,
    requiresConfirm: dangerous,
  });

  await writeAudit(db, {
    cafeId: user.cafe_id,
    actorType: "user",
    actorId: user.sub,
    actorRole: user.role,
    action: "COMMAND_ISSUED",
    source: "online",
    pcId: pc.id,
    entityType: "command",
    entityId: cmd.id,
    metadata: { type: input.type },
  });

  return { command: toCommandDto(cmd) };
}

export async function handleCommandAck(req: FastifyRequest) {
  const device = req.device!;
  const id = (req.params as { id: string }).id;
  const input = parseBody(commandAckSchema, req.body);

  const rows = await db.select().from(pcCommands).where(eq(pcCommands.id, id)).limit(1);
  const cmd = rows[0];
  if (!cmd || cmd.pcId !== device.pc_id) throw problem(404, "Not Found", "COMMAND_NOT_FOUND");

  if (cmd.status === "pending" || cmd.status === "sent") {
    const updated = await db
      .update(pcCommands)
      .set({
        status: input.status,
        ackedAt: new Date(),
        deliveredAt: cmd.deliveredAt ?? new Date(),
        ackPayload: { code: input.code ?? null, detail: input.detail ?? null },
      })
      .where(eq(pcCommands.id, id))
      .returning();
    const next = updated[0]!;
    await writeAudit(db, {
      cafeId: cmd.cafeId,
      actorType: "pc",
      actorId: device.pc_id,
      action: input.status === "applied" ? "COMMAND_APPLIED" : "COMMAND_FAILED",
      source: "online",
      pcId: device.pc_id,
      entityType: "command",
      entityId: id,
      metadata: { type: cmd.type, code: input.code ?? null },
    });
    return { command: toCommandDto(next) };
  }

  return { command: toCommandDto(cmd) };
}

export async function handleListPcCommands(req: FastifyRequest) {
  const user = req.user!;
  const pcId = (req.params as { id: string }).id;
  const query = req.query as { limit?: string };
  const limit = Math.min(Number.parseInt(query.limit ?? "50", 10) || 50, 200);
  const rows = await db
    .select()
    .from(pcCommands)
    .where(and(eq(pcCommands.pcId, pcId), eq(pcCommands.cafeId, user.cafe_id)))
    .orderBy(desc(pcCommands.issuedAt))
    .limit(limit);
  return { commands: rows.map(toCommandDto) };
}
