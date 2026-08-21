import { and, eq, isNull, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import {
  loginSchema,
  pairDeviceSchema,
  type PairDeviceResponse,
} from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import {
  deviceCredentials,
  pairingCodes,
  pcConfigurations,
  pcs,
  users,
} from "../../db/schema.js";
import {
  generateDeviceToken,
  generatePairingCode,
  requireUser,
  sha256Hex,
  signAccessToken,
  signRefreshToken,
  verifyJwt,
} from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { writeAudit } from "../audit/service.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/login", async (req) => {
    const input = parseBody(loginSchema, req.body);
    const rows = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${input.email.toLowerCase()}`, eq(users.status, "active")))
      .limit(2);
    const user = rows[0];
    if (!user || rows.length > 1) throw problem(401, "Unauthorized", "INVALID_CREDENTIALS");
    const ok = await verify(user.passwordHash, input.password);
    if (!ok) throw problem(401, "Unauthorized", "INVALID_CREDENTIALS");

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await writeAudit(db, {
      cafeId: user.cafeId,
      actorType: "user",
      actorId: user.id,
      actorRole: user.role,
      action: "ADMIN_LOGIN",
      source: "online",
    });

    const claims = {
      sub: user.id,
      cafe_id: user.cafeId,
      role: user.role,
      email: user.email,
    };
    return {
      access_token: await signAccessToken(claims),
      refresh_token: await signRefreshToken(claims),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        cafe_id: user.cafeId,
      },
    };
  });

  app.post("/auth/refresh", async (req) => {
    const body = parseBody(z.object({ refresh_token: z.string().min(10) }), req.body);
    const claims = await verifyJwt(body.refresh_token);
    if (claims.typ !== "refresh") throw problem(401, "Unauthorized", "WRONG_TOKEN_TYPE");
    const base = { sub: claims.sub, cafe_id: claims.cafe_id, role: claims.role, email: claims.email };
    return {
      access_token: await signAccessToken(base),
      refresh_token: await signRefreshToken(base),
    };
  });

  app.post("/auth/devices/pair", async (req) => {
    const input = parseBody(pairDeviceSchema, req.body);
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const codeRows = await tx
        .select({ code: pairingCodes, pc: pcs })
        .from(pairingCodes)
        .innerJoin(pcs, eq(pcs.id, pairingCodes.pcId))
        .where(
          and(
            eq(pairingCodes.code, input.pairing_code),
            isNull(pairingCodes.usedAt),
            sql`${pairingCodes.expiresAt} > now()`,
          ),
        )
        .limit(1);
      const row = codeRows[0];
      if (!row) throw problem(401, "Unauthorized", "INVALID_PAIRING_CODE");

      await tx.update(pairingCodes).set({ usedAt: now }).where(eq(pairingCodes.id, row.code.id));

      const deviceToken = generateDeviceToken();
      await tx
        .insert(deviceCredentials)
        .values({
          pcId: row.pc.id,
          tokenHash: sha256Hex(deviceToken),
          pairedAt: now,
          revokedAt: null,
        })
        .onConflictDoUpdate({
          target: deviceCredentials.pcId,
          set: { tokenHash: sha256Hex(deviceToken), pairedAt: now, revokedAt: null },
        });

      await tx
        .update(pcs)
        .set({ hardwareFingerprint: input.hardware_fingerprint, agentVersion: input.agent_version })
        .where(eq(pcs.id, row.pc.id));

      const configRows = await tx
        .select({ version: pcConfigurations.version })
        .from(pcConfigurations)
        .where(eq(pcConfigurations.pcId, row.pc.id))
        .orderBy(sql`${pcConfigurations.version} desc`)
        .limit(1);

      return { pc: row.pc, deviceToken, configVersion: configRows[0]?.version ?? 0 };
    });

    await writeAudit(db, {
      cafeId: result.pc.cafeId,
      actorType: "pc",
      actorId: result.pc.id,
      action: "DEVICE_PAIRED",
      source: "online",
      pcId: result.pc.id,
    });

    const response: PairDeviceResponse = {
      pc_id: result.pc.id,
      device_token: result.deviceToken,
      server_time_ms: Date.now(),
      config_version: result.configVersion,
    };
    return response;
  });

  app.post(
    "/pcs/:id/pairing-code",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const pcId = (req.params as { id: string }).id;
      const pcRows = await db
        .select()
        .from(pcs)
        .where(and(eq(pcs.id, pcId), eq(pcs.cafeId, user.cafe_id)))
        .limit(1);
      const pc = pcRows[0];
      if (!pc) throw problem(404, "Not Found", "PC_NOT_FOUND");

      const code = generatePairingCode();
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      await db.insert(pairingCodes).values({ pcId: pc.id, code, expiresAt });
      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "PAIRING_CODE_CREATED",
        source: "online",
        pcId: pc.id,
      });
      return { code, expires_at: expiresAt.toISOString(), pc_id: pc.id };
    },
  );

  app.get("/me", { preHandler: requireUser() }, async (req) => {
    const user = req.user!;
    return { user };
  });
}
