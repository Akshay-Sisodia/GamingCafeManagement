import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import {
  loginSchema,
  pairDeviceSchema,
  type PairDeviceResponse,
} from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "../../db/index.js";
import {
  cafeEnrollmentTokens,
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

  // ---- Zero-touch enrollment (docs: rollout without scripts) ----------------
  // Owner generates a cafe-level token; every agent installed with it
  // self-registers a PC row named after its hostname.

  app.post(
    "/auth/enroll-tokens",
    { preHandler: requireUser(["owner", "manager"]) },
    async (req) => {
      const user = req.user!;
      const input = parseBody(
        z.object({ label: z.string().max(60).optional() }),
        req.body ?? {},
      );
      const plaintext = randomBytes(24).toString("base64url");
      await db.insert(cafeEnrollmentTokens).values({
        cafeId: user.cafe_id,
        label: input.label ?? "rollout",
        tokenHash: sha256Hex(plaintext),
      });
      await writeAudit(db, {
        cafeId: user.cafe_id,
        actorType: "user",
        actorId: user.sub,
        actorRole: user.role,
        action: "ENROLL_TOKEN_CREATED",
        source: "online",
      });
      // Plaintext is shown exactly once — only its hash is stored.
      return { token: plaintext };
    },
  );

  app.post("/auth/devices/enroll", async (req) => {
    const input = parseBody(
      z.object({
        enroll_token: z.string().min(16),
        hostname: z.string().min(1).max(40),
        hardware_fingerprint: z.string().min(8).max(128),
        agent_version: z.string(),
      }),
      req.body,
    );

    const tokenRows = await db
      .select()
      .from(cafeEnrollmentTokens)
      .where(
        and(
          eq(cafeEnrollmentTokens.tokenHash, sha256Hex(input.enroll_token)),
          eq(cafeEnrollmentTokens.active, true),
        ),
      )
      .limit(1);
    const token = tokenRows[0];
    if (!token) throw problem(401, "Unauthorized", "INVALID_ENROLL_TOKEN");
    const cafeId = token.cafeId;

    // Re-enrollment of a known machine keeps the same PC row.
    const known = await db
      .select({ id: pcs.id })
      .from(pcs)
      .where(and(eq(pcs.cafeId, cafeId), eq(pcs.hardwareFingerprint, input.hardware_fingerprint)))
      .limit(1);

    let pcId: string;
    let name = input.hostname.trim();

    if (known[0]) {
      pcId = known[0].id;
      await db.update(pcs).set({ name, agentVersion: input.agent_version }).where(eq(pcs.id, pcId));
    } else {
      // Fresh machine — pick a unique name (hostname, hostname-2, …).
      const taken = await db
        .select({ name: pcs.name })
        .from(pcs)
        .where(eq(pcs.cafeId, cafeId));
      const names = new Set(taken.map((t) => t.name.toLowerCase()));
      if (names.has(name.toLowerCase())) {
        for (let i = 2; ; i++) {
          if (!names.has(`${name}-${i}`.toLowerCase())) {
            name = `${name}-${i}`;
            break;
          }
        }
      }
      const insertedPc = await db
        .insert(pcs)
        .values({
          cafeId,
          name,
          hardwareFingerprint: input.hardware_fingerprint,
          agentVersion: input.agent_version,
          status: "online",
        })
        .returning();
      pcId = insertedPc[0]!.id;
      await db.insert(pcConfigurations).values({ pcId, version: 1, config: {} });
    }

    // Rotate credentials (revoke old, issue fresh).
    await db
      .update(deviceCredentials)
      .set({ revokedAt: new Date() })
      .where(eq(deviceCredentials.pcId, pcId));
    const deviceToken = generateDeviceToken();
    await db.insert(deviceCredentials).values({
      pcId,
      tokenHash: sha256Hex(deviceToken),
    });

    await writeAudit(db, {
      cafeId,
      actorType: "pc",
      actorId: pcId,
      action: "DEVICE_ENROLLED",
      source: "online",
      pcId,
      metadata: { hostname: input.hostname, agent_version: input.agent_version },
    });

    return {
      pc_id: pcId,
      device_token: deviceToken,
      server_time_ms: Date.now(),
      config_version: 0,
    } satisfies PairDeviceResponse;
  });
}
