/**
 * One-off: removes all seed/demo data from a café, leaving org structure,
 * users, tiers and pricing rules intact.
 *
 *   DATABASE_URL=… pnpm --filter server exec tsx src/db/wipe-demo.ts
 */
import { eq, inArray } from "drizzle-orm";
import { db, closeDb } from "./index.js";
import {
  auditLogs,
  cafes,
  customers,
  deviceCredentials,
  gameDeploymentTargets,
  gameDeployments,
  gameVersions,
  games,
  menuCategories,
  menuItems,
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
} from "./schema.js";

async function wipe(): Promise<void> {
  const allCafes = await db.select({ id: cafes.id }).from(cafes);
  const cafeIds = allCafes.map((c) => c.id);
  if (cafeIds.length === 0) {
    console.log("nothing to wipe");
    return;
  }

  const allPcs = await db.select({ id: pcs.id }).from(pcs);
  const pcIds = allPcs.map((p) => p.id);
  const allSessions = await db.select({ id: sessions.id }).from(sessions);
  const sessionIds = allSessions.map((s) => s.id);

  if (sessionIds.length > 0)
    await db.delete(sessionEvents).where(inArray(sessionEvents.sessionId, sessionIds));
  await db.delete(sessions);
  await db.delete(offlineEvents);
  await db.delete(pcCommands);
  await db.delete(reconciliationBatches);
  await db.delete(notifications);
  await db.delete(auditLogs);

  const gameRows = await db.select({ id: games.id }).from(games);
  const gameIds = gameRows.map((g) => g.id);

  await db.delete(gameDeploymentTargets);
  await db.delete(gameDeployments);
  if (gameIds.length > 0) await db.delete(pcGameInstallations).where(inArray(pcGameInstallations.gameId, gameIds));

  for (const pcId of pcIds) {
    await db.delete(pcHealthSnapshots).where(eq(pcHealthSnapshots.pcId, pcId));
    await db.delete(pcConfigurations).where(eq(pcConfigurations.pcId, pcId));
    await db.delete(superadminVerifiers).where(eq(superadminVerifiers.pcId, pcId));
    await db.delete(pairingCodes).where(eq(pairingCodes.pcId, pcId));
    await db.delete(deviceCredentials).where(eq(deviceCredentials.pcId, pcId));
  }
  await db.delete(pcs);

  if (gameIds.length > 0) {
    await db.delete(gameVersions).where(inArray(gameVersions.gameId, gameIds));
    await db.delete(games).where(inArray(games.id, gameIds));
  }

  await db.delete(menuItems);
  await db.delete(menuCategories);
  await db.delete(customers);

  console.log(
    `wiped: ${pcIds.length} pcs, ${gameIds.length} games, menus, customers, audit — kept cafes/users/tiers/pricing rules`,
  );
}

wipe()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
