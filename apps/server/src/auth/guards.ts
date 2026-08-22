import { createHash, randomBytes, randomInt } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { StaffRole } from "@gaming-cafe/shared";
import { db } from "../db/index.js";
import { deviceCredentials, pcs } from "../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { problem } from "../lib/problem.js";

export interface UserClaims {
  sub: string;
  cafe_id: string;
  role: StaffRole;
  email: string;
  typ: "access" | "refresh" | "sse";
}

export interface DevicePrincipal {
  pc_id: string;
  cafe_id: string;
  name: string;
  tier_id: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: UserClaims;
    device?: DevicePrincipal;
  }
}

const secret = new TextEncoder().encode(config.JWT_SECRET);

export async function signAccessToken(claims: Omit<UserClaims, "typ">): Promise<string> {
  return new SignJWT({ ...claims, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function signRefreshToken(claims: Omit<UserClaims, "typ">): Promise<string> {
  return new SignJWT({ ...claims, typ: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function signSseToken(claims: Omit<UserClaims, "typ">): Promise<string> {
  return new SignJWT({ ...claims, typ: "sse" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<UserClaims> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.cafe_id !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.typ !== "string"
    ) {
      throw new Error("bad claims");
    }
    return {
      sub: payload.sub,
      cafe_id: payload.cafe_id,
      role: payload.role as StaffRole,
      email: typeof payload.email === "string" ? payload.email : "",
      typ: payload.typ as "access" | "refresh" | "sse",
    };
  } catch {
    throw problem(401, "Unauthorized", "INVALID_TOKEN");
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function generatePairingCode(): string {
  const alphabet = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const query = req.query as Record<string, unknown> | undefined;
  if (query && typeof query.token === "string" && query.token.length > 0) {
    return query.token;
  }
  return null;
}

async function authenticateUser(req: FastifyRequest): Promise<UserClaims> {
  const token = extractToken(req);
  if (!token) throw problem(401, "Unauthorized", "MISSING_TOKEN");
  const claims = await verifyJwt(token);
  if (claims.typ !== "access") throw problem(401, "Unauthorized", "WRONG_TOKEN_TYPE");
  return claims;
}

export function requireUser(roles?: StaffRole[]) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const claims = await authenticateUser(req);
    if (roles && roles.length > 0 && !roles.includes(claims.role)) {
      throw problem(403, "Forbidden", "ROLE_NOT_ALLOWED");
    }
    req.user = claims;
  };
}

async function loadDeviceByToken(token: string): Promise<DevicePrincipal> {
  const rows = await db
    .select({
      pcId: pcs.id,
      cafeId: pcs.cafeId,
      name: pcs.name,
      tierId: pcs.tierId,
    })
    .from(deviceCredentials)
    .innerJoin(pcs, eq(pcs.id, deviceCredentials.pcId))
    .where(and(eq(deviceCredentials.tokenHash, sha256Hex(token)), isNull(deviceCredentials.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw problem(401, "Unauthorized", "INVALID_DEVICE_TOKEN");
  return { pc_id: row.pcId, cafe_id: row.cafeId, name: row.name, tier_id: row.tierId };
}

export function requireDevice() {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = extractToken(req);
    if (!token) throw problem(401, "Unauthorized", "MISSING_TOKEN");
    const principal = await loadDeviceByToken(token);
    const headerPcId = req.headers["x-pc-id"];
    if (typeof headerPcId !== "string" || headerPcId !== principal.pc_id) {
      throw problem(401, "Unauthorized", "PC_ID_MISMATCH");
    }
    req.device = principal;
  };
}

export async function requireDeviceForSse(req: FastifyRequest): Promise<DevicePrincipal> {
  const token = extractToken(req);
  if (!token) throw problem(401, "Unauthorized", "MISSING_TOKEN");
  return loadDeviceByToken(token);
}

export async function requireUserForSse(req: FastifyRequest): Promise<UserClaims> {
  const token = extractToken(req);
  if (!token) throw problem(401, "Unauthorized", "MISSING_TOKEN");
  const claims = await verifyJwt(token);
  if (claims.typ === "sse") return claims;
  if (claims.typ !== "access") throw problem(401, "Unauthorized", "WRONG_TOKEN_TYPE");
  return claims;
}
