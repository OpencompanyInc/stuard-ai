/**
 * Subagent Runtime
 *
 * Generic runtime for executing subagents with ask/reply support.
 * Replaces one-off delegation patterns like route_to_workflow_agent
 * with a reusable contract.
 */

import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { detectRetryableToolError } from '../routes/proactive-utils';
import { getWorkflowAgent, getWorkflowAgentForUser } from '../agents/workflow-agent';
import { getModel, getModelForUser } from '../agents/stuard/models';
import type { ModelSourcePreference } from '../utils/models';
import { writeLog } from '../utils/logger';
import { execLocalTool, getBridgeWs, getBridgeSecrets, withClientBridge, runWithSecrets } from '../tools/bridge';
import { mirrorToDesktop } from '../services/vm-stream-mirror';
import { recordNestedSubagentEvent } from '../server/chat/nested-chunk-recorder';
import {
  withActiveBridgeContext,
  setActiveBridge,
  clearActiveBridge,
  getLocalToolSpec,
  execLocalToolWithCapturedBridge,
} from '../tools/device/shared';
import type {
  CapabilityPack,
  DelegationRequest,
  DelegationResult,
  SubagentCorrelation,
  SubagentQuestion,
  SubagentAnswer,
} from './types';
import { getCapabilityPack, buildCustomPack, buildIntegrationPack, resolveIntegrationTools } from './capability-packs';
import { createInterjectionUserMessage } from '../server/chat/interjections';
import { LiveUsageBillingTracker } from '../services/live-usage-billing';
import { normalizeUsage } from '../utils/usage';
import { computeBudget, estimateTokens } from '../memory/token-budget';
import { compactHistory, pruneToolOutputs } from '../memory/context-compactor';
import type { ModelChoice } from '../router/model-router';
import { ensureExecutionToolsRegistered } from './execution-tools-bootstrap';
import { resolveExecutionTools } from './execution-tools-resolver';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../shared/integration-flags';

// Track running subagents so they can be aborted when the parent stream is cancelled.
// The request/socket metadata keeps a stop from one chat turn from cancelling
// unrelated delegated work on another connection.
type RunningSubagent = {
  controller: AbortController;
  requestId?: string;
  chatWs?: any;
  bridgeWs?: any;
};

const runningSubagents = new Map<string, RunningSubagent>();
const DEFAULT_SUBAGENT_LOCAL_TOOL_TIMEOUT_MS = 30 * 60 * 1000;

function abortWithReason(controller: AbortController, reason: string) {
  try {
    (controller as any).abort(reason);
  } catch {
    try { controller.abort(); } catch {}
  }
}

function getAbortReason(signal?: AbortSignal | null): string {
  const reason = (signal as any)?.reason;
  if (typeof reason === 'string' && reason) return reason;
  if (reason && typeof reason?.message === 'string') return reason.message;
  return signal?.aborted ? 'aborted' : '';
}

function formatSubagentAbortMessage(reason: string): string {
  if (reason === 'client_stop') return 'Subagent was cancelled';
  if (reason === 'socket_closed') return 'Subagent aborted because the socket closed';
  if (reason === 'hard_timeout') return 'Subagent aborted because the parent request timed out';
  if (reason === 'parent_abort') return 'Subagent aborted because the parent request stopped';
  return reason ? `Subagent aborted (${reason})` : 'Subagent was cancelled';
}

export function abortRunningSubagent(subagentId: string, reason = 'external_abort'): boolean {
  const running = runningSubagents.get(subagentId);
  if (running) {
    abortWithReason(running.controller, reason);
    runningSubagents.delete(subagentId);
    return true;
  }
  return false;
}

/**
 * Whether a delegated subagent is currently executing in this process.
 * Used by the WS steer handler to reject `subagent_steer` requests for
 * unknown ids — otherwise a steer enqueued for a finished/missing subagent
 * would sit in `subagentSteerQueues` forever and the user would get a
 * misleading `accepted: true` ack.
 */
export function isSubagentRunning(subagentId: string): boolean {
  return runningSubagents.has(subagentId);
}

export function abortAllRunningSubagents(reason = 'external_abort'): number {
  let count = 0;
  for (const [, running] of runningSubagents) {
    abortWithReason(running.controller, reason);
    count++;
  }
  runningSubagents.clear();
  return count;
}

export function abortRunningSubagentsForRequest(chatWs: any, requestId?: string, reason = 'request_abort'): number {
  let count = 0;
  for (const [id, running] of Array.from(runningSubagents.entries())) {
    const sameRequest = requestId
      ? running.requestId === requestId
      : true;
    const sameSocket = !chatWs || running.chatWs === chatWs || running.bridgeWs === chatWs;
    if (!sameSocket || !sameRequest) continue;
    abortWithReason(running.controller, reason);
    runningSubagents.delete(id);
    count++;
  }
  return count;
}

// Resolved at startup via execution-tools-resolver to break the circular
// dependency: stuard/tools → meta-tools → workflow-subagent → subagent-runtime.
function getExecutionToolsLazy(): Record<string, any> {
  return resolveExecutionTools();
}

// ─── Ask/Reply Channel ──────────────────────────────────────────────────────

type QuestionResolver = (answer: string) => void;
const pendingQuestions = new Map<string, QuestionResolver>();

/**
 * Answer a pending subagent question by its questionId.
 * Called by the orchestrator's `reply_to_subagent` tool.
 */
export function answerSubagentQuestion(questionId: string, answer: string): boolean {
  const resolver = pendingQuestions.get(questionId);
  if (!resolver) return false;
  pendingQuestions.delete(questionId);
  resolver(answer);
  return true;
}

/** Get the count of pending questions (for diagnostics). */
export function getPendingQuestionCount(): number {
  return pendingQuestions.size;
}

// ─── Mid-flight steering for delegated subagents ─────────────────────────────
//
// The desktop UI can nudge an in-flight delegated subagent by id. Steers are
// queued in-process and drained at the next step boundary (prepareStep). This
// is in-process only — the subagent runs inside the cloud-ai server and has no
// entry in the local Python registry, so the WS handler routes here directly.

type SteerEntry = { text: string; timestamp: number };
const subagentSteerQueues = new Map<string, SteerEntry[]>();

/** Queue a steering message for a running delegated subagent. Returns new depth. */
export function enqueueSubagentSteer(subagentId: string, text: string): number {
  const trimmed = String(text || '').trim();
  if (!subagentId || !trimmed) return 0;
  const queue = subagentSteerQueues.get(subagentId) || [];
  queue.push({ text: trimmed, timestamp: Date.now() });
  subagentSteerQueues.set(subagentId, queue);
  return queue.length;
}

/** Atomically pop pending steer messages for a subagent. */
export function drainSubagentSteers(subagentId: string): SteerEntry[] {
  const queue = subagentSteerQueues.get(subagentId);
  if (!queue || queue.length === 0) return [];
  subagentSteerQueues.delete(subagentId);
  return queue;
}

/** Returns true if there's at least one queued steer for this subagent. */
export function hasPendingSubagentSteers(subagentId: string): boolean {
  const queue = subagentSteerQueues.get(subagentId);
  return !!queue && queue.length > 0;
}

function getStreamTextDelta(chunk: any): string {
  const payload = chunk?.payload;
  if (typeof payload === 'string') return payload;
  return String(payload?.text || chunk?.text || chunk?.textDelta || chunk?.delta || '');
}

function getStreamToolCall(chunk: any) {
  const payload = chunk?.payload && typeof chunk.payload === 'object' ? chunk.payload : {};
  const toolName = String(payload.toolName || payload.tool || payload.name || chunk?.toolName || chunk?.tool || chunk?.name || 'tool');
  const toolCallId = String(payload.toolCallId || payload.id || chunk?.toolCallId || chunk?.id || `subagent-tool-${Date.now()}`);
  const args = payload.args ?? payload.input ?? chunk?.args ?? chunk?.input ?? {};
  return { toolName, toolCallId, args, raw: { ...payload, ...chunk, toolName, toolCallId, args } };
}

function getStreamToolResult(chunk: any) {
  const payload = chunk?.payload && typeof chunk.payload === 'object' ? chunk.payload : {};
  const toolName = String(payload.toolName || payload.tool || payload.name || chunk?.toolName || chunk?.tool || chunk?.name || 'tool');
  const toolCallId = String(payload.toolCallId || payload.id || chunk?.toolCallId || chunk?.id || `subagent-tool-${Date.now()}`);
  const result = payload.result ?? chunk?.result ?? payload.output ?? chunk?.output;
  const status = String(payload.status || chunk?.status || '').toLowerCase();
  const error = payload.error ?? chunk?.error ?? result?.error;
  const isError =
    status === 'error' ||
    status === 'failed' ||
    status === 'timeout' ||
    typeof error !== 'undefined' ||
    result?.ok === false;
  return { toolName, toolCallId, result, status, error, isError };
}

function getReturnControlSummary(toolName: string, result: any): string {
  if (toolName !== 'return_control' || !result) return '';
  const parsed = typeof result === 'string'
    ? (() => { try { return JSON.parse(result); } catch { return {}; } })()
    : result;
  return typeof parsed?.summary === 'string' ? parsed.summary : '';
}

/**
 * Resolve a stream result's final text to a plain string.
 *
 * In AI SDK v6 / Mastra, `streamResult.text` is a `Promise<string>`, not a
 * string. Assigning it straight into `fullText` (as the no-text-delta fallback
 * did) left a Promise where a string was expected, so downstream `text.slice` /
 * `text.length` calls threw "text.slice is not a function" — which masked the
 * real upstream error (e.g. a provider 400) as a confusing subagent crash.
 */
async function resolveFinalStreamText(streamResult: any): Promise<string> {
  const raw = streamResult?.text;
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw?.then === 'function') {
    try {
      const awaited = await raw;
      return typeof awaited === 'string' ? awaited : '';
    } catch {
      return '';
    }
  }
  return typeof raw === 'object' ? '' : String(raw);
}

// ─── Child-side tools ────────────────────────────────────────────────────────

function makeAskOrchestratorTool(
  correlation: SubagentCorrelation,
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>,
) {
  return createTool({
    id: 'ask_orchestrator',
    description:
      'Ask the orchestrator a question when you need information, a user decision, or context ' +
      'that is not available in your current tool set. The orchestrator will respond and you can continue.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the orchestrator.'),
      choices: z.array(z.string()).optional().describe('Optional choices the orchestrator can pick from.'),
    }),
    execute: async ({ question, choices }) => {
      const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      writeLog('subagent_ask_orchestrator', {
        subagentId: correlation.subagentId,
        questionId,
        question,
      });

      const questionMsg: SubagentQuestion = {
        type: 'subagent_question',
        questionId,
        subagentId: correlation.subagentId,
        runId: correlation.runId,
        question,
        choices,
      };

      if (onQuestion) {
        try {
          const answer = await onQuestion(questionMsg);
          return { ok: true, answer: answer.answer };
        } catch (e: any) {
          return { ok: false, error: e.message || 'No answer received' };
        }
      }

      return { ok: false, error: 'No onQuestion handler — ask_orchestrator is not connected to the orchestrator.' };
    },
  });
}

function makeReturnControlTool(correlation: SubagentCorrelation) {
  return createTool({
    id: 'return_control',
    description:
      'Return control to the orchestrator with a summary of what you accomplished. ' +
      'Call this when you have finished the delegated task or cannot proceed further.',
    inputSchema: z.object({
      summary: z.string().describe('Summary of what was accomplished or why you are returning early.'),
      success: z.boolean().default(true).describe('Whether the task was completed successfully.'),
    }),
    execute: async ({ summary, success }) => {
      writeLog('subagent_return_control', {
        subagentId: correlation.subagentId,
        success,
        summaryLength: summary.length,
      });
      // Signal completion — the outer runner reads this from the result
      return { ok: true, returned: true, summary, success };
    },
  });
}

function makeReportProgressTool(correlation: SubagentCorrelation) {
  return createTool({
    id: 'report_progress',
    description: 'Report progress to the orchestrator for streaming UI updates.',
    inputSchema: z.object({
      message: z.string().describe('Progress update message.'),
      percentComplete: z.number().min(0).max(100).optional(),
    }),
    execute: async ({ message, percentComplete }) => {
      writeLog('subagent_progress', {
        subagentId: correlation.subagentId,
        message,
        percentComplete,
      });
      return { ok: true };
    },
  });
}

// ─── Build subagent ──────────────────────────────────────────────────────────

function makeGetOwnStatusTool(
  correlation: SubagentCorrelation,
  targetKind: 'agent' | 'bot',
  targetId?: string,
  targetName?: string,
) {
  return createTool({
    id: 'get_own_status',
    description:
      'Inspect your own proactive agent/bot status snapshot: scheduler status, recent wake-ups, task queue, private kanban cards, and run log. ' +
      'This is self-inspection for the delegated agent, not asking another bot.',
    inputSchema: z.object({
      task_limit: z.number().int().min(1).max(50).optional().default(12),
      wake_limit: z.number().int().min(1).max(20).optional().default(8),
      memory_limit: z.number().int().min(1).max(50).optional().default(20),
      pull_vm_memory: z.boolean().optional().default(true),
    }),
    execute: async ({ task_limit, wake_limit, memory_limit, pull_vm_memory }) => {
      const args: Record<string, any> = {
        task_limit,
        wake_limit,
        memory_limit,
        pull_vm_memory,
      };
      if (targetKind === 'agent') {
        if (targetId) args.agent_id = targetId;
      } else if (targetId) {
        args.bot_id = targetId;
      }
      if (targetName) args.name = targetName;

      writeLog('subagent_get_own_status', {
        subagentId: correlation.subagentId,
        targetKind,
        targetId,
        targetName,
      });

      // silent: this tool is already surfaced to the UI as the nested
      // `get_own_status` subagent step. The inner bridge call to bot/agent
      // status is the same logical action under a different tool name, so
      // emitting it too produces a duplicate that — when ALS subagent tagging
      // is lost (see wrapToolWithBridge note re: AI-SDK breaking ALS) — leaks
      // out of the delegation rectangle as a stray top-level "Bot Get Status".
      return execLocalTool(
        targetKind === 'agent' ? 'agent_get_status' : 'bot_get_status',
        args,
        undefined,
        30_000,
        { noFallback: true, silent: true },
      );
    },
  });
}

/**
 * Wrap a tool's execute function so it re-enters the bridge ALS context.
 *
 * Mastra/AI SDK's generateText internally breaks AsyncLocalStorage propagation,
 * so tools called during agent.generate() lose the bridge context. This wrapper
 * captures the bridge WS + secrets at build time and re-applies them on every
 * tool invocation, ensuring execLocalTool / hasClientBridge work correctly.
 *
 * Creates a fresh tool via createTool to guarantee Mastra uses the new execute
 * function (Object.create cloning may not work if Mastra stores execute internally).
 */
export function wrapToolWithBridge(tool: any, bridgeWs: any, bridgeSecrets?: Record<string, any>): any {
  if (!tool || typeof tool.execute !== 'function') return tool;

  const originalExecute = tool.execute.bind(tool);
  const toolId = tool.id || tool.name || 'unknown';
  const toolDesc = tool.description || '';
  const inputSchema = tool.inputSchema || tool.parameters || z.any();
  const outputSchema = tool.outputSchema || z.any();
  const localToolSpec = getLocalToolSpec(tool);

  const wrapped = createTool({
    id: toolId,
    description: toolDesc,
    inputSchema,
    outputSchema,
    execute: async (args: any, ctx: any) => {
      const wsState = bridgeWs?.readyState ?? -1;
      if (toolId.startsWith('browser_use_')) {
        console.log(`[wrapToolWithBridge:${toolId}] execute called | bridgeWs=${!!bridgeWs} readyState=${wsState}`);
      }
      if (bridgeWs && bridgeWs.readyState === 1) {
        const activeBridgeScope = setActiveBridge(bridgeWs, bridgeSecrets);
        try {
          if (localToolSpec) {
            const subagentToolSpec = typeof localToolSpec.timeoutMs === 'undefined'
              ? { ...localToolSpec, timeoutMs: DEFAULT_SUBAGENT_LOCAL_TOOL_TIMEOUT_MS }
              : localToolSpec;
            return await execLocalToolWithCapturedBridge(
              toolId,
              args,
              ctx?.writer,
              subagentToolSpec,
              { ws: bridgeWs, secrets: bridgeSecrets },
            );
          }
          return await withActiveBridgeContext(
            bridgeWs,
            bridgeSecrets,
            () => withClientBridge(bridgeWs, () => originalExecute(args, ctx), bridgeSecrets),
          );
        } finally {
          clearActiveBridge(activeBridgeScope);
        }
      }
      // WS unavailable/closed but secrets were captured at build time —
      // inject secrets-only ALS so tools (e.g. Google) can still read
      // userId via getBridgeSecrets().
      if (bridgeSecrets) {
        // Also push to module-level stack so getResolvedBridgeSecrets()
        // can find secrets even when ALS propagation is broken by Mastra.
        const secretsScope = setActiveBridge(null, bridgeSecrets);
        try {
          return await runWithSecrets(bridgeSecrets, () => originalExecute(args, ctx));
        } finally {
          clearActiveBridge(secretsScope);
        }
      }
      return originalExecute(args, ctx);
    },
  });
  return wrapped;
}

async function buildSubagent(
  pack: CapabilityPack,
  correlation: SubagentCorrelation,
  model: ModelChoice = 'balanced',
  modelId?: string,
  bridgeWs?: any,
  bridgeSecrets?: Record<string, any>,
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>,
  userId?: string | null,
  modelSource?: ModelSourcePreference | string | null,
  request?: DelegationRequest,
): Promise<Agent> {
  const executionTools = getExecutionToolsLazy();
  const selectedModel = (userId && modelSource)
    ? await getModelForUser(model, modelId, userId, modelSource)
    : getModel(model, modelId);

  const askTool = makeAskOrchestratorTool(correlation, onQuestion);
  const returnTool = makeReturnControlTool(correlation);
  const progressTool = makeReportProgressTool(correlation);

  if (pack.kind === 'agent' || pack.kind === 'bot') {
    const targetKind = pack.kind;
    const targetId = String(request?.targetAgentId || '').trim();
    const targetName = String(request?.targetAgentName || '').trim();
    const statusArgs: Record<string, any> = {
      task_limit: 12,
      wake_limit: 8,
      memory_limit: 20,
      pull_vm_memory: true,
    };
    if (targetKind === 'agent') {
      if (targetId) statusArgs.agent_id = targetId;
    } else if (targetId) {
      statusArgs.bot_id = targetId;
    }
    if (targetName) statusArgs.name = targetName;

    let statusSnapshot: any = null;
    try {
      // silent: this is a build-time snapshot used only to assemble the
      // subagent's system prompt. It runs in the orchestrator's async context
      // (before the subagent correlation exists), so it carries no __subagentId
      // and would otherwise stream an untagged "Bot Get Status" tool event that
      // renders outside the delegation rectangle. The user never needs to see it.
      statusSnapshot = await execLocalTool(
        targetKind === 'agent' ? 'agent_get_status' : 'bot_get_status',
        statusArgs,
        undefined,
        30_000,
        { noFallback: true, silent: true },
      );
    } catch (error: any) {
      statusSnapshot = { ok: false, error: error?.message || String(error) };
    }

    const botInfo = statusSnapshot?.bot && typeof statusSnapshot.bot === 'object' ? statusSnapshot.bot : {};
    const config = botInfo?.config && typeof botInfo.config === 'object' ? botInfo.config : {};
    const resolvedBotId = String(botInfo?.id || targetId || '').trim() || undefined;
    const resolvedBotName = String(botInfo?.name || targetName || '').trim() || undefined;
    const configuredModel = String(config?.modelMode || '').trim().toLowerCase();
    const delegatedModel = configuredModel === 'fast' || configuredModel === 'balanced' || configuredModel === 'smart'
      ? configuredModel as ModelChoice
      : model;
    const delegatedModelId = typeof config?.modelId === 'string' && config.modelId.trim()
      ? config.modelId.trim()
      : modelId;
    const promptAddendum = [
      botInfo?.systemPrompt ? `## Configured Agent System Prompt\n${String(botInfo.systemPrompt).trim()}` : '',
      botInfo?.storedFacts ? `## Configured Agent Stored Facts\n${String(botInfo.storedFacts).trim()}` : '',
      '## Delegated Orchestrator Run',
      `You are running as a delegated subagent under the orchestrator. Your delegated subagent id is ${correlation.subagentId}.`,
      'Do exactly what the orchestrator asks in this run. Treat the user request as coming through the orchestrator, not as a scheduler wake-up.',
      'For status/update requests, call get_own_status first and summarize from your own status, queue, private kanban, recent wake-ups, and run log. Do not call ask_bot or ask_agent.',
      'Use your configured added tools and private kanban tools normally. If you need user-only information or a decision, call ask_orchestrator.',
      'When finished, call return_control with the concise answer the orchestrator should show the user.',
      config?.instructions ? `\n## Configured Agent Instructions\n${String(config.instructions).trim()}` : '',
    ].filter(Boolean).join('\n\n');

    const { getBotAgent, getBotAgentForUser } = await import('../agents/bot-agent');
    const extraTools = {
      ask_orchestrator: askTool,
      return_control: returnTool,
      report_progress: progressTool,
      get_own_status: wrapToolWithBridge(
        makeGetOwnStatusTool(correlation, targetKind, resolvedBotId, resolvedBotName),
        bridgeWs,
        bridgeSecrets,
      ),
    };
    const botAgent = (userId && modelSource)
      ? await getBotAgentForUser({
          botId: resolvedBotId,
          botName: resolvedBotName,
          model: delegatedModel,
          modelId: delegatedModelId,
          modelSource,
          userId,
          allowedTools: Array.isArray(config?.allowedTools) ? config.allowedTools : [],
          extraTools,
          promptAddendum,
        })
      : getBotAgent({
          botId: resolvedBotId,
          botName: resolvedBotName,
          model: delegatedModel,
          modelId: delegatedModelId,
          allowedTools: Array.isArray(config?.allowedTools) ? config.allowedTools : [],
          extraTools,
          promptAddendum,
        });

    const toolNames = (botAgent as any).__activeToolNames || Object.keys((botAgent as any).tools || {});
    writeLog('subagent_build', {
      subagentId: correlation.subagentId,
      kind: pack.kind,
      model: delegatedModel,
      modelId: delegatedModelId || '(default)',
      targetId: resolvedBotId,
      targetName: resolvedBotName,
      statusResolved: !!statusSnapshot?.ok,
      statusError: statusSnapshot?.ok === false ? statusSnapshot?.error : undefined,
      toolCount: toolNames.length,
      resolvedTools: toolNames,
      usesConfiguredBotAgent: true,
    });

    return botAgent;
  }

  if (pack.kind === 'workflow') {
    const workflowAgent = (userId && modelSource)
      ? await getWorkflowAgentForUser({
          modelId,
          includeCreateWorkflow: true,
          extraTools: {
            ask_orchestrator: askTool,
            return_control: returnTool,
            report_progress: progressTool,
          },
          id: `subagent-workflow-${correlation.subagentId.slice(0, 8)}`,
          name: `${pack.label} Subagent`,
          bridgeWs,
          bridgeSecrets,
          userId,
          modelSource,
        })
      : getWorkflowAgent({
          modelId,
          includeCreateWorkflow: true,
          extraTools: {
            ask_orchestrator: askTool,
            return_control: returnTool,
            report_progress: progressTool,
          },
          id: `subagent-workflow-${correlation.subagentId.slice(0, 8)}`,
          name: `${pack.label} Subagent`,
          bridgeWs,
          bridgeSecrets,
        });
    const toolNames = (workflowAgent as any).__activeToolNames || Object.keys((workflowAgent as any).tools || {});

    writeLog('subagent_build', {
      subagentId: correlation.subagentId,
      kind: pack.kind,
      model: 'workflow-studio-agent',
      modelId: modelId || process.env.WORKFLOW_MODEL_ID || '(workflow default)',
      toolCount: toolNames.length,
      packToolCount: pack.toolNames.length,
      resolvedTools: toolNames,
      hasBridgeWrap: !!bridgeWs,
      usesStudioWorkflowAgent: true,
    });

    return workflowAgent;
  }

  // Build tool set: capability pack tools from the full universe + control tools
  const tools: Record<string, any> = {};
  const missingTools: string[] = [];
  for (const name of pack.toolNames) {
    if (executionTools[name]) {
      // Wrap with bridge context so tools work inside agent.generate().
      // Also wrap when bridgeSecrets exists without a WS — the wrapper's
      // runWithSecrets fallback ensures getBridgeSecrets() returns userId.
      tools[name] = (bridgeWs || bridgeSecrets)
        ? wrapToolWithBridge(executionTools[name], bridgeWs, bridgeSecrets)
        : executionTools[name];
    } else {
      missingTools.push(name);
    }
  }
  tools.ask_orchestrator = askTool;
  tools.return_control = returnTool;
  tools.report_progress = progressTool;

  const toolNames = Object.keys(tools);
  writeLog('subagent_build', {
    subagentId: correlation.subagentId,
    kind: pack.kind,
    model,
    modelId: modelId || '(default)',
    toolCount: toolNames.length,
    packToolCount: pack.toolNames.length,
    missingTools: missingTools.length > 0 ? missingTools : undefined,
    resolvedTools: toolNames,
    hasBridgeWrap: !!bridgeWs,
  });

  if (missingTools.length > 0) {
    console.warn(`[subagent] WARNING: ${missingTools.length} tools from ${pack.kind} pack not found in execution universe:`, missingTools);
  }

  const agent = new Agent({
    id: `subagent-${pack.kind}-${correlation.subagentId.slice(0, 8)}`,
    name: `${pack.label} Subagent`,
    instructions: `${pack.systemPrompt}\n\n## Delegation Identity\n\nYour delegated subagent id is ${correlation.subagentId}. If you need missing user or orchestrator context, call ask_orchestrator; it automatically includes this id for correlation.`,
    model: selectedModel as any,
    tools,
  });

  (agent as any).__activeToolNames = toolNames;
  (agent as any).__modelSource = (selectedModel as any)?.__stuardResolvedSource;
  (agent as any).__billingExcluded = !!(selectedModel as any)?.__stuardBillingExcluded;
  return agent;
}

// ─── Run subagent ────────────────────────────────────────────────────────────

export interface RunSubagentOptions {
  request: DelegationRequest;
  runId: string;
  parentRunId: string;
  model?: ModelChoice;
  modelId?: string;
  /** Acting user, used to resolve BYOK / ChatGPT-subscription credentials. */
  userId?: string | null;
  /** Billing source preference to inherit from the parent orchestrator. */
  modelSource?: ModelSourcePreference | string | null;
  bridgeWs?: any;
  bridgeSecrets?: Record<string, any>;
  /**
   * Primary chat WS — where streaming events (`subagent_event`) must flow back
   * to the user. In the desktop flow this equals `bridgeWs`. In the VM-agent
   * flow the bridge is the desktop (for device tools) while the chat channel
   * is the VM-agent WS, which relays back via Python → vm-agent SSE → UI.
   */
  chatWs?: any;
  onEvent?: (event: any) => void;
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>;
  abortSignal?: AbortSignal;
}

export async function runSubagent(opts: RunSubagentOptions): Promise<DelegationResult> {
  await ensureExecutionToolsRegistered();

  const {
    request,
    runId,
    parentRunId,
    model = 'balanced',
    modelId,
    userId: explicitUserId,
    modelSource: explicitModelSource,
    bridgeWs: explicitBridgeWs,
    bridgeSecrets: explicitBridgeSecrets,
    chatWs: explicitChatWs,
    onEvent,
    onQuestion,
    abortSignal: explicitAbortSignal,
  } = opts;

  const subagentId = `sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const correlation: SubagentCorrelation = { runId, parentRunId, subagentId };
  const startTime = Date.now();

  // Resolve bridge context up-front so integration packs can include the
  // acting user's identity in their system prompt (the integration tools
  // already authenticate as this user via their stored OAuth tokens).
  const bridgeWs = explicitBridgeWs || getBridgeWs();
  const bridgeSecrets = explicitBridgeSecrets || getBridgeSecrets();
  const inheritedAbortSignal = bridgeSecrets?.__abortSignal as AbortSignal | undefined;
  const externalSignal = explicitAbortSignal || (
    inheritedAbortSignal && typeof inheritedAbortSignal === 'object' && 'aborted' in inheritedAbortSignal
      ? inheritedAbortSignal
      : undefined
  );

  // Resolve capability pack
  let pack: CapabilityPack | undefined;
  if (request.kind === 'integration') {
    // Build integration pack dynamically
    const allToolNames = Object.keys(getExecutionToolsLazy());
    const contextHint = request.context || request.instruction;
    // Try to detect which integration group from the instruction
    const groupName = detectIntegrationGroup(contextHint);
    if (groupName) {
      const toolNames = resolveIntegrationTools(groupName, allToolNames);
      const identity = {
        userId: typeof bridgeSecrets?.userId === 'string' ? bridgeSecrets.userId : undefined,
        email: typeof bridgeSecrets?.email === 'string' ? bridgeSecrets.email : undefined,
        username: typeof bridgeSecrets?.username === 'string' ? bridgeSecrets.username : undefined,
      };
      pack = buildIntegrationPack(groupName, toolNames, identity);
    }
  } else if (request.kind === 'custom') {
    // Ad-hoc subagent: tools + system prompt supplied by the orchestrator.
    pack = buildCustomPack(request.customToolNames, request.customSystemPrompt);
  } else {
    pack = getCapabilityPack(request.kind);
  }

  if (!pack) {
    return {
      ok: false,
      subagentId,
      error: `No capability pack found for kind: ${request.kind}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Merge extra tools if specified
  if (request.extraToolNames?.length) {
    pack = { ...pack, toolNames: [...pack.toolNames, ...request.extraToolNames] };
  }

  const subagentBridgeSecrets: Record<string, any> = {
    ...(bridgeSecrets || {}),
    __subagentId: subagentId,
    __subagentKind: request.kind,
  };
  // Chat WS is the user-facing stream channel — prefer explicit opt, then the
  // __chatWs stashed on bridgeSecrets by runAgent. Falls back to bridgeWs so
  // the desktop flow (where chat and bridge are the same) keeps working.
  const chatWs = explicitChatWs || (bridgeSecrets as any)?.__chatWs || undefined;
  const requestId =
    typeof (bridgeSecrets as any)?.__requestId === 'string' && (bridgeSecrets as any).__requestId
      ? (bridgeSecrets as any).__requestId
      : undefined;

  const localAbort = new AbortController();
  runningSubagents.set(subagentId, {
    controller: localAbort,
    requestId,
    chatWs,
    bridgeWs,
  });

  let onExternalAbort: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortWithReason(localAbort, getAbortReason(externalSignal) || 'parent_abort');
    } else {
      onExternalAbort = () => abortWithReason(localAbort, getAbortReason(externalSignal) || 'parent_abort');
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  writeLog('subagent_start', {
    subagentId,
    kind: request.kind,
    instruction: request.instruction.slice(0, 200),
    requestId,
  });

  // NOTE: the `started` event is emitted via emitToClient further below,
  // after bridgeWs is resolved, so it reaches the desktop client.

  // Inherit the parent's billing source (subscription / api_key / stuard) so
  // delegated subagents don't silently fall back to friendly billed inference
  // when the orchestrator was running on a user's ChatGPT subscription or BYOK.
  const inheritedUserId = explicitUserId
    ?? (typeof bridgeSecrets?.userId === 'string' ? bridgeSecrets.userId : undefined);
  const inheritedModelSource = explicitModelSource
    ?? (typeof bridgeSecrets?.__modelSource === 'string' ? bridgeSecrets.__modelSource : undefined);

  const agent = await buildSubagent(
    pack,
    correlation,
    model,
    modelId,
    bridgeWs,
    subagentBridgeSecrets,
    onQuestion,
    inheritedUserId,
    inheritedModelSource,
    request,
  );
  const timeoutMs = request.timeoutMs ?? pack.timeoutMs ?? 0;

  let prompt = request.instruction;
  if (request.context) {
    prompt += `\n\nAdditional context:\n${request.context}`;
  }

  // Register the bridge at module level so makeLocalTool's getFallbackBridgeScope()
  // can always find it, even after Mastra's agent.stream() breaks ALS propagation
  // and wrapToolWithBridge's per-tool re-entry may not fire.
  const bridgeOpen = bridgeWs ? (bridgeWs as any).readyState === 1 : false;
  // Always push secrets to module-level stack so tools can find userId
  // even when ALS propagation is broken by Mastra's agent.stream().
  const runtimeBridgeScope = (bridgeWs && bridgeOpen)
    ? setActiveBridge(bridgeWs, subagentBridgeSecrets)
    : setActiveBridge(null, subagentBridgeSecrets);

  let suppressClientEvents = false;

  const emitToClient = (event: string, data: any, opts?: { force?: boolean }) => {
    if (suppressClientEvents && !opts?.force) return;
    const msg = {
      type: 'subagent_event' as const,
      subagentId,
      runId,
      ...(requestId ? { requestId } : {}),
      event,
      data,
    };
    // Send to every distinct WS target: the primary chat channel (so the
    // end-user UI sees streaming updates) AND the bridge (so a desktop user
    // observing through CloudChatPanel still gets mirrored events when the
    // chat channel is a different WS — the VM-agent path).
    const seen = new Set<any>();
    const targets = [chatWs, bridgeWs];
    for (const target of targets) {
      if (!target || seen.has(target)) continue;
      seen.add(target);
      try {
        if ((target as any).readyState === WebSocket.OPEN) {
          (target as any).send(JSON.stringify(msg));
        }
      } catch {}
    }
    // Legacy hook for any registered VM→desktop mirror on the bridge WS.
    if (bridgeWs) {
      try { mirrorToDesktop(bridgeWs as any, msg); } catch {}
    }
    // Persist this subagent activity into the orchestrator turn's chunk log so
    // it survives a chat reopen (the live UI gets it via the WS message above;
    // this is the saved-locally copy). Best-effort, keyed by the chat request.
    try { recordNestedSubagentEvent(requestId, event, data, subagentId, request.kind); } catch {}
    onEvent?.({ ...msg });
  };

  emitToClient('started', { kind: request.kind, label: request.kind });

  let streamUsage: any = null;
  const finishedSteps: Array<{ usage: any; providerMetadata: any }> = [];
  const resolvedModelId = modelId || (typeof model === 'string' ? model : 'balanced');
  const kindLabels: Record<string, string> = {
    browser: 'Browser Agent',
    file_ops: 'File Agent',
    cli_agent: 'CLI Agent',
    workflow: 'Workflow Agent',
    reminders: 'Reminders Agent',
    media: 'Media Agent',
    ffmpeg: 'FFmpeg Agent',
    vm: 'VM Agent',
    bot: 'Bot Agent',
    agent: 'Agent Subagent',
    custom: 'Custom Agent',
  };
  const sourceLabel = `Subagent: ${kindLabels[request.kind] || request.kind}`;
  const parentConversationId =
    typeof bridgeSecrets?.conversationId === 'string' &&
    bridgeSecrets.conversationId.trim()
      ? bridgeSecrets.conversationId.trim()
      : null;
  // Skip Stuard credit billing when the parent orchestrator was running on the
  // user's own ChatGPT/Codex subscription or BYOK key — the underlying API
  // call is already paid for by the user, so subagents must not double-charge.
  const billingExcluded =
    !!(agent as any)?.__billingExcluded ||
    bridgeSecrets?.__billingExcluded === true;
  const billingTracker = new LiveUsageBillingTracker({
    userId: inheritedUserId ?? bridgeSecrets?.userId,
    conversationId: parentConversationId,
    model: resolvedModelId,
    sourceRef: `subagent:${subagentId}`,
    sourceType: 'subagent',
    sourceLabel,
    billingExcluded,
    onSettlement: (summary) => {
      emitToClient('billing_update', {
        sourceRef: summary.sourceRef,
        trigger: summary.trigger,
        stepNumber: summary.stepNumber,
        conversationId: parentConversationId,
        model: resolvedModelId,
        sourceType: 'subagent',
        sourceLabel,
        subagentKind: request.kind,
        delta: summary.delta,
        cumulative: summary.cumulative,
      });
    },
  });

  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | undefined;

  try {
    // Only create a timeout promise if timeoutMs > 0 (0 = no timeout)
    const timeoutPromise = timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            timedOut = true;
            abortWithReason(localAbort, 'timeout');
            reject(new Error(`Subagent timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      : null;

    const abortPromise = new Promise<never>((_, reject) => {
      if (localAbort.signal.aborted) {
        reject(new Error('Subagent aborted'));
        return;
      }
      localAbort.signal.addEventListener('abort', () => reject(new Error('Subagent aborted')), { once: true });
    });

    writeLog('subagent_bridge_check', { subagentId, hasBridge: !!bridgeWs, wsOpen: bridgeOpen });
    console.log(`[subagent:${subagentId}] bridge: has=${!!bridgeWs} open=${bridgeOpen} | model=${model} modelId=${modelId || '(default)'}`);

    const MAX_RETRIES = 3;
    const toolErrorHistory: string[] = [];
    let attempt = 0;
    let fullText = '';
    let allToolCalls: any[] = [];
    let returnControlResult = '';

    // Halt-and-resume compaction state
    const resolvedBudgetModelId = modelId || (typeof model === 'string' ? model : 'balanced');
    const budget = computeBudget(resolvedBudgetModelId);
    let cumulativeInputTokens = 0;
    let needsCompaction = false;
    let compactionAbort: AbortController | null = null;
    const MAX_COMPACTION_ROUNDS = 3;
    let compactionRound = 0;
    let streamAccumulatedMessages: any[] = [];

    while (attempt <= MAX_RETRIES) {
      let messages: any[] = toolErrorHistory.length > 0
        ? [
            { role: 'system', content: pack.systemPrompt },
            { role: 'user', content: prompt },
            { role: 'assistant', content: 'I tried to use a tool.' },
            { role: 'user', content: `[System: Tool call failed] ${toolErrorHistory[toolErrorHistory.length - 1]}. Please use only the tools available to you. Do NOT invent or guess tool names.` },
          ]
        : [
            { role: 'system', content: pack.systemPrompt },
            { role: 'user', content: prompt },
          ];

      try {
        // Create per-stream abort controller that chains to the main one
        compactionAbort = new AbortController();
        needsCompaction = false;
        streamAccumulatedMessages = [];
        const onLocalAbort = () => {
          if (compactionAbort) abortWithReason(compactionAbort, getAbortReason(localAbort.signal) || 'parent_abort');
        };
        localAbort.signal.addEventListener('abort', onLocalAbort, { once: true });

        const buildStreamOptions = () => ({
          maxSteps: pack.maxSteps,
          abortSignal: compactionAbort?.signal ?? localAbort.signal,
          prepareStep: async ({ messages: stepMessages }: any) => {
            if (Array.isArray(stepMessages)) {
              streamAccumulatedMessages = [...stepMessages];
            }

            // Drain any user-queued steers and inject them as a user message
            // before the next LLM call. Applied between steps (tool boundaries),
            // never mid-tool-call. Matches the main-chat interjection pattern.
            const steers = drainSubagentSteers(subagentId);
            if (steers.length === 0) return {};

            const base = Array.isArray(stepMessages) ? stepMessages : [];
            const content =
              '[User steering — applied mid-task]\n' +
              steers
                .map((s, i) => `Steer ${i + 1}: ${s.text}`)
                .join('\n') +
              '\n\nUse this guidance in the next step before continuing.';

            for (const s of steers) {
              emitToClient('user_steer', { text: s.text, timestamp: s.timestamp });
            }
            writeLog('subagent_steer_applied', { subagentId, count: steers.length });

            return { messages: [...base, createInterjectionUserMessage(content)] };
          },
          onStepFinish: async (stepData: any) => {
            finishedSteps.push({
              usage: stepData?.usage,
              providerMetadata: stepData?.providerMetadata,
            });
            await billingTracker.settleIncrement(stepData, {
              trigger: 'step_finish',
              stepNumber: finishedSteps.length,
            });

            // Track cumulative tokens for compaction
            const stepUsage = stepData?.usage;
            if (stepUsage) {
              const normalized = normalizeUsage(stepUsage);
              cumulativeInputTokens += normalized.promptTokens;
            }

            // Halt-and-resume: if tokens exceed budget, flag for compaction
            if (
              !needsCompaction &&
              compactionRound < MAX_COMPACTION_ROUNDS &&
              cumulativeInputTokens > budget.historyBudget * 0.85
            ) {
              needsCompaction = true;
              console.log(`[subagent:${subagentId}] Halt-and-resume compaction triggered: ${cumulativeInputTokens} tokens exceeds ${Math.round(budget.historyBudget * 0.85)} threshold (round ${compactionRound + 1}/${MAX_COMPACTION_ROUNDS})`);
              if (compactionAbort) abortWithReason(compactionAbort, 'compaction');
            }
          },
        });

        const streamAgent = async () => {
          const streamOptions = buildStreamOptions();
          const streamResult: any = await (agent as any).stream(messages, streamOptions);
          const stream = streamResult?.fullStream || streamResult;

          if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
            for await (const chunk of stream) {
              if (localAbort.signal.aborted) break;
              const ct = chunk?.type;

              // Text deltas
              if (ct === 'text-delta') {
                const text = getStreamTextDelta(chunk);
                if (text) {
                  fullText += text;
                  emitToClient('delta', { text });
                }
              }
              // Reasoning / thinking
              else if (ct === 'reasoning-start' || ct === 'thinking-start') {
                emitToClient('reasoning_start', { id: chunk.payload?.id });
              }
              else if (ct === 'reasoning-delta' || ct === 'reasoning' || ct === 'thinking-delta') {
                const text = getStreamTextDelta(chunk);
                if (text) emitToClient('reasoning', { text });
              }
              else if (ct === 'reasoning-end' || ct === 'thinking-end') {
                emitToClient('reasoning_end', { id: chunk.payload?.id });
              }
              // Tool calls
              else if (ct === 'tool-call') {
                const tc = getStreamToolCall(chunk);
                allToolCalls.push(tc.raw);
                emitToClient('tool_call', {
                  tool: tc.toolName,
                  toolCallId: tc.toolCallId,
                  args: tc.args,
                });
              }
              else if (ct === 'tool_event') {
                const te = chunk.payload || chunk;
                const status = String(te.status || '').toLowerCase();
                const toolCallId = te.toolCallId || te.id || `subagent-tool-${Date.now()}`;
                const tool = te.tool || te.toolName || 'tool';

                if (status === 'called' || status === 'started' || status === 'running') {
                  emitToClient('tool_call', {
                    tool,
                    toolCallId,
                    args: te.args,
                    description: te.description,
                  });
                } else if (status) {
                  const isError = status === 'error' || status === 'failed' || status === 'timeout';
                  emitToClient('tool_result', {
                    tool,
                    toolCallId,
                    result: isError ? undefined : (te.result ?? te),
                    status: isError ? 'error' : 'completed',
                    error: isError ? (te.error || (status === 'timeout' ? 'Tool timed out' : 'Tool failed')) : undefined,
                  });
                }
              }
              // Tool results
              else if (ct === 'tool-result') {
                const tr = getStreamToolResult(chunk);
                emitToClient('tool_result', {
                  tool: tr.toolName,
                  toolCallId: tr.toolCallId,
                  result: tr.result,
                  status: tr.isError ? 'error' : 'completed',
                  error: tr.error,
                });
                // Capture return_control result as fallback for summary extraction
                const summary = getReturnControlSummary(tr.toolName, tr.result);
                if (summary && !returnControlResult) {
                  returnControlResult = summary;
                }
              }
              // Stream/tool errors
              else if (ct === 'error') {
                const errPayload = chunk.payload || {};
                const errMessage = errPayload.message || errPayload.error || 'Subagent stream error';
                emitToClient('tool_result', {
                  tool: errPayload.toolName || errPayload.tool || 'stream',
                  toolCallId: errPayload.toolCallId || errPayload.id || `subagent-err-${Date.now()}`,
                  status: 'error',
                  error: String(errMessage),
                });
              }
              // Step boundaries
              else if (ct === 'step-start') {
                emitToClient('step_start', { stepId: chunk.payload?.stepId });
              }
              // Finish — capture usage
              else if (ct === 'finish') {
                const payload = chunk.payload || chunk;
                if (payload?.usage) {
                  streamUsage = {
                    ...payload.usage,
                    providerMetadata: chunk?.providerMetadata ?? payload?.providerMetadata,
                  };
                }
              }
              // Fallback: plain text or textDelta
              else if (typeof chunk === 'string' && chunk) {
                fullText += chunk;
                emitToClient('delta', { text: chunk });
              } else {
                const text = getStreamTextDelta(chunk);
                if (text) {
                  fullText += text;
                  emitToClient('delta', { text });
                }
              }
            }
          }

          // Final text fallback — if the model returned text without streaming
          // text-delta chunks (common for short responses), the client never saw
          // any text. Emit it as a single delta so the UI renders it.
          // streamResult.text is a Promise in AI SDK v6, so resolve it to a real
          // string before assigning — otherwise fullText becomes a Promise.
          if (!fullText) {
            const finalText = await resolveFinalStreamText(streamResult);
            if (finalText) {
              fullText = finalText;
              emitToClient('delta', { text: finalText });
            }
          }
          // Capture usage from streamResult if not already captured from finish event
          if (!streamUsage && streamResult?.usage) streamUsage = streamResult.usage;

          // ── Halt-and-resume compaction check ──
          //
          // A resumed stream can itself exceed the token budget. Keep compacting
          // and resuming until the stream finishes normally or the configured
          // compaction limit is reached; otherwise an abort used only to stop the
          // oversized stream can fall through as an empty successful result.
          while (needsCompaction && !localAbort.signal.aborted && compactionRound < MAX_COMPACTION_ROUNDS) {
            compactionRound++;
            console.log(`[subagent:${subagentId}] Halt-and-resume: compacting context (round ${compactionRound}/${MAX_COMPACTION_ROUNDS})`);

            // Show compacting status to client as a shimmering trace step
            emitToClient('compacting', {
              phase: 'start',
              round: compactionRound,
              maxRounds: MAX_COMPACTION_ROUNDS,
              tokensBefore: cumulativeInputTokens,
            });

            try {
              const messagesToCompact = streamAccumulatedMessages.length > 0
                ? streamAccumulatedMessages
                : [...messages];

              const compacted = await compactHistory(messagesToCompact, resolvedBudgetModelId);
              const postEstimate = estimateTokens(compacted as any[]);
              console.log(`[subagent:${subagentId}] Compacted: ${cumulativeInputTokens} -> ${postEstimate.totalTokens} tokens`);
              emitToClient('compacting', {
                phase: 'done',
                round: compactionRound,
                maxRounds: MAX_COMPACTION_ROUNDS,
                tokensBefore: cumulativeInputTokens,
                tokensAfter: postEstimate.totalTokens,
              });

              // Update messages for re-stream
              messages = compacted as any[];
              cumulativeInputTokens = postEstimate.totalTokens;
              needsCompaction = false;
              streamAccumulatedMessages = [];

              // Re-stream with compacted messages
              compactionAbort = new AbortController();
              const onLocalAbort2 = () => {
                if (compactionAbort) abortWithReason(compactionAbort, getAbortReason(localAbort.signal) || 'parent_abort');
              };
              localAbort.signal.addEventListener('abort', onLocalAbort2, { once: true });
              needsCompaction = false;

              try {
                console.log(`[subagent:${subagentId}] Re-streaming with compacted context`);
                const compactedStreamOptions = buildStreamOptions();
                const compactedStreamResult: any = await (agent as any).stream(messages, compactedStreamOptions);
                const compactedStream = compactedStreamResult?.fullStream || compactedStreamResult;

                if (compactedStream && typeof compactedStream[Symbol.asyncIterator] === 'function') {
                  for await (const chunk of compactedStream) {
                    if (localAbort.signal.aborted) break;
                    const ct = chunk?.type;
                    if (ct === 'text-delta') {
                      const text = getStreamTextDelta(chunk);
                      if (text) { fullText += text; emitToClient('delta', { text }); }
                    } else if (ct === 'tool-call') {
                      const tc = getStreamToolCall(chunk);
                      allToolCalls.push(tc.raw);
                      emitToClient('tool_call', { tool: tc.toolName, toolCallId: tc.toolCallId, args: tc.args });
                    } else if (ct === 'tool_event') {
                      const te = chunk.payload || chunk;
                      const status = String(te.status || '').toLowerCase();
                      const toolCallId = te.toolCallId || te.id || `subagent-tool-${Date.now()}`;
                      const tool = te.tool || te.toolName || 'tool';
                      if (status === 'called' || status === 'started' || status === 'running') {
                        emitToClient('tool_call', {
                          tool,
                          toolCallId,
                          args: te.args,
                          description: te.description,
                        });
                      } else if (status) {
                        const isError = status === 'error' || status === 'failed' || status === 'timeout';
                        emitToClient('tool_result', {
                          tool,
                          toolCallId,
                          result: isError ? undefined : (te.result ?? te),
                          status: isError ? 'error' : 'completed',
                          error: isError ? (te.error || (status === 'timeout' ? 'Tool timed out' : 'Tool failed')) : undefined,
                        });
                      }
                    } else if (ct === 'tool-result') {
                      const tr = getStreamToolResult(chunk);
                      emitToClient('tool_result', {
                        tool: tr.toolName,
                        toolCallId: tr.toolCallId,
                        result: tr.result,
                        status: tr.isError ? 'error' : 'completed',
                        error: tr.error,
                      });
                      const summary = getReturnControlSummary(tr.toolName, tr.result);
                      if (summary && !returnControlResult) {
                        returnControlResult = summary;
                      }
                    } else if (ct === 'error') {
                      const errPayload = chunk.payload || {};
                      const errMessage = errPayload.message || errPayload.error || 'Subagent stream error';
                      emitToClient('tool_result', {
                        tool: errPayload.toolName || errPayload.tool || 'stream',
                        toolCallId: errPayload.toolCallId || errPayload.id || `subagent-err-${Date.now()}`,
                        status: 'error',
                        error: String(errMessage),
                      });
                    } else if (ct === 'finish') {
                      const payload = chunk.payload || chunk;
                      if (payload?.usage) {
                        streamUsage = { ...payload.usage, providerMetadata: chunk?.providerMetadata ?? payload?.providerMetadata };
                      }
                    } else if (ct === 'reasoning-delta' || ct === 'reasoning' || ct === 'thinking-delta') {
                      const text = getStreamTextDelta(chunk);
                      if (text) emitToClient('reasoning', { text });
                    } else if (typeof chunk === 'string' && chunk) {
                      fullText += chunk; emitToClient('delta', { text: chunk });
                    } else {
                      const text = getStreamTextDelta(chunk);
                      if (text) {
                        fullText += text;
                        emitToClient('delta', { text });
                      }
                    }
                  }
                }
                if (!fullText) {
                  const finalText = await resolveFinalStreamText(compactedStreamResult);
                  if (finalText) {
                    fullText = finalText;
                    emitToClient('delta', { text: finalText });
                  }
                }
                if (!streamUsage && compactedStreamResult?.usage) streamUsage = compactedStreamResult.usage;
              } finally {
                localAbort.signal.removeEventListener('abort', onLocalAbort2);
              }
            } catch (compactError: any) {
              if (compactError?.name === 'AbortError' || localAbort.signal.aborted) {
                throw compactError;
              }
              console.warn(`[subagent:${subagentId}] Halt-and-resume compaction failed:`, compactError);
              // Continue with whatever we have
            }
          }

          if (needsCompaction && !localAbort.signal.aborted && compactionRound >= MAX_COMPACTION_ROUNDS) {
            throw new Error(`Subagent exceeded context budget after ${MAX_COMPACTION_ROUNDS} compaction rounds before producing a final result.`);
          }

          return { text: fullText, steps: Array.isArray(streamResult?.steps) ? streamResult.steps : [] };
        };

        const runPromise: Promise<any> = bridgeWs && bridgeOpen
          ? withActiveBridgeContext(
              bridgeWs as any,
              subagentBridgeSecrets,
              () => withClientBridge(bridgeWs as any, streamAgent, subagentBridgeSecrets),
            ) as Promise<any>
          : runWithSecrets(subagentBridgeSecrets, streamAgent) as Promise<any>;

        const racers = [runPromise, abortPromise] as Promise<any>[];
        if (timeoutPromise) racers.push(timeoutPromise as Promise<any>);
        const response: any = await Promise.race(racers);
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        // Success — break out of retry loop.
        // Coerce to a string defensively: a stream that errored or only made
        // tool calls can surface a non-string (or Promise) here, and the
        // logging below calls `.slice`/`.length` on it.
        const rawText = response?.text || fullText || '';
        const text = typeof rawText === 'string'
          ? rawText
          : (rawText == null ? '' : typeof rawText === 'object' ? '' : String(rawText));
        const steps = Array.isArray(response?.steps) ? response.steps : [];
        const durationMs = Date.now() - startTime;
        const toolCalls = allToolCalls.length > 0 ? allToolCalls : steps.flatMap((s: any) => s?.toolCalls || []);

        // Extract return_control summary if the subagent used it.
        // The LLM's text output is often just "I completed the task" while the
        // actual detailed content is in the return_control tool call args.
        let returnControlSummary = '';
        for (const tc of toolCalls) {
          const tcName = tc.toolName || tc.name || tc.tool || tc.payload?.toolName || '';
          if (tcName === 'return_control') {
            let args = tc.args || tc.payload?.args;
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
            if (args && typeof args.summary === 'string' && args.summary) {
              returnControlSummary = args.summary;
            }
            break;
          }
        }
        // Fallback: use the tool result if args didn't have the summary
        if (!returnControlSummary && returnControlResult) {
          returnControlSummary = returnControlResult;
        }

        // Coerce both candidates to string — `text` is null/undefined when the
        // AI SDK aborts mid-stream (e.g. context-window exceeded), and
        // `returnControlResult` upstream can be an object. Without this the
        // `.trim()` below explodes with "finalResult.trim is not a function"
        // which masks the underlying SDK error and burns retries.
        const toStr = (v: unknown): string =>
          typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        const finalResult = toStr(returnControlSummary) || toStr(text);

        if (!finalResult.trim()) {
          throw new Error(
            toolCalls.length > 0
              ? `Subagent ended after ${toolCalls.length} tool calls without final text or return_control.`
              : 'Subagent ended without final text or return_control.',
          );
        }

        console.log(`[subagent:${subagentId}] completed in ${durationMs}ms | text=${text.length}chars | steps=${steps.length} | toolCalls=${toolCalls.length} | returnControl=${!!returnControlSummary}`);
        if (toolCalls.length > 0) {
          console.log(`[subagent:${subagentId}] tools used:`, toolCalls.map((tc: any) => tc.toolName || tc.name || tc.tool).join(', '));
        } else {
          console.warn(`[subagent:${subagentId}] WARNING: No tool calls made! Response preview: "${text.slice(0, 200)}"`);
        }

        // ── Bill subagent usage ──
        const billableSteps = finishedSteps.length > 0
          ? finishedSteps
          : steps.length > 0
            ? steps.map((step: any) => ({
                usage: step?.usage,
                providerMetadata: step?.providerMetadata,
              }))
            : streamUsage
              ? [{ usage: streamUsage, providerMetadata: streamUsage?.providerMetadata }]
              : [];
        await billingTracker.settleToUsageList(billableSteps, { trigger: 'finish' });
        const billedTotals = billingTracker.getCumulativeTotals();
        const usageSummary = billedTotals.totalTokens > 0 || billedTotals.credits > 0
          ? {
              promptTokens: billedTotals.promptTokens,
              completionTokens: billedTotals.completionTokens,
              totalTokens: billedTotals.totalTokens,
              cachedPromptTokens: billedTotals.cachedPromptTokens,
              reasoningTokens: billedTotals.reasoningTokens,
              costUsd: billedTotals.costUsd,
              creditCost: billedTotals.credits,
              model: resolvedModelId,
            }
          : (() => {
              const usageData = streamUsage || {};
              const promptTokens = Number(usageData.promptTokens || usageData.prompt_tokens || usageData.inputTokens || 0);
              const completionTokens = Number(usageData.completionTokens || usageData.completion_tokens || usageData.outputTokens || 0);
              const totalTokens = Number(usageData.totalTokens || usageData.total_tokens || 0) || (promptTokens + completionTokens);
              return { promptTokens, completionTokens, totalTokens, model: resolvedModelId };
            })();

        writeLog('subagent_complete', { subagentId, ok: true, durationMs, textLength: finalResult.length, toolCallCount: toolCalls.length, stepsCount: steps.length, usage: usageSummary });
        emitToClient('completed', { ok: true, durationMs, usage: usageSummary }, { force: true });
        suppressClientEvents = true;

        return {
          ok: true,
          subagentId,
          result: finalResult,
          durationMs,
          usage: usageSummary,
        };
      } catch (error: any) {
        const toolError = detectRetryableToolError(error);
        if (!toolError || attempt >= MAX_RETRIES) throw error;

        attempt++;
        const isHallucination = toolError.type === 'no_such_tool' || toolError.type === 'tool_not_found';
        if (isHallucination) {
          toolErrorHistory.push(
            `The tool "${toolError.toolName}" was not directly available. Use execute_tool({ tool_name: "${toolError.toolName}", args: {...} }) to run it, or call get_tool_schema first to make it available for direct use.`
          );
        } else if (toolError.type === 'invalid_args') {
          toolErrorHistory.push(
            `Tool "${toolError.toolName}" received invalid arguments: ${toolError.message}. Use get_tool_schema({ tool_name: "${toolError.toolName}" }) to see the correct argument format before retrying.`
          );
        } else {
          toolErrorHistory.push(
            `Tool "${toolError.toolName}" failed: ${toolError.message}. Try a different approach or a different tool.`
          );
        }
        emitToClient('retry', { attempt, reason: toolErrorHistory[toolErrorHistory.length - 1] });
        // Reset text accumulation for retry
        fullText = '';
        allToolCalls = [];
        returnControlResult = '';
      }
    }

    throw new Error('Subagent execution failed after retries');
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    const abortReason = getAbortReason(localAbort.signal);
    const isTimeout = error?.message?.startsWith('Subagent timed out after') || timedOut;
    const isAborted = localAbort.signal.aborted || error?.message === 'Subagent aborted';

    await billingTracker.settleToUsageList(
      finishedSteps.length > 0
        ? finishedSteps
        : streamUsage
          ? [{ usage: streamUsage, providerMetadata: streamUsage?.providerMetadata }]
          : [],
      {
        trigger: isAborted && !isTimeout ? 'aborted' : 'error',
        partial: true,
      },
    );

    if (isTimeout) {
      const message = error?.message || `Subagent timed out after ${timeoutMs}ms`;
      writeLog('subagent_timeout', { subagentId, durationMs, timeoutMs });
      emitToClient('error', { error: message, durationMs, timedOut: true }, { force: true });
      suppressClientEvents = true;
      return {
        ok: false,
        subagentId,
        error: message,
        durationMs,
      };
    }

    if (isAborted) {
      writeLog('subagent_aborted', { subagentId, durationMs, reason: abortReason || 'unknown' });
      console.log(`[subagent:${subagentId}] aborted | reason=${abortReason || 'unknown'}`);
      emitToClient('cancelled', { durationMs, reason: abortReason || 'unknown' }, { force: true });
      suppressClientEvents = true;
      return {
        ok: false,
        subagentId,
        error: formatSubagentAbortMessage(abortReason),
        durationMs,
      };
    }

    writeLog('subagent_error', { subagentId, error: error.message, durationMs });
    emitToClient('error', { error: error.message, durationMs }, { force: true });
    suppressClientEvents = true;

    return {
      ok: false,
      subagentId,
      error: error.message || 'Subagent execution failed',
      durationMs,
    };
  } finally {
    suppressClientEvents = true;
    if (externalSignal && onExternalAbort) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch {}
    }
    runningSubagents.delete(subagentId);
    subagentSteerQueues.delete(subagentId);
    if (runtimeBridgeScope) {
      clearActiveBridge(runtimeBridgeScope);
    }
    for (const [qId] of pendingQuestions) {
      if (qId.startsWith(`q-`)) {
        pendingQuestions.delete(qId);
      }
    }
  }
}

// ─── Integration group detection ─────────────────────────────────────────────

function detectIntegrationGroup(text: string): string | null {
  const lower = text.toLowerCase();
  const groups: Array<[string, string[]]> = [
    ['google', ['gmail', 'google', 'calendar', 'drive', 'sheets', 'docs']],
    ...(OUTLOOK_INTEGRATION_ENABLED ? [['outlook', ['outlook', 'microsoft', 'office 365']] as [string, string[]]] : []),
    ['github', ['github', 'git repo', 'pull request', 'issue']],
    ...(META_INTEGRATION_ENABLED ? [['meta', ['facebook', 'instagram', 'threads', 'meta']] as [string, string[]]] : []),
    ...(WHATSAPP_INTEGRATION_ENABLED ? [['whatsapp', ['whatsapp', 'wa message']] as [string, string[]]] : []),
    ['telnyx', ['telnyx', 'sms', 'phone call']],
    ...(REDDIT_INTEGRATION_ENABLED ? [['reddit', ['reddit', 'subreddit']] as [string, string[]]] : []),
    ...(DISCORD_INTEGRATION_ENABLED ? [['discord', ['discord', 'discord bot']] as [string, string[]]] : []),
    ['x', ['twitter', 'tweet', 'tweets', 'x integration', 'integration group: x']],
  ];

  for (const [group, keywords] of groups) {
    if (keywords.some(kw => lower.includes(kw))) {
      return group;
    }
  }
  return null;
}
