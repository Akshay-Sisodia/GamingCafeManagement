/**
 * Deletes a PC and all child rows. Usage:
 *   pnpm --filter server exec tsx src/db/delete-pc.ts <pc-id>
 */
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "./index.js";
import {
  auditLogs,
  deviceCredentials,
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
} from "./schema.js";

const pcId = process.argv[2];
if (!pcId) {
  console.error("usage: tsx src/db/delete-pc.ts <pc-id>");
  process.exit(1);
}

await db.delete(reconciliationBatches).where(eq(reconciliationBatches.pcId, pcId));
await db.delete(auditLogs).where(eq(auditLogs.pcId, pcId));

const pcSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.pcId, pcId));
const sessionIds = pcSessions.map((s) => s.id);
if (sessionIds.length > 0) {
  await db.delete(sessionEvents).where(inArray(sessionEvents.sessionId, sessionIds));
}
await db.delete(sessions).where(eq(sessions.pcId, pcId));

await db.delete(pcHealthSnapshots).where(eq(pcHealthSnapshots.pcId, pcId));
await db.delete(pcConfigurations).where(eq(pcConfigurations.pcId, pcId));
await db.delete(superadminVerifiers).where(eq(superadminVerifiers.pcId, pcId));
await db.delete(pcGameInstallations).where(eq(pcGameInstallations.pcId, pcId));
await db.delete(offlineEvents).where(eq(offlineEvents.pcId, pcId));
await db.delete(pcCommands).where(eq(pcCommands.pcId, pcId));
await db.delete(pairingCodes).where(eq(pairingCodes.pcId, pcId));
await db.delete(deviceCredentials).where(eq(deviceCredentials.pcId, pcId));
await db.delete(pcs).where(eq(pcs.id, pcId));

console.log(`deleted pc ${pcId}`);
await closeDb();
process.exit(0);
