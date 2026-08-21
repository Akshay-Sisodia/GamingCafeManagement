/**
 * Offline reconciliation chaos suite (PRD §77).
 * Runs against a REAL Postgres+Redis (docker compose up + db:push required).
 * Skipped automatically when DATABASE_URL is not set.
 *
 *   pnpm --filter server test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import argon2 from "@node-rs/argon2";
import { eq, inArray } from "drizzle-orm";
import { buildServer } from "../api.js";
import { closeDb, db } from "../db/index.js";
import {
  auditLogs,
  cafes,
  deviceCredentials,
  gameDeploymentTargets,
  gameDeployments,
  notifications,
  offlineEvents,
  pairingCodes,
  pcCommands,
  pcConfigurations,
  pcGameInstallations,
  pcHealthSnapshots,
  pcs,
  reconciliationBatches,
  sessionEvents,
  sessions,
  superadminVerifiers,
  tenants,
  users,
} from "../db/schema.js";

const RUN = Boolean(process.env.DATABASE_URL);

let app: FastifyInstance;
let deviceToken: string;
let pcId: string;
let cafeId: string;
let adminToken: string;

/** FK-safe removal of every chaos-café row. Idempotent. */
async function cleanupChaos(): Promise<void> {
  const chaosCafes = await db.select({ id: cafes.id }).from(cafes)
    .innerJoin(tenants, eq(tenants.id, cafes.tenantId))
    .where(eq(tenants.name, "chaos-tenant"));
  for (const { id } of chaosCafes) {
    const cafeSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.cafeId, id));
    const sessionIds = cafeSessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await db.delete(sessionEvents).where(inArray(sessionEvents.sessionId, sessionIds));
    }
    await db.delete(offlineEvents).where(eq(offlineEvents.cafeId, id));
    await db.delete(pcCommands).where(eq(pcCommands.cafeId, id));
    await db.delete(auditLogs).where(eq(auditLogs.cafeId, id));
    await db.delete(notifications).where(eq(notifications.cafeId, id));

    const cafePcs = await db.select({ id: pcs.id }).from(pcs).where(eq(pcs.cafeId, id));
    for (const { id: pid } of cafePcs) {
      await db.delete(reconciliationBatches).where(eq(reconciliationBatches.pcId, pid));
      await db.delete(pcHealthSnapshots).where(eq(pcHealthSnapshots.pcId, pid));
      await db.delete(pcConfigurations).where(eq(pcConfigurations.pcId, pid));
      await db.delete(superadminVerifiers).where(eq(superadminVerifiers.pcId, pid));
      await db.delete(pcGameInstallations).where(eq(pcGameInstallations.pcId, pid));
      await db.delete(pairingCodes).where(eq(pairingCodes.pcId, pid));
      await db.delete(deviceCredentials).where(eq(deviceCredentials.pcId, pid));
      const targets = await db.select({ id: gameDeploymentTargets.id }).from(gameDeploymentTargets)
        .innerJoin(gameDeployments, eq(gameDeployments.id, gameDeploymentTargets.deploymentId))
        .where(eq(gameDeploymentTargets.pcId, pid));
      for (const t of targets) {
        await db.delete(gameDeploymentTargets).where(eq(gameDeploymentTargets.id, t.id));
      }
      await db.delete(gameDeployments).where(eq(gameDeployments.masterPcId, pid));
    }
    await db.delete(sessions).where(eq(sessions.cafeId, id));
    await db.delete(pcs).where(eq(pcs.cafeId, id));
    await db.delete(users).where(eq(users.cafeId, id));
    await db.delete(cafes).where(eq(cafes.id, id));
  }
  await db.delete(tenants).where(eq(tenants.name, "chaos-tenant"));
}

function uuidv7(): string {
  const ts = Date.now();
  const bytes = randomBytes(16);
  for (let i = 5; i >= 0; i--) bytes[i] = ((ts >>> ((5 - i) * 8)) & 0xff) as number;
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function envelope(seq: number, type: string, payload: Record<string, unknown>, eventId?: string) {
  return {
    event_id: eventId ?? uuidv7(),
    seq,
    type,
    occurred_at: new Date().toISOString(),
    payload,
  };
}

async function sync(events: unknown[], lastServerSeq = 0) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sync/events",
    headers: { authorization: `Bearer ${deviceToken}`, "x-pc-id": pcId },
    payload: { agent_version: "1.0.0", last_server_seq: lastServerSeq, events },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function loginAdmin(): Promise<Record<string, string>> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "chaos-owner@test.local", password: "Password123!" },
  });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().access_token}` };
}

async function startOnlineSession(minutes: number): Promise<string> {
  const adminH = await loginAdmin();

  // Defensive: end any session left active by a previous test.
  const current = await app.inject({
    method: "GET",
    url: `/v1/pcs/${pcId}/session`,
    headers: adminH,
  });
  const existing = current.json().session;
  if (existing?.id) {
    await app.inject({
      method: "POST",
      url: `/v1/sessions/${existing.id}/end`,
      headers: adminH,
      payload: { reason: "test_setup" },
    });
  }

  const started = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: adminH,
    payload: { pc_id: pcId, planned_minutes: minutes },
  });
  expect(started.statusCode).toBe(200);
  return started.json().session.id as string;
}

beforeAll(async () => {
  if (!RUN) return;
  app = buildServer();
  await app.ready();
  await cleanupChaos(); // remove leftovers from any earlier crashed run

  const [tenant] = await db.insert(tenants).values({ name: "chaos-tenant" }).returning();
  const [cafe] = await db
    .insert(cafes)
    .values({ tenantId: tenant!.id, name: "Chaos Café", timezone: "UTC", currency: "INR" })
    .returning();
  cafeId = cafe!.id;

  await db.insert(users).values({
    cafeId,
    email: "chaos-owner@test.local",
    passwordHash: await argon2.hash("Password123!"),
    role: "owner",
    name: "Chaos Owner",
  });

  const [pc] = await db
    .insert(pcs)
    .values({ cafeId, name: `CHAOS-${randomBytes(3).toString("hex")}`, status: "online" })
    .returning();
  pcId = pc!.id;

  deviceToken = randomBytes(32).toString("hex");
  await db
    .insert(deviceCredentials)
    .values({ pcId, tokenHash: createHash("sha256").update(deviceToken).digest("hex") });

  adminToken = (await loginAdmin()).authorization!;
});

afterAll(async () => {
  if (!RUN) return;
  await cleanupChaos();
  await app.close();
  await closeDb();
});

describe.skipIf(!RUN)("reconciliation chaos", () => {
  it("accepts an offline session start and creates the cloud session", async () => {
    const r = await sync([envelope(1, "SESSION_STARTED", { planned_minutes: 60 })]);
    expect(r.results[0].state).toBe("accepted");
    expect(r.results[0].session_id).toBeTruthy();
  });

  it("ends the offline session so later tests start clean", async () => {
    const r = await sync([envelope(2, "SESSION_ENDED", { reason: "cleanup" })]);
    expect(r.results[0].state).toBe("accepted");
  });

  it("returns duplicate for replayed events and never creates a second session", async () => {
    const before = await db.select().from(sessions).where(eq(sessions.cafeId, cafeId));
    const evt = envelope(3, "SESSION_STARTED", { planned_minutes: 30 });
    const first = await sync([evt]);
    expect(first.results[0].state).toBe("accepted");

    for (let i = 0; i < 10; i++) {
      const replay = await sync([{ ...evt }]);
      expect(replay.results[0].state).toBe("duplicate");
    }

    const after = await db.select().from(sessions).where(eq(sessions.cafeId, cafeId));
    expect(after.length).toBe(before.length + 1);

    // Leave a clean slate for the fuzz block.
    await sync([envelope(4, "SESSION_ENDED", { reason: "cleanup" })]);
  });

  it("fuzz: shuffled/duplicated START+END pairs converge without duplicates or conflicts", async () => {
    const before = await db.select().from(sessions).where(eq(sessions.cafeId, cafeId));

    // 25 sequential offline sessions: START(i), END(i+1). Duplicated 3x, shuffled.
    const events: Array<ReturnType<typeof envelope>> = [];
    let seq = 1000;
    for (let i = 0; i < 25; i++) {
      events.push(envelope(seq++, "SESSION_STARTED", { planned_minutes: 5 }));
      events.push(envelope(seq++, "SESSION_ENDED", { reason: "fuzz" }));
    }
    const noisy = events.flatMap((e) => [e, { ...e }, { ...e }]);
    for (let i = noisy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [noisy[i], noisy[j]] = [noisy[j]!, noisy[i]!]!;
    }

    const r = await sync(noisy);
    const accepted = r.results.filter((x: { state: string }) => x.state === "accepted").length;
    const duplicates = r.results.filter((x: { state: string }) => x.state === "duplicate").length;
    expect(accepted).toBe(50);
    expect(duplicates).toBe(100);
    expect(r.results.some((x: { state: string }) => x.state === "conflicted")).toBe(false);

    // Re-send everything — all duplicates.
    const r2 = await sync(noisy);
    expect(r2.results.every((x: { state: string }) => x.state === "duplicate")).toBe(true);

    const after = await db.select().from(sessions).where(eq(sessions.cafeId, cafeId));
    expect(after.length).toBe(before.length + 25); // exactly 25 new sessions
  });

  it("flags DUPLICATE_SESSION when offline start collides with active server session", async () => {
    await startOnlineSession(60);
    const r = await sync([envelope(2000, "SESSION_STARTED", { planned_minutes: 60 })]);
    expect(r.results[0].state).toBe("conflicted");
    expect(r.results[0].reason).toBe("DUPLICATE_SESSION");
  });

  it("rejects offline extension after the server ended the session", async () => {
    const sid = await startOnlineSession(15);
    const adminH = { authorization: adminToken };
    await app.inject({
      method: "POST",
      url: `/v1/sessions/${sid}/end`,
      headers: adminH,
      payload: { reason: "test" },
    });

    const r = await sync([envelope(3000, "SESSION_EXTENDED", { minutes: 30 })]);
    expect(r.results[0].state).toBe("conflicted");
    expect(r.results[0].reason).toBe("SESSION_ALREADY_ENDED");
  });

  it("offline end of an active session wins with occurred_at timestamp", async () => {
    const sid = await startOnlineSession(60);

    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const r = await sync([
      { ...envelope(4000, "SESSION_ENDED", { reason: "walkout" }), occurred_at: occurredAt },
    ]);
    expect(r.results[0].state).toBe("accepted");

    const row = (await db.select().from(sessions).where(eq(sessions.id, sid)))[0]!;
    expect(row.status).toBe("ended");
  });

  it("concurrent extend + end + cancel race resolves to exactly one terminal state, no 500s", async () => {
    const sid = await startOnlineSession(60);
    const adminH = { authorization: adminToken };

    const calls = [
      app.inject({ method: "POST", url: `/v1/sessions/${sid}/extend`, headers: adminH, payload: { minutes: 15 } }),
      app.inject({ method: "POST", url: `/v1/sessions/${sid}/end`, headers: adminH, payload: { reason: "race" } }),
      app.inject({ method: "POST", url: `/v1/sessions/${sid}/extend`, headers: adminH, payload: { minutes: 15 } }),
      app.inject({ method: "POST", url: `/v1/sessions/${sid}/cancel`, headers: adminH, payload: {} }),
    ];
    const results = await Promise.all(calls);

    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((c) => c >= 500)).toHaveLength(0);
    expect(statuses.filter((c) => c === 200 || c === 409).length).toBe(4);

    const row = (await db.select().from(sessions).where(eq(sessions.id, sid)))[0]!;
    expect(["ended", "cancelled"]).toContain(row.status);
  });

  it("command acks are idempotent", async () => {
    const cmd = await app.inject({
      method: "POST",
      url: `/v1/pcs/${pcId}/commands`,
      headers: { authorization: adminToken },
      payload: { type: "request_health", payload: {}, confirm: false },
    });
    expect(cmd.statusCode).toBe(200);
    const commandId = cmd.json().command.id as string;

    const ack = { authorization: `Bearer ${deviceToken}`, "x-pc-id": pcId };
    const a1 = await app.inject({
      method: "POST", url: `/v1/commands/${commandId}/ack`, headers: ack,
      payload: { status: "applied" },
    });
    const a2 = await app.inject({
      method: "POST", url: `/v1/commands/${commandId}/ack`, headers: ack,
      payload: { status: "applied" },
    });
    expect(a1.statusCode).toBe(200);
    expect(a2.statusCode).toBe(200);
  });
});
