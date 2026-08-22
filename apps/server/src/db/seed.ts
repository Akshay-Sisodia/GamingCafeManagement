import { and, eq, sql } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { closeDb, db } from "./index.js";
import {
  cafes,
  customers,
  gameVersions,
  games,
  menuCategories,
  menuItems,
  pcGameInstallations,
  pcTiers,
  pcs,
  pricingRules,
  tenants,
  users,
} from "./schema.js";

const CAFE_NAME = "PACMAN Gaming Cafe";
const PASSWORD = "Password123!";
const GUEST_WALKIN_EMAIL = "guest-walkin@gc.local";

async function findOrCreate<K extends string>(
  label: string,
  find: () => Promise<{ id: string } | undefined>,
  insert: () => Promise<{ id: string }>,
): Promise<string> {
  const existing = await find();
  if (existing) return existing.id;
  const created = await insert();
  console.log(`seeded ${label}`);
  return created.id;
}

async function seedTenantAndCafe(): Promise<string> {
  const tenantId = await findOrCreate(
    `tenant ${CAFE_NAME}`,
    async () =>
      (
        await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.name, CAFE_NAME))
          .limit(1)
      )[0],
    async () =>
      (
        await db.insert(tenants).values({ name: CAFE_NAME }).returning()
      )[0]!,
  );

  const cafeId = await findOrCreate(
    `cafe ${CAFE_NAME}`,
    async () =>
      (
        await db
          .select({ id: cafes.id })
          .from(cafes)
          .where(and(eq(cafes.tenantId, tenantId), eq(cafes.name, CAFE_NAME)))
          .limit(1)
      )[0],
    async () =>
      (
        await db
          .insert(cafes)
          .values({
            tenantId,
            name: CAFE_NAME,
            timezone: "Asia/Kolkata",
            currency: "INR",
          })
          .returning()
      )[0]!,
  );
  return cafeId;
}

async function seedTiers(cafeId: string): Promise<Map<string, string>> {
  const tierIds = new Map<string, string>();
  for (const tier of [
    { name: "Standard", description: "Standard gaming rig" },
    { name: "Premium", description: "High-end gaming rig" },
  ]) {
    const id = await findOrCreate(
      `tier ${tier.name}`,
      async () =>
        (
          await db
            .select({ id: pcTiers.id })
            .from(pcTiers)
            .where(and(eq(pcTiers.cafeId, cafeId), eq(pcTiers.name, tier.name)))
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(pcTiers)
            .values({ cafeId, name: tier.name, description: tier.description })
            .returning()
        )[0]!,
    );
    tierIds.set(tier.name, id);
  }
  return tierIds;
}

async function seedStaff(cafeId: string, passwordHash: string): Promise<void> {
  for (const user of [
    { email: "owner@gc.local", role: "owner" as const, name: "Cafe Owner" },
    { email: "manager@gc.local", role: "manager" as const, name: "Floor Manager" },
    { email: "staff@gc.local", role: "staff" as const, name: "Front Desk" },
    { email: "kitchen@gc.local", role: "kitchen" as const, name: "Kitchen Station" },
  ]) {
    await findOrCreate(
      `user ${user.email}`,
      async () =>
        (
          await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.cafeId, cafeId),
                sql`lower(${users.email}) = ${user.email}`,
              ),
            )
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(users)
            .values({
              cafeId,
              email: user.email,
              passwordHash,
              role: user.role,
              name: user.name,
            })
            .returning()
        )[0]!,
    );
  }
}

async function seedPcs(cafeId: string, tierIds: Map<string, string>): Promise<void> {
  for (let i = 1; i <= 20; i++) {
    const name = `PC-${String(i).padStart(2, "0")}`;
    const tierName = i === 7 || i === 15 ? "Premium" : "Standard";
    await findOrCreate(
      `pc ${name}`,
      async () =>
        (
          await db
            .select({ id: pcs.id })
            .from(pcs)
            .where(and(eq(pcs.cafeId, cafeId), eq(pcs.name, name)))
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(pcs)
            .values({ cafeId, name, tierId: tierIds.get(tierName)! })
            .returning()
        )[0]!,
    );
  }
}

async function seedGames(cafeId: string): Promise<Map<string, string>> {
  const gameVersionIds = new Map<string, string>();
  const gameDefs = [
    {
      name: "CS2",
      platform: "steam" as const,
      category: "FPS",
      executablePath:
        "C:\\Games\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe",
      displayOrder: 1,
      iconUrl: "https://picsum.photos/seed/cs2/480/640",
    },
    {
      name: "Valorant",
      platform: "riot" as const,
      category: "FPS",
      executablePath:
        "C:\\Games\\Riot Games\\VALORANT\\bin\\win64\\VALORANT-win64.exe",
      displayOrder: 2,
      iconUrl: "https://picsum.photos/seed/valorant/480/640",
    },
    {
      name: "GTA V",
      platform: "standalone" as const,
      category: "Open World",
      executablePath: "C:\\Games\\Grand Theft Auto V\\PlayGTAV.exe",
      displayOrder: 3,
      iconUrl: "https://picsum.photos/seed/gtav/480/640",
    },
    {
      name: "FIFA 24",
      platform: "standalone" as const,
      category: "Sports",
      executablePath: "C:\\Games\\FIFA 24\\FIFA24.exe",
      displayOrder: 4,
      iconUrl: "https://picsum.photos/seed/fifa24/480/640",
    },
    {
      name: "Fortnite",
      platform: "epic" as const,
      category: "Battle Royale",
      executablePath:
        "C:\\Games\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe",
      displayOrder: 5,
      iconUrl: "https://picsum.photos/seed/fortnite/480/640",
    },
    {
      name: "Apex Legends",
      platform: "steam" as const,
      category: "Battle Royale",
      executablePath: "C:\\Games\\Steam\\steamapps\\common\\Apex Legends\\r5apex.exe",
      displayOrder: 6,
      iconUrl: "https://picsum.photos/seed/apex/480/640",
    },
  ];

  for (const def of gameDefs) {
    const gameId = await findOrCreate(
      `game ${def.name}`,
      async () =>
        (
          await db
            .select({ id: games.id })
            .from(games)
            .where(and(eq(games.cafeId, cafeId), eq(games.name, def.name)))
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(games)
            .values({
              cafeId,
              name: def.name,
              platform: def.platform,
              category: def.category,
              executablePath: def.executablePath,
              iconUrl: def.iconUrl,
              displayOrder: def.displayOrder,
              enabled: true,
            })
            .returning()
        )[0]!,
    );

    const versionId = await findOrCreate(
      `game_version ${def.name} v1.0.0`,
      async () =>
        (
          await db
            .select({ id: gameVersions.id })
            .from(gameVersions)
            .where(
              and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, "v1.0.0")),
            )
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(gameVersions)
            .values({
              gameId,
              version: "v1.0.0",
              status: "published",
              publishedAt: new Date(),
              sizeBytes: 50_000_000_000,
              manifestUrl: `https://cdn.gamingzone.local/${def.name.toLowerCase().replace(/\s+/g, "-")}/v1.0.0/manifest.json`,
            })
            .returning()
        )[0]!,
    );
    gameVersionIds.set(def.name, versionId);
  }
  return gameVersionIds;
}

async function seedGameInstallations(
  cafeId: string,
  gameVersionIds: Map<string, string>,
): Promise<void> {
  const pcRows = await db
    .select({ id: pcs.id, name: pcs.name })
    .from(pcs)
    .where(eq(pcs.cafeId, cafeId));
  const pcByName = new Map(pcRows.map((p) => [p.name, p.id]));
  const gameRows = await db
    .select({ id: games.id, name: games.name, executablePath: games.executablePath })
    .from(games)
    .where(eq(games.cafeId, cafeId));

  for (let i = 1; i <= 6; i++) {
    const pcName = `PC-${String(i).padStart(2, "0")}`;
    const pcId = pcByName.get(pcName);
    if (!pcId) continue;
    for (const game of gameRows) {
      const existing = await db
        .select({ id: pcGameInstallations.id })
        .from(pcGameInstallations)
        .where(
          and(
            eq(pcGameInstallations.pcId, pcId),
            eq(pcGameInstallations.gameId, game.id),
          ),
        )
        .limit(1);
      if (existing[0]) continue;
      await db.insert(pcGameInstallations).values({
        pcId,
        gameId: game.id,
        installedVersionId: gameVersionIds.get(game.name) ?? null,
        installPath: game.executablePath,
        state: "ready",
        lastVerifiedAt: new Date(),
      });
    }
  }
  console.log("seeded pc_game_installations for PC-01..PC-06");
}

async function seedPricing(cafeId: string): Promise<void> {
  const pricingDefs = [
    {
      name: "Standard",
      dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "00:00:00",
      endTime: "23:59:00",
      hourlyRate: 15000,
      priority: 0,
    },
    {
      name: "Peak",
      dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: "18:00:00",
      endTime: "23:00:00",
      hourlyRate: 20000,
      priority: 10,
    },
    {
      name: "Weekend",
      dayOfWeek: [0, 6],
      startTime: "00:00:00",
      endTime: "23:59:00",
      hourlyRate: 18000,
      priority: 5,
    },
  ];
  for (const rule of pricingDefs) {
    await findOrCreate(
      `pricing_rule ${rule.name}`,
      async () =>
        (
          await db
            .select({ id: pricingRules.id })
            .from(pricingRules)
            .where(
              and(eq(pricingRules.cafeId, cafeId), eq(pricingRules.name, rule.name)),
            )
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(pricingRules)
            .values({
              cafeId,
              tierId: null,
              name: rule.name,
              dayOfWeek: rule.dayOfWeek,
              startTime: rule.startTime,
              endTime: rule.endTime,
              hourlyRate: rule.hourlyRate,
              priority: rule.priority,
              active: true,
            })
            .returning()
        )[0]!,
    );
  }
}

async function seedMenu(cafeId: string): Promise<void> {
  const menuDef: Array<{
    category: string;
    displayOrder: number;
    items: Array<{ name: string; price: number; prepMinutes: number }>;
  }> = [
    {
      category: "Burgers",
      displayOrder: 1,
      items: [
        { name: "Chicken Burger", price: 18000, prepMinutes: 12 },
        { name: "Cheese Burger", price: 20000, prepMinutes: 12 },
      ],
    },
    {
      category: "Snacks",
      displayOrder: 2,
      items: [{ name: "French Fries", price: 10000, prepMinutes: 8 }],
    },
    {
      category: "Drinks",
      displayOrder: 3,
      items: [{ name: "Coke", price: 6000, prepMinutes: 2 }],
    },
  ];

  for (const cat of menuDef) {
    const categoryId = await findOrCreate(
      `menu_category ${cat.category}`,
      async () =>
        (
          await db
            .select({ id: menuCategories.id })
            .from(menuCategories)
            .where(
              and(
                eq(menuCategories.cafeId, cafeId),
                eq(menuCategories.name, cat.category),
              ),
            )
            .limit(1)
        )[0],
      async () =>
        (
          await db
            .insert(menuCategories)
            .values({
              cafeId,
              name: cat.category,
              displayOrder: cat.displayOrder,
              available: true,
            })
            .returning()
        )[0]!,
    );

    for (const item of cat.items) {
      await findOrCreate(
        `menu_item ${item.name}`,
        async () =>
          (
            await db
              .select({ id: menuItems.id })
              .from(menuItems)
              .where(
                and(
                  eq(menuItems.cafeId, cafeId),
                  eq(menuItems.categoryId, categoryId),
                  eq(menuItems.name, item.name),
                ),
              )
              .limit(1)
          )[0],
        async () =>
          (
            await db
              .insert(menuItems)
              .values({
                cafeId,
                categoryId,
                name: item.name,
                basePrice: item.price,
                currency: "INR",
                prepMinutes: item.prepMinutes,
                available: true,
              })
              .returning()
          )[0]!,
      );
    }
  }
}

async function seedCustomers(cafeId: string, passwordHash: string): Promise<void> {
  await findOrCreate(
    `customer ${GUEST_WALKIN_EMAIL}`,
    async () =>
      (
        await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.cafeId, cafeId),
              sql`lower(${customers.email}) = ${GUEST_WALKIN_EMAIL}`,
            ),
          )
          .limit(1)
      )[0],
    async () =>
      (
        await db
          .insert(customers)
          .values({
            cafeId,
            email: GUEST_WALKIN_EMAIL,
            name: "Walk-in Guest",
            authMethod: "none",
            passwordHash: null,
          })
          .returning()
      )[0]!,
  );

  await findOrCreate(
    "customer customer@gc.local",
    async () =>
      (
        await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.cafeId, cafeId),
              sql`lower(${customers.email}) = 'customer@gc.local'`,
            ),
          )
          .limit(1)
      )[0],
    async () =>
      (
        await db
          .insert(customers)
          .values({
            cafeId,
            email: "customer@gc.local",
            name: "Test Customer",
            authMethod: "password",
            passwordHash,
          })
          .returning()
      )[0]!,
  );
}

async function main(): Promise<void> {
  console.log("seeding PACMAN Gaming Cafe...");
  const passwordHash = await hash(PASSWORD);
  const cafeId = await seedTenantAndCafe();
  const tierIds = await seedTiers(cafeId);
  await seedStaff(cafeId, passwordHash);
  await seedPcs(cafeId, tierIds);
  const gameVersionIds = await seedGames(cafeId);
  await seedGameInstallations(cafeId, gameVersionIds);
  await seedPricing(cafeId);
  await seedMenu(cafeId);
  await seedCustomers(cafeId, passwordHash);
  console.log("seed complete: PACMAN Gaming Cafe is ready");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exitCode = 1;
  });
