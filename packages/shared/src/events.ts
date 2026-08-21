import type { CommandDto, SessionDto } from "./schemas.js";
import type { DeploymentTargetState, OrderStatus, PcStatus } from "./enums.js";

/**
 * SSE event catalog. Event names match the `event:` field on the wire.
 * See docs/03-protocols.md §5.
 */

export interface PcStatusEvent {
  pc_id: string;
  status: PcStatus;
  at: string;
}

export interface SessionUpdatedEvent {
  session_id: string;
  pc_id: string;
  expires_at: string;
  status: SessionDto["status"];
}

export interface ConfigUpdatedEvent {
  config_version: number;
}

export interface DeploymentUpdatedEvent {
  job_id: string;
  pc_id: string;
  target_state: DeploymentTargetState;
  progress_pct?: number;
  manifest_url?: string;
  lan_token?: string; // only sent to the target PC channel
}

export interface OrderEvent {
  order_id: string;
  order_number: number;
  pc_id: string | null;
  status: OrderStatus;
  at: string;
}

export interface SyncConflictEvent {
  event_id: string;
  pc_id: string;
  reason: string;
}

export interface NotificationEvent {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
}

/** PC channel events (device-authenticated). */
export type PcChannelEvent =
  | { event: "command"; id: string; data: CommandDto }
  | { event: "session.updated"; id: string; data: SessionUpdatedEvent }
  | { event: "config.updated"; id: string; data: ConfigUpdatedEvent }
  | { event: "deployment.updated"; id: string; data: DeploymentUpdatedEvent };

/** Admin channel events (staff JWT). */
export type AdminChannelEvent =
  | { event: "pc.status"; id: string; data: PcStatusEvent }
  | { event: "session.updated"; id: string; data: SessionUpdatedEvent }
  | { event: "order.updated"; id: string; data: OrderEvent }
  | { event: "deployment.progress"; id: string; data: DeploymentUpdatedEvent }
  | { event: "sync.conflict"; id: string; data: SyncConflictEvent }
  | { event: "notification"; id: string; data: NotificationEvent };
