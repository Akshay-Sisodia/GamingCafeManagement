import type {
  CommandDto,
  DeploymentTargetState,
  InstallationState,
  PcStatus,
} from "@gaming-cafe/shared";

export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  cafe_id: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUserDto;
}

export interface DashboardDto {
  revenue_today: number;
  pcs_total: number;
  pcs_occupied: number;
  active_sessions: number;
  pending_orders: number;
  offline_pcs: number;
}

export interface PcSessionSummary {
  id: string;
  customer_name: string | null;
  started_at: string;
  expires_at: string;
  planned_minutes: number;
  game_name: string | null;
}

export interface PcDto {
  id: string;
  name: string;
  status: PcStatus;
  tier_name: string;
  current_session: PcSessionSummary | null;
  agent_version: string;
}

export interface PcHealthDto {
  cpu_pct: number;
  ram_pct: number;
  gpu_pct: number | null;
  disk_pct: number;
  disk_free_bytes: number;
  uptime_s: number;
  agent_status: string;
}

export interface InstallationDto {
  id: string;
  game_name: string;
  version_label: string;
  state: InstallationState;
  updated_at: string;
}

export interface PcDetailDto extends PcDto {
  health: PcHealthDto | null;
  installations: InstallationDto[];
  commands: CommandDto[];
}

export interface GameDto {
  id: string;
  name: string;
  platform: string;
}

export interface DeploymentTargetDto {
  pc_id: string;
  pc_name: string;
  state: DeploymentTargetState;
  progress_pct: number | null;
}

export interface DeploymentDto {
  id: string;
  game_name: string;
  status: string;
  created_at: string;
  targets: DeploymentTargetDto[];
}

export interface MenuItemDto {
  id: string;
  name: string;
  price_amount: number;
  available: boolean;
  prep_minutes: number;
}

export interface MenuCategoryDto {
  id: string;
  name: string;
  items: MenuItemDto[];
}

export interface CustomerDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  wallet_balance: number;
  loyalty_points: number;
  created_at: string;
}

export interface AuditLogDto {
  id: string;
  at: string;
  actor_type: string;
  actor_name: string | null;
  action: string;
  target: string | null;
  detail: string | null;
}

export interface SyncConflictDto {
  id: string;
  event_id: string;
  pc_id: string;
  pc_name: string | null;
  event_type: string;
  reason: string;
  state: string;
  occurred_at: string;
}
