/**
 * Orchestrator / Subagent contract types.
 *
 * Defines the shared envelope types, correlation IDs, capability packs,
 * and message interfaces used by the orchestrator and all subagents.
 */

// ─── Correlation IDs ─────────────────────────────────────────────────────────

export interface SubagentCorrelation {
  /** Top-level conversation/run ID (same as the outer chat requestId) */
  runId: string;
  /** The orchestrator's own run ID (parent of this subagent) */
  parentRunId: string;
  /** Unique ID for this subagent invocation */
  subagentId: string;
}

// ─── Capability Pack ─────────────────────────────────────────────────────────

export type SubagentKind = 'browser' | 'file_ops' | 'cli_agent' | 'workflow' | 'reminders' | 'ffmpeg' | 'data_analysis' | 'media' | 'vm' | 'bot' | 'agent' | 'integration' | 'custom';

export interface CapabilityPack {
  kind: SubagentKind;
  /** Human-readable name shown in UI */
  label: string;
  /** Tool names this subagent is allowed to call */
  toolNames: string[];
  /** System prompt override for this subagent */
  systemPrompt: string;
  /** Max tool-use steps before forcing return */
  maxSteps: number;
  /** Default timeout in ms (0 or omitted = no timeout) */
  timeoutMs?: number;
}

// ─── Subagent Messages ───────────────────────────────────────────────────────

/**
 * Sent by a subagent when it needs information or a decision
 * from the orchestrator mid-execution.
 */
export interface SubagentQuestion {
  type: 'subagent_question';
  questionId: string;
  subagentId: string;
  runId: string;
  question: string;
  /** Optional structured choices the orchestrator can pick from */
  choices?: string[];
}

/**
 * Sent by the orchestrator to answer a subagent's question
 * so it can continue executing.
 */
export interface SubagentAnswer {
  type: 'subagent_answer';
  questionId: string;
  subagentId: string;
  runId: string;
  answer: string;
}

/**
 * Progress events emitted by the subagent for streaming UI updates.
 */
export interface SubagentEvent {
  type: 'subagent_event';
  subagentId: string;
  runId: string;
  event: 'started' | 'progress' | 'tool_call' | 'error' | 'completed';
  data?: Record<string, any>;
}

/**
 * Final completion message when a subagent finishes (success or failure).
 */
export interface SubagentComplete {
  type: 'subagent_complete';
  subagentId: string;
  runId: string;
  ok: boolean;
  result?: string;
  error?: string;
  toolCallCount?: number;
  durationMs?: number;
}

// ─── Delegation request (orchestrator → child) ──────────────────────────────

export interface DelegationRequest {
  kind: SubagentKind;
  instruction: string;
  context?: string;
  targetAgentId?: string;
  targetAgentName?: string;
  timeoutMs?: number;
  /** Override the default capability pack tool names */
  extraToolNames?: string[];
}

// ─── Delegation result (child → orchestrator) ───────────────────────────────

export interface DelegationResult {
  ok: boolean;
  subagentId: string;
  result?: string;
  error?: string;
  toolCallCount?: number;
  durationMs?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model?: string;
  };
}

// ─── Union of all subagent wire messages ─────────────────────────────────────

export type SubagentMessage =
  | SubagentQuestion
  | SubagentAnswer
  | SubagentEvent
  | SubagentComplete;
