export type ProvisionStep =
  | 'vm_creating'
  | 'vm_created'
  | 'waiting_ip'
  | 'waiting_agent'
  | 'restoring_data'
  | 'syncing_agent'
  | 'syncing_integrations'
  | 'finalizing';

export interface CloudEngine {
  id: string;
  user_id: string;
  instance_name: string;
  zone: string;
  tier: string;
  status: 'provisioning' | 'starting' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'error';
  disk_size_gb: number;
  vcpus?: number;
  ram_gb?: number;
  created_at: string;
  last_heartbeat_at?: string;
  health_status?: string;
  external_ip?: string;
  provision_step?: ProvisionStep | null;
}

export interface CloudMetrics {
  cpu: number;
  ram_used: number;
  ram_total: number;
  disk_used: number;
  disk_total: number;
  net_rx: number;
  net_tx: number;
}

export interface CloudSnapshot {
  id: string;
  name: string;
  description?: string;
  status: string;
  size_bytes?: number;
  created_at: string;
}

export interface CloudBilling {
  total_credits_used: number;
  compute_credits: number;
  storage_credits: number;
  current_tier?: string;
  engine_status?: string;
  hours_this_month?: number;
}

export type CloudComputeUsageResponse = CloudJsonResponse & Partial<CloudBilling>;

export type SyncState = 'synced' | 'out_of_sync' | 'syncing' | 'unknown';

export interface CloudSyncStatus {
  state: SyncState;
  lastSyncAt: string | null;
  vm: {
    memories: number;
    conversations: number;
    topics: number;
    diskBytes: number;
    byOrigin?: { cloud_vm: number; desktop: number } | null;
  } | null;
  desktop: {
    conversations: number;
    messages: number;
    spaces: number;
    spaceItems: number;
    segments: number;
  } | null;
}

export interface CloudFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

export type DeployKind = 'workflow' | 'script' | 'project';
export type DeployStatus =
  | 'pending'
  | 'uploading'
  | 'deploying'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'completed';

export interface CloudDeploymentTriggerBinding {
  triggerId: string;
  type: string;
  mode?: string | null;
  args?: Record<string, any>;
}

export interface CloudDeployment {
  id: string;
  name: string;
  kind: DeployKind;
  description: string | null;
  status: DeployStatus | string;
  auto_restart: boolean;
  schedule: string | null;
  pid: number | null;
  logs_tail?: string | null;
  source_workflow_id?: string | null;
  trigger_bindings?: CloudDeploymentTriggerBinding[];
  timezone?: string | null;
  run_count?: number;
  last_run_at?: string | null;
  last_completed_at?: string | null;
  last_trigger_source?: string | null;
  error_message: string | null;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
}

export type CloudDeployKind = DeployKind;
export type CloudDeployStatus = DeployStatus;

export interface VmChatAttachment {
  type?: string;
  name: string;
  path: string;
  mimeType?: string;
  size?: number;
}

export interface VmRelayOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  timeoutMs?: number;
}

export interface VmPermissionsConfig {
  mode: 'auto' | 'manual' | 'selective';
  auto_approve: string[];
  always_require: string[];
}

export interface VmBotTrigger {
  id: string;
  type: 'schedule.interval' | 'schedule.cron' | 'webhook' | 'gmail.new_email' | 'manual' | string;
  args?: Record<string, any>;
  enabled?: boolean;
}

export interface VmBotConfig {
  interval?: string;
  modelMode?: 'auto' | 'fast' | 'balanced' | 'smart';
  modelId?: string;
  instructions?: string;
  allowedTools?: string[];
  notificationChannels?: string[];
  memoryEnabled?: boolean;
  skillIds?: string[];
  skills?: Array<{
    id: string;
    name: string;
    description?: string;
    trigger?: string;
    icon?: string;
    color?: string;
    isActive?: boolean;
  }>;
}

export interface VmBot {
  id: string;
  name?: string;
  emoji?: string;
  status?: 'paused' | 'running' | 'errored' | string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: 'success' | 'partial' | 'failed' | string;
  lastError?: string | null;
  isRunning?: boolean;
  triggers?: VmBotTrigger[];
  config?: VmBotConfig;
}

export interface VmBotMemoryEntry {
  id?: string;
  text?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  origin?: string;
  [key: string]: any;
}

export type CloudJsonResponse = { ok: boolean; error?: string; message?: string; [key: string]: any };
