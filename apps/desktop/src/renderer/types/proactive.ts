export type ScheduleInterval = '10m' | '15m' | '30m' | '1h' | '2h' | 'random' | 'manual';
export type ExecutionTarget = 'local' | 'cloud';
export type ProactiveModelMode = 'auto' | 'fast' | 'balanced' | 'smart';

export interface ProactiveContextPermissions {
  screenshot: boolean;
  systemAudio: boolean;
  micAudio: boolean;
}

export type NotificationChannel = 'app' | 'sms' | 'call';

export interface ProactiveConfig {
  enabled: boolean;
  interval: ScheduleInterval;
  executionTarget: ExecutionTarget;
  modelMode: ProactiveModelMode;
  modelId?: string;
  instructions: string;
  contextPermissions: ProactiveContextPermissions;
  allowedTools: string[];
  notificationChannels: NotificationChannel[];
  lastWakeUpAt?: string | null;
  nextWakeUpAt?: string | null;
}

export type ProactiveTaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

export interface ProactiveTask {
  id: string;
  title: string;
  instructions: string;
  status: ProactiveTaskStatus;
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProactiveWakeUpLog {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  status: 'running' | 'completed' | 'failed';
  contextUsed: string[];
  tasksProcessed: string[];
  agentMessage?: string;
  executionTarget?: ExecutionTarget;
  modelMode?: ProactiveModelMode;
  modelId?: string;
  timeoutMs?: number;
  timedOut?: boolean;
  failureReason?: string;
  partialResponse?: string;
  stageHistory?: ProactiveWakeUpStageEvent[];
  reasoningText?: string;
  toolCalls?: ProactiveWakeUpToolCall[];
  activityEvents?: ProactiveWakeUpActivityEvent[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedPromptTokens?: number;
    thinkingTokens?: number;
    reasoningTokens?: number;
    [key: string]: any;
  };
  parentWakeUpId?: string;
}

export interface ProactiveWakeUpStageEvent {
  stage: string;
  label: string;
  progress: number;
  detail?: string;
  at: string;
}

export interface ProactiveWakeUpToolCall {
  id: string;
  tool: string;
  status?: string;
  description?: string;
  args?: any;
  result?: any;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface ProactiveWakeUpActivityEvent {
  id: string;
  kind: 'lifecycle' | 'routing' | 'reasoning' | 'tool' | 'status';
  event: string;
  label: string;
  detail?: string;
  at: string;
}

export interface ProactiveData {
  config: ProactiveConfig;
  tasks: ProactiveTask[];
  wakeUpLog: ProactiveWakeUpLog[];
}

export const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
  enabled: false,
  interval: '30m',
  executionTarget: 'local',
  modelMode: 'balanced',
  modelId: '',
  instructions: '',
  contextPermissions: {
    screenshot: false,
    systemAudio: false,
    micAudio: false,
  },
  allowedTools: [],
  notificationChannels: ['app'],
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, { label: string; description: string }> = {
  app: { label: 'In-App', description: 'Desktop notification popup' },
  sms: { label: 'SMS', description: 'Text message to verified phone' },
  call: { label: 'Phone Call', description: 'Voice call with TTS message' },
};

export const EXECUTION_TARGET_LABELS: Record<ExecutionTarget, { label: string; description: string }> = {
  local: { label: 'Local Agent', description: 'Runs on your machine' },
  cloud: { label: 'Cloud VM', description: 'Runs on your cloud computer' },
};

export const PROACTIVE_MODEL_MODE_LABELS: Record<ProactiveModelMode, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'Route model automatically' },
  fast: { label: 'Fast', description: 'Lower latency responses' },
  balanced: { label: 'Balanced', description: 'Good speed and quality' },
  smart: { label: 'Smart', description: 'Best reasoning quality' },
};

export const SCHEDULE_LABELS: Record<ScheduleInterval, string> = {
  '10m': 'Every 10 minutes',
  '15m': 'Every 15 minutes',
  '30m': 'Every 30 minutes',
  '1h': 'Every hour',
  '2h': 'Every 2 hours',
  'random': 'Random check-ins',
  'manual': 'Manual only',
};

// (Removed the unused INTERVAL_MS table — it was an unreferenced duplicate of
// the schedule-interval math now single-sourced in @stuardai/bots-core/schedule.
// Use intervalDelayMs / SCHEDULE_INTERVAL_MS from the package if a renderer
// surface ever needs interval→ms again.)
