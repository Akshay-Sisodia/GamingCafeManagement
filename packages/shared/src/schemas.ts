import { z } from "zod";
import type {
  CommandType,
  OfflineEventState,
  OrderStatus,
  SessionStatus,
} from "./enums.js";

// ---- Time ----------------------------------------------------------------

export const isoDateTime = z.string().datetime({ offset: true });

// ---- Sessions --------------------------------------------------------------

export const startSessionSchema = z.object({
  pc_id: z.string().uuid(),
  customer_id: z.string().uuid().nullable().optional(),
  planned_minutes: z.number().int().min(5).max(24 * 60),
  origin: z.enum(["admin", "launcher"]).default("admin"),
  idempotency_key: z.string().min(8).optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

export const extendSessionSchema = z.object({
  minutes: z.number().int().min(5).max(24 * 60),
});
export type ExtendSessionInput = z.infer<typeof extendSessionSchema>;

export interface SessionDto {
  id: string;
  cafe_id: string;
  pc_id: string;
  customer_id: string | null;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  planned_minutes: number;
  extended_minutes: number;
  price_amount: number;
  currency: string;
  status: SessionStatus;
  origin: string;
}

// ---- Commands --------------------------------------------------------------

export const issueCommandSchema = z.object({
  type: z.enum([
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
  ]),
  payload: z.record(z.unknown()).default({}),
  confirm: z.boolean().default(false),
});
export type IssueCommandInput = z.infer<typeof issueCommandSchema>;

export interface CommandDto {
  id: string;
  pc_id: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: string;
  issued_at: string;
}

export const commandAckSchema = z.object({
  status: z.enum(["applied", "failed"]),
  code: z.string().optional(),
  detail: z.string().optional(),
});
export type CommandAckInput = z.infer<typeof commandAckSchema>;

// ---- Offline sync -----------------------------------------------------------

export const offlineEventEnvelope = z.object({
  event_id: z.string().uuid(), // UUIDv7 generated on the agent
  seq: z.number().int().nonnegative(),
  type: z.enum([
    "SESSION_STARTED",
    "SESSION_EXTENDED",
    "SESSION_ENDED",
    "SESSION_CANCELLED",
    "CUSTOMER_ASSIGNED",
    "ORDER_CREATED",
    "SUPERADMIN_ENTERED",
    "SUPERADMIN_LOGIN_FAILED",
    "TAMPER_SUSPECTED",
  ]),
  occurred_at: isoDateTime,
  payload: z.record(z.unknown()),
});
export type OfflineEventEnvelope = z.infer<typeof offlineEventEnvelope>;

export const syncBatchSchema = z.object({
  agent_version: z.string(),
  last_server_seq: z.number().int().nonnegative(),
  events: z.array(offlineEventEnvelope).max(500),
});
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;

export interface SyncEventResult {
  event_id: string;
  seq: number;
  state: OfflineEventState;
  reason?: string;
  session_id?: string;
}

export interface SyncBatchResponse {
  results: SyncEventResult[];
  ack_seq: number; // highest contiguous applied seq
}

// ---- Orders -----------------------------------------------------------------

export const createOrderSchema = z.object({
  pc_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  source: z.enum(["launcher", "admin", "customer_web"]),
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid(),
        variant_id: z.string().uuid().nullable().optional(),
        qty: z.number().int().min(1).max(50),
      }),
    )
    .min(1),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export interface OrderDto {
  id: string;
  number: number;
  pc_id: string | null;
  status: OrderStatus;
  total_amount: number;
  currency: string;
  placed_at: string;
  items: Array<{
    name_snapshot: string;
    qty: number;
    unit_price: number;
    line_total: number;
  }>;
}

// ---- Health -------------------------------------------------------------------

export const healthReportSchema = z.object({
  cpu_pct: z.number().min(0).max(100),
  ram_pct: z.number().min(0).max(100),
  gpu_pct: z.number().min(0).max(100).nullable().optional(),
  disk_pct: z.number().min(0).max(100),
  disk_free_bytes: z.number().int().nonnegative(),
  net_rx_bps: z.number().int().nonnegative().nullable().optional(),
  net_tx_bps: z.number().int().nonnegative().nullable().optional(),
  uptime_s: z.number().int().nonnegative(),
  current_game_id: z.string().uuid().nullable().optional(),
  agent_status: z.string().default("healthy"),
});
export type HealthReportInput = z.infer<typeof healthReportSchema>;

// ---- Auth -----------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const pairDeviceSchema = z.object({
  pairing_code: z.string().length(6),
  hardware_fingerprint: z.string().min(8),
  agent_version: z.string(),
});
export type PairDeviceInput = z.infer<typeof pairDeviceSchema>;

export interface PairDeviceResponse {
  pc_id: string;
  device_token: string;
  server_time_ms: number;
  config_version: number;
}
