import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const staffRoleEnum = pgEnum("staff_role", ["owner", "manager", "staff", "kitchen"]);
export const cafeStatusEnum = pgEnum("cafe_status", ["active", "suspended"]);
export const pcStatusEnum = pgEnum("pc_status", ["online", "offline", "maintenance", "disabled"]);
export const gamePlatformEnum = pgEnum("game_platform", [
  "steam",
  "epic",
  "riot",
  "ea",
  "battlenet",
  "standalone",
]);
export const installationStateEnum = pgEnum("installation_state", [
  "not_installed",
  "installing",
  "ready",
  "failed",
]);
export const deploymentJobStatusEnum = pgEnum("deployment_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const deploymentTargetStateEnum = pgEnum("deployment_target_state", [
  "queued",
  "downloading",
  "verifying",
  "installing",
  "ready",
  "paused",
  "failed",
  "offline",
]);
export const gameVersionStatusEnum = pgEnum("game_version_status", [
  "draft",
  "published",
  "deprecated",
]);
export const sessionStatusEnum = pgEnum("session_status", [
  "scheduled",
  "active",
  "paused",
  "expired",
  "ended",
  "cancelled",
]);
export const sessionOriginEnum = pgEnum("session_origin", [
  "admin",
  "launcher",
  "superadmin_offline",
]);
export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "started",
  "extended",
  "ended",
  "cancelled",
  "paused",
  "resumed",
  "transferred",
  "expired",
]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "pc", "system", "customer"]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "user",
  "pc",
  "system",
  "customer",
  "superadmin_local",
]);
export const eventSourceEnum = pgEnum("event_source", ["online", "offline", "local"]);
export const commandTypeEnum = pgEnum("command_type", [
  "start_session",
  "extend_session",
  "end_session",
  "lock",
  "unlock",
  "launch_game",
  "restart",
  "shutdown",
  "refresh_config",
  "enter_maintenance",
  "request_health",
  "deployment_control",
]);
export const commandStatusEnum = pgEnum("command_status", [
  "pending",
  "sent",
  "applied",
  "failed",
  "expired",
]);
export const offlineEventStateEnum = pgEnum("offline_event_state", [
  "accepted",
  "duplicate",
  "conflicted",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "delivered",
  "completed",
  "cancelled",
]);
export const orderSourceEnum = pgEnum("order_source", ["launcher", "admin", "customer_web"]);
export const authMethodEnum = pgEnum("auth_method", ["none", "password", "otp"]);
export const walletTxTypeEnum = pgEnum("wallet_tx_type", ["credit", "debit"]);
export const walletTxSubtypeEnum = pgEnum("wallet_tx_subtype", [
  "topup",
  "promo",
  "refund",
  "adjustment",
  "payment",
]);
export const loyaltyTxTypeEnum = pgEnum("loyalty_tx_type", ["earn", "redeem", "expire", "adjust"]);
export const reservationStatusEnum = pgEnum("reservation_status", [
  "held",
  "confirmed",
  "cancelled",
  "fulfilled",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "upi", "card", "online", "wallet"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "success",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const paymentTxTypeEnum = pgEnum("payment_tx_type", ["charge", "refund", "partial_refund"]);
export const notificationAudienceEnum = pgEnum("notification_audience", [
  "admin",
  "customer",
  "kitchen",
]);
export const notificationSeverityEnum = pgEnum("notification_severity", [
  "info",
  "warning",
  "critical",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const cafes = pgTable("cafes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  currency: char("currency", { length: 3 }).notNull(),
  address: jsonb("address"),
  status: cafeStatusEnum("status").notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: staffRoleEnum("role").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_cafe_email_uq").on(t.cafeId, sql`lower(${t.email})`)],
);

export const pcTiers = pgTable("pc_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  name: text("name").notNull(),
  description: text("description"),
});

export const pcs = pgTable(
  "pcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    name: text("name").notNull(),
    tierId: uuid("tier_id").references(() => pcTiers.id),
    status: pcStatusEnum("status").notNull().default("offline"),
    hardwareFingerprint: text("hardware_fingerprint"),
    agentVersion: text("agent_version"),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pcs_cafe_name_uq").on(t.cafeId, t.name),
    index("pcs_cafe_status_idx").on(t.cafeId, t.status),
  ],
);

export const deviceCredentials = pgTable("device_credentials", {
  pcId: uuid("pc_id")
    .primaryKey()
    .references(() => pcs.id),
  tokenHash: text("token_hash").notNull(),
  pairedAt: ts("paired_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  rotatedAt: ts("rotated_at"),
});

/**
 * Cafe-level enrollment tokens (docs: zero-touch agent rollout).
 * A single token installs N PCs; each agent self-registers a PC row
 * named after its hostname.
 */
export const cafeEnrollmentTokens = pgTable(
  "cafe_enrollment_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    label: text("label").notNull().default("rollout"),
    tokenHash: text("token_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cafe_enrollment_tokens_hash_uq").on(t.tokenHash)],
);

export const pairingCodes = pgTable(
  "pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    code: text("code").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [index("pairing_codes_code_idx").on(t.code)],
);

export const pcHealthSnapshots = pgTable(
  "pc_health_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    cpuPct: real("cpu_pct").notNull(),
    ramPct: real("ram_pct").notNull(),
    gpuPct: real("gpu_pct"),
    diskPct: real("disk_pct").notNull(),
    diskFreeBytes: bigint("disk_free_bytes", { mode: "number" }).notNull(),
    netRxBps: bigint("net_rx_bps", { mode: "number" }),
    netTxBps: bigint("net_tx_bps", { mode: "number" }),
    uptimeS: integer("uptime_s").notNull(),
    currentGameId: uuid("current_game_id"),
    agentStatus: text("agent_status").notNull().default("healthy"),
  },
  (t) => [index("pc_health_pc_captured_idx").on(t.pcId, t.capturedAt)],
);

export const pcConfigurations = pgTable("pc_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  pcId: uuid("pc_id")
    .notNull()
    .references(() => pcs.id),
  version: integer("version").notNull(),
  config: jsonb("config").notNull(),
  publishedAt: ts("published_at").notNull().defaultNow(),
});

export const superadminVerifiers = pgTable("superadmin_verifiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  pcId: uuid("pc_id")
    .notNull()
    .references(() => pcs.id),
  verifier: text("verifier").notNull(),
  version: integer("version").notNull(),
  syncedAt: ts("synced_at").notNull().defaultNow(),
});

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  name: text("name").notNull(),
  iconUrl: text("icon_url"),
  category: text("category"),
  executablePath: text("executable_path"),
  launchArgs: text("launch_args"),
  platform: gamePlatformEnum("platform").notNull().default("standalone"),
  enabled: boolean("enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const gameVersions = pgTable("game_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id),
  version: text("version").notNull(),
  manifestUrl: text("manifest_url"),
  manifestHash: text("manifest_hash"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  status: gameVersionStatusEnum("status").notNull().default("draft"),
  publishedAt: ts("published_at"),
});

export const pcGameInstallations = pgTable(
  "pc_game_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    installedVersionId: uuid("installed_version").references(() => gameVersions.id),
    installPath: text("install_path"),
    state: installationStateEnum("state").notNull().default("not_installed"),
    lastVerifiedAt: ts("last_verified_at"),
  },
  (t) => [uniqueIndex("pc_game_installations_pc_game_uq").on(t.pcId, t.gameId)],
);

export const gameDeployments = pgTable("game_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id),
  targetVersionId: uuid("target_version")
    .notNull()
    .references(() => gameVersions.id),
  masterPcId: uuid("master_pc_id")
    .notNull()
    .references(() => pcs.id),
  policy: jsonb("policy"),
  status: deploymentJobStatusEnum("status").notNull().default("queued"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const gameDeploymentTargets = pgTable("game_deployment_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  deploymentId: uuid("deployment_id")
    .notNull()
    .references(() => gameDeployments.id),
  pcId: uuid("pc_id")
    .notNull()
    .references(() => pcs.id),
  state: deploymentTargetStateEnum("state").notNull().default("queued"),
  progressPct: real("progress_pct").notNull().default(0),
  bytesTransferred: bigint("bytes_transferred", { mode: "number" }).notNull().default(0),
  error: text("error"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    customerId: uuid("customer_id"),
    startedAt: ts("started_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    endedAt: ts("ended_at"),
    plannedMinutes: integer("planned_minutes").notNull(),
    extendedMinutes: integer("extended_minutes").notNull().default(0),
    priceAmount: bigint("price_amount", { mode: "number" }).notNull().default(0),
    currency: char("currency", { length: 3 }).notNull(),
    pricingBreakdown: jsonb("pricing_breakdown"),
    status: sessionStatusEnum("status").notNull().default("active"),
    origin: sessionOriginEnum("origin").notNull().default("admin"),
    createdBy: uuid("created_by").references(() => users.id),
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    uniqueIndex("sessions_idempotency_key_uq").on(t.idempotencyKey),
    index("sessions_cafe_status_expires_idx").on(t.cafeId, t.status, t.expiresAt),
    index("sessions_pc_status_idx").on(t.pcId, t.status),
  ],
);

export const sessionEvents = pgTable("session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id),
  type: sessionEventTypeEnum("type").notNull(),
  actorType: actorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  payload: jsonb("payload"),
});

export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  tierId: uuid("tier_id").references(() => pcTiers.id),
  name: text("name").notNull(),
  dayOfWeek: integer("day_of_week").array().notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  hourlyRate: bigint("hourly_rate", { mode: "number" }).notNull(),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const offlineEvents = pgTable(
  "offline_events",
  {
    id: uuid("id").primaryKey(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    payload: jsonb("payload").notNull(),
    state: offlineEventStateEnum("state").notNull().default("accepted"),
    conflictReason: text("conflict_reason"),
    appliedSessionId: uuid("applied_session_id").references(() => sessions.id),
    receivedBatchId: uuid("received_batch_id"),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("offline_events_pc_seq_uq").on(t.pcId, t.seq),
    check(
      "offline_events_type_chk",
      sql`${t.type} in ('SESSION_STARTED', 'SESSION_EXTENDED', 'SESSION_ENDED', 'SESSION_CANCELLED', 'CUSTOMER_ASSIGNED', 'ORDER_CREATED', 'SUPERADMIN_ENTERED', 'SUPERADMIN_LOGIN_FAILED', 'TAMPER_SUSPECTED')`,
    ),
  ],
);

export const reconciliationBatches = pgTable("reconciliation_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  pcId: uuid("pc_id")
    .notNull()
    .references(() => pcs.id),
  agentVersion: text("agent_version").notNull(),
  lastServerSeq: bigint("last_server_seq", { mode: "number" }).notNull(),
  eventCount: integer("event_count").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

export const pcCommands = pgTable(
  "pc_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    pcId: uuid("pc_id")
      .notNull()
      .references(() => pcs.id),
    type: commandTypeEnum("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    requiresConfirm: boolean("requires_confirm").notNull().default(false),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    status: commandStatusEnum("status").notNull().default("pending"),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
    ackedAt: ts("acked_at"),
    ackPayload: jsonb("ack_payload"),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("pc_commands_pc_status_issued_idx").on(t.pcId, t.status, t.issuedAt)],
);

export const menuCategories = pgTable("menu_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  available: boolean("available").notNull().default(true),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    basePrice: bigint("base_price", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    prepMinutes: integer("prep_minutes").notNull().default(10),
    available: boolean("available").notNull().default(true),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("menu_items_cafe_category_idx").on(t.cafeId, t.categoryId)],
);

export const menuVariants = pgTable("menu_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => menuItems.id),
  name: text("name").notNull(),
  priceDelta: bigint("price_delta", { mode: "number" }).notNull().default(0),
  available: boolean("available").notNull().default(true),
});

export const menuAddons = pgTable("menu_addons", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => menuItems.id),
  name: text("name").notNull(),
  price: bigint("price", { mode: "number" }).notNull(),
  available: boolean("available").notNull().default(true),
});

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    pcId: uuid("pc_id").references(() => pcs.id),
    sessionId: uuid("session_id").references(() => sessions.id),
    customerId: uuid("customer_id"),
    number: integer("number").notNull(),
    status: orderStatusEnum("status").notNull().default("placed"),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    source: orderSourceEnum("source").notNull(),
    placedAt: ts("placed_at").notNull().defaultNow(),
    cancelledReason: text("cancelled_reason"),
  },
  (t) => [index("orders_cafe_status_placed_idx").on(t.cafeId, t.status, sql`${t.placedAt} desc`)],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id),
  variantId: uuid("variant_id").references(() => menuVariants.id),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPrice: bigint("unit_price", { mode: "number" }).notNull(),
  qty: integer("qty").notNull(),
  addons: jsonb("addons").notNull().default(sql`'[]'::jsonb`),
  lineTotal: bigint("line_total", { mode: "number" }).notNull(),
});

export const orderStatusHistory = pgTable("order_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorType: actorTypeEnum("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  changedAt: ts("changed_at").notNull().defaultNow(),
});

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    phone: text("phone"),
    email: text("email"),
    name: text("name").notNull(),
    authMethod: authMethodEnum("auth_method").notNull().default("none"),
    passwordHash: text("password_hash"),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "customers_contact_chk",
      sql`(${t.phone} is not null or ${t.email} is not null or ${t.authMethod} = 'none')`,
    ),
    uniqueIndex("customers_cafe_email_uq").on(t.cafeId, sql`lower(${t.email})`),
    uniqueIndex("customers_cafe_phone_uq").on(t.cafeId, t.phone),
  ],
);

export const wallets = pgTable("wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .unique()
    .references(() => customers.id),
  currency: char("currency", { length: 3 }).notNull(),
});

export const walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallets.id),
  type: walletTxTypeEnum("type").notNull(),
  subtype: walletTxSubtypeEnum("subtype").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  name: text("name").notNull(),
  price: bigint("price", { mode: "number" }).notNull(),
  benefits: jsonb("benefits").notNull().default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
});

export const customerMemberships = pgTable("customer_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  membershipId: uuid("membership_id")
    .notNull()
    .references(() => memberships.id),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  status: text("status").notNull().default("active"),
});

export const loyaltyAccounts = pgTable("loyalty_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .unique()
    .references(() => customers.id),
  pointsBalance: bigint("points_balance", { mode: "number" }).notNull().default(0),
});

export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => loyaltyAccounts.id),
  type: loyaltyTxTypeEnum("type").notNull(),
  points: integer("points").notNull(),
  reason: text("reason"),
  referenceId: uuid("reference_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  pcId: uuid("pc_id")
    .notNull()
    .references(() => pcs.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  price: bigint("price", { mode: "number" }).notNull(),
  status: reservationStatusEnum("status").notNull().default("held"),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cafeId: uuid("cafe_id")
      .notNull()
      .references(() => cafes.id),
    sessionId: uuid("session_id").references(() => sessions.id),
    orderId: uuid("order_id").references(() => orders.id),
    customerId: uuid("customer_id"),
    method: paymentMethodEnum("method").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    externalRef: text("external_ref"),
    idempotencyKey: text("idempotency_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payments_idempotency_key_uq").on(t.idempotencyKey)],
);

export const paymentTransactions = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  type: paymentTxTypeEnum("type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  actorId: text("actor_id").notNull(),
  note: text("note"),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  cafeId: uuid("cafe_id")
    .notNull()
    .references(() => cafes.id),
  audience: notificationAudienceEnum("audience").notNull(),
  userId: uuid("user_id").references(() => users.id),
  pcId: uuid("pc_id").references(() => pcs.id),
  type: text("type").notNull(),
  severity: notificationSeverityEnum("severity").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().unique(),
    cafeId: uuid("cafe_id").references(() => cafes.id),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    source: eventSourceEnum("source").notNull(),
    pcId: uuid("pc_id").references(() => pcs.id),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_cafe_occurred_idx").on(t.cafeId, sql`${t.occurredAt} desc`),
    index("audit_logs_action_occurred_idx").on(t.action, sql`${t.occurredAt} desc`),
  ],
);
