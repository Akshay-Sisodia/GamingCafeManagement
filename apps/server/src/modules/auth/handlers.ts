import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import {
  loginSchema,
  pairDeviceSchema,
  type PairDeviceResponse,
} from "@gaming-cafe/shared";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
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
  sha256Hex,
  signAccessToken,
  signRefreshToken,
  signSseToken,
  verifyJwt,
} from "../../auth/guards.js";
import { parseBody, problem } from "../../lib/problem.js";
import { checkRateLimit, failRateLimit, resetRateLimit, retryAfterSeconds } from "../../lib/rate-limit.js";
import { writeAudit } from "../audit/service.js";

export async function handleLogin(req: FastifyRequest) {
  const input = parseBody(loginSchema, req.body);
  const rateKey = `login:${input.email.toLowerCase()}`;
  if (!checkRateLimit(rateKey)) {
    throw problem(429, "Too Many Requests", "LOGIN_RATE_LIMITED", `retry after ${retryAfterSeconds(rateKey)}s`);
  }

  const rows = await db
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${input.email.toLowerCase()}`, eq(users.status, "active")))
    .limit(2);
  const user = rows[0];
  if (!user || rows.length > 1) {
    failRateLimit(rateKey);
    throw problem(401, "Unauthorized", "INVALID_CREDENTIALS");
  }
  const ok = await verify(user.passwordHash, input.password);
  if (!ok) {
    failRateLimit(rateKey);
    throw problem(401, "Unauthorized", "INVALID_CREDENTIALS");
  }

  resetRateLimit(rateKey);

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
}

export async function handleRefresh(req: FastifyRequest) {
  const body = parseBody(z.object({ refresh_token: z.string().min(10) }), req.body);
  const claims = await verifyJwt(body.refresh_token);
  if (claims.typ !== "refresh") throw problem(401, "Unauthorized", "WRONG_TOKEN_TYPE");

  const userRows = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") throw problem(401, "Unauthorized", "USER_INACTIVE");

  const base = { sub: claims.sub, cafe_id: claims.cafe_id, role: claims.role, email: claims.email };
  return {
    access_token: await signAccessToken(base),
    refresh_token: await signRefreshToken(base),
  };
}

export async function handleSseToken(req: FastifyRequest) {
  const user = req.user!;
  const base = { sub: user.sub, cafe_id: user.cafe_id, role: user.role, email: user.email };
  const token = await signSseToken(base);
  return { sse_token: token, expires_in: 300 };
}

export async function handleDevicePair(req: FastifyRequest) {
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
}

export async function handlePairingCode(req: FastifyRequest) {
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
}

export async function handleMe(req: FastifyRequest) {
  const user = req.user!;
  return { user };
}

export async function handleEnrollToken(req: FastifyRequest) {
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
  return { token: plaintext };
}

export async function handleDeviceEnroll(req: FastifyRequest) {
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
    const taken = await db
      .select({ name: pcs.name })
      .from(pcs)
      .where(eq(pcs.cafeId, cafeId))
      .limit(500);
    const names = new Set(taken.map((t) => t.name.toLowerCase()));
    if (names.has(name.toLowerCase())) {
      let i = 2;
      while (names.has(`${name}-${i}`.toLowerCase())) i++;
      name = `${name}-${i}`;
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
}
