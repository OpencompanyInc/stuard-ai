import type {
  ScheduleInterval,
  ExecutionTarget,
  NotificationChannel,
  ProactiveModelMode,
} from './proactive-types';

export type BotStatus = 'paused' | 'running' | 'errored';

export interface BotConfig {
  interval: ScheduleInterval;
  executionTarget: ExecutionTarget;
  modelMode: ProactiveModelMode;
  modelId?: string;
  instructions: string;
  contextPermissions: { screenshot: boolean; systemAudio: boolean; micAudio: boolean };
  allowedTools: string[];
  notificationChannels: NotificationChannel[];
  memoryEnabled: boolean;
  /** Per-agent skill subset. undefined = inherit all globally-active skills. */
  skillIds?: string[];
  /**
   * How autonomous the agent is on sensitive tools (writing/deleting files,
   * running commands, terminal) during a local run:
   * 'auto' = never ask · 'selective' = auto-run `autoApproveTools`, prompt for
   * the rest · 'manual' = prompt for every sensitive tool.
   */
  permissionMode?: 'auto' | 'selective' | 'manual';
  /** Sensitive tools auto-approved when permissionMode === 'selective'. */
  autoApproveTools?: string[];
}

export type BotTriggerType =
  | 'schedule.interval'
  | 'schedule.cron'
  | 'webhook'
  | 'fs.watch'
  | 'command.watch'
  | 'gmail.new_email'
  | 'manual';

export interface BotTrigger {
  id: string;
  type: BotTriggerType;
  args: Record<string, any>;
  enabled?: boolean;
  label?: string;
  requiresCloud?: boolean;
}

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  storedFacts: string;
  triggers: BotTrigger[];
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  vmDeployedAt?: string | null;
  isLegacyDefault?: boolean;
  config?: BotConfig;
}

export interface VmBotRuntime {
  id: string;
  name?: string;
  status?: BotStatus;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: 'success' | 'partial' | 'failed';
  lastError?: string;
  isRunning?: boolean;
}

export type BlueprintPreflightProbe =
  | 'tool_available'
  | 'binary_available'
  | 'folder_access'
  | 'oauth_connected'
  | 'capture_devices_available'
  | 'dry_run_tool';

export interface BlueprintPreflightStep {
  id: string;
  probe: BlueprintPreflightProbe;
  label: string;
  rationale?: string;
  args?: Record<string, any>;
}

export type BlueprintTestRunStatus = 'pass' | 'fail' | 'warn' | 'unsupported';

export interface BlueprintTrigger {
  type: BotTriggerType;
  args?: Record<string, any>;
  label?: string;
  rationale?: string;
}

export interface BotBlueprint {
  name: string;
  emoji: string;
  description?: string;
  systemPrompt: string;
  instructions: string;
  allowedTools: string[];
  interval: ScheduleInterval;
  toolRationale?: Array<{ tool: string; reason: string }>;
  clarifyingQuestions?: string[];
  clarifyingAnswers?: Array<{ question: string; answer: string }>;
  setupChecks?: string[];
  preflightSteps?: BlueprintPreflightStep[];
  triggers?: BlueprintTrigger[];
}

export type BlueprintStreamEvent =
  | { type: 'start'; goal: string; model: string; availableToolCount: number }
  | { type: 'phase'; phase: 'generate' | 'repair' }
  | { type: 'tool_search.start'; query: string; category: string | null; limit: number; fallback?: boolean }
  | { type: 'tool_search.results'; query: string; tools: Array<{ name: string; description: string; category: string }>; fallback?: boolean }
  | { type: 'clarify_user'; clarifyId: string; questions: string[]; reason?: string | null; blocking?: boolean }
  | { type: 'clarify_received'; clarifyId: string; answers: Array<{ question: string; answer: string }> }
  | { type: 'test_run.start'; runId: string; probe: BlueprintPreflightProbe; label: string; rationale?: string | null; args?: Record<string, any> | null; index?: number; budget?: number }
  | { type: 'test_run.result'; runId: string; probe: BlueprintPreflightProbe; status: BlueprintTestRunStatus; detail?: string | null; index?: number; budget?: number }
  | { type: 'step'; finishReason: string | null; toolCalls: Array<{ tool: string; input: any }>; textPreview: string }
  | { type: 'blueprint'; blueprint: any; discoveredTools: Array<{ name: string; description: string; category: string }> }
  | { type: 'done' }
  | { type: 'error'; error: string; detail?: string };

export type BadgeTone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger';

export type BotsViewScope = 'all' | 'vm';

export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  trigger: string;
  isActive: boolean;
};
