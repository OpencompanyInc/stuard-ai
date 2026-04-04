/**
 * Subagent Runtime
 *
 * Generic runtime for executing subagents with ask/reply support.
 * Replaces one-off delegation patterns like route_to_workflow_agent
 * with a reusable contract.
 */

import { createRequire } from 'node:module';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { detectRetryableToolError } from '../routes/proactive-utils';
import { getModel } from '../agents/stuard/models';
import { writeLog } from '../utils/logger';
import { getBridgeWs, getBridgeSecrets, withClientBridge, runWithSecrets } from '../tools/bridge';
import { logUsageEvent, debitCredits } from '../supabase';
import { estimateCostUsd, creditsFromUsd } from '../pricing';
import { normalizeUsage } from '../utils/usage';
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
import { getCapabilityPack, buildIntegrationPack, resolveIntegrationTools } from './capability-packs';
import type { ModelChoice } from '../router/model-router';

const require = createRequire(import.meta.url);
let _getExecutionTools: (() => Record<string, any>) | undefined;

// Track running subagents so they can be aborted when the parent stream is cancelled
const runningSubagents = new Map<string, AbortController>();

export function abortRunningSubagent(subagentId: string): boolean {
  const controller = runningSubagents.get(subagentId);
  if (controller) {
    controller.abort();
    runningSubagents.delete(subagentId);
    return true;
  }
  return false;
}

export function abortAllRunningSubagents(): number {
  let count = 0;
  for (const [id, controller] of runningSubagents) {
    try { controller.abort(); } catch {}
    count++;
  }
  runningSubagents.clear();
  return count;
}

// Lazy: avoids meta-tools ↔ stuard/tools circular init via workflow-subagent.
function getExecutionToolsLazy(): Record<string, any> {
  if (!_getExecutionTools) {
    _getExecutionTools = require('../agents/stuard/tools').getExecutionTools;
  }
  return _getExecutionTools!();
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

// ─── Subagent run state (shared across ask/return/progress tools) ────────────

interface SubagentRunState {
  pendingQuestionId: string | null;
  pendingAnswerPromise: Promise<string> | null;
}

async function waitForConcurrentAskRegistration(runState: SubagentRunState): Promise<void> {
  if (runState.pendingAnswerPromise) return;

  // Tool calls emitted in the same model step are usually scheduled very close
  // together, but not always in the same microtask. Give sibling
  // ask_orchestrator calls a brief chance to mark the pending state before
  // return_control decides it's safe to finish.
  await Promise.resolve();
  if (runState.pendingAnswerPromise) return;

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Child-side tools ────────────────────────────────────────────────────────

function makeAskOrchestratorTool(
  correlation: SubagentCorrelation,
  runState: SubagentRunState,
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>,
) {
  return createTool({
    id: 'ask_orchestrator',
    description:
      'Ask the orchestrator a question when you need information, a user decision, or context ' +
      'that is not available in your current tool set. Returns the orchestrator\'s answer.',
    inputSchema: z.object({
      question: z.string().describe('The question to ask the orchestrator.'),
      choices: z.array(z.string()).optional().describe('Optional choices the orchestrator can pick from.'),
    }),
    execute: async ({ question, choices }) => {
      // If a question is already pending (e.g. parallel tool calls in the
      // same step), share the blocking promise instead of firing a duplicate.
      if (runState.pendingQuestionId && runState.pendingAnswerPromise) {
        writeLog('ask_orchestrator_sharing_pending', {
          subagentId: correlation.subagentId,
          pendingQuestionId: runState.pendingQuestionId,
        });
        try {
          const answer = await runState.pendingAnswerPromise;
          return { ok: true, answer };
        } catch (e: any) {
          return { ok: false, error: e.message || 'Pending question failed' };
        }
      }

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
        // Set up shared answer promise BEFORE calling onQuestion so that
        // parallel duplicate calls or return_control can observe it.
        let resolveShared!: (answer: string) => void;
        runState.pendingAnswerPromise = new Promise<string>((resolve) => {
          resolveShared = resolve;
        });
        // Prevent unhandled rejection if nobody else awaits this promise
        runState.pendingAnswerPromise.catch(() => {});
        runState.pendingQuestionId = questionId;

        try {
          const answerMsg = await onQuestion(questionMsg);
          resolveShared(answerMsg.answer);
          runState.pendingQuestionId = null;
          runState.pendingAnswerPromise = null;
          return { ok: true, answer: answerMsg.answer };
        } catch (e: any) {
          resolveShared(`[error] ${e.message || 'No answer received'}`);
          runState.pendingQuestionId = null;
          runState.pendingAnswerPromise = null;
          return { ok: false, error: e.message || 'No answer received' };
        }
      }

      return { ok: false, error: 'No onQuestion handler — ask_orchestrator is not connected to the orchestrator.' };
    },
  });
}

function makeReturnControlTool(
  correlation: SubagentCorrelation,
  runState: SubagentRunState,
) {
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
      // If ask_orchestrator was emitted in the same model step, give it a brief
      // chance to register before deciding whether we can finalize.
      await waitForConcurrentAskRegistration(runState);

      // If ask_orchestrator is in-flight, wait for the answer before
      // finalizing — this prevents the subagent from "pre-finishing"
      // while a question is still pending.
      if (runState.pendingAnswerPromise) {
        writeLog('return_control_waiting_for_pending_ask', {
          subagentId: correlation.subagentId,
          pendingQuestionId: runState.pendingQuestionId,
        });
        try {
          await runState.pendingAnswerPromise;
        } catch {
          // Question failed but we're still returning control
        }
      }

      writeLog('subagent_return_control', {
        subagentId: correlation.subagentId,
        success,
        summaryLength: summary.length,
      });
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
            return await execLocalToolWithCapturedBridge(
              toolId,
              args,
              ctx?.writer,
              localToolSpec,
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

function buildSubagent(
  pack: CapabilityPack,
  correlation: SubagentCorrelation,
  model: ModelChoice = 'balanced',
  modelId?: string,
  bridgeWs?: any,
  bridgeSecrets?: Record<string, any>,
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>,
): Agent {
  const executionTools = getExecutionToolsLazy();
  const selectedModel = getModel(model, modelId);

  const runState: SubagentRunState = {
    pendingQuestionId: null,
    pendingAnswerPromise: null,
  };

  const askTool = makeAskOrchestratorTool(correlation, runState, onQuestion);
  const returnTool = makeReturnControlTool(correlation, runState);
  const progressTool = makeReportProgressTool(correlation);

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
    instructions: pack.systemPrompt,
    model: selectedModel as any,
    tools,
  });

  (agent as any).__activeToolNames = toolNames;
  return agent;
}

// ─── Run subagent ────────────────────────────────────────────────────────────

export interface RunSubagentOptions {
  request: DelegationRequest;
  runId: string;
  parentRunId: string;
  model?: ModelChoice;
  modelId?: string;
  bridgeWs?: any;
  bridgeSecrets?: Record<string, any>;
  onEvent?: (event: any) => void;
  onQuestion?: (question: SubagentQuestion) => Promise<SubagentAnswer>;
  abortSignal?: AbortSignal;
}

export async function runSubagent(opts: RunSubagentOptions): Promise<DelegationResult> {
  const {
    request,
    runId,
    parentRunId,
    model = 'balanced',
    modelId,
    bridgeWs: explicitBridgeWs,
    bridgeSecrets: explicitBridgeSecrets,
    onEvent,
    onQuestion,
    abortSignal: externalSignal,
  } = opts;

  const subagentId = `sa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const correlation: SubagentCorrelation = { runId, parentRunId, subagentId };
  const startTime = Date.now();

  const localAbort = new AbortController();
  runningSubagents.set(subagentId, localAbort);

  if (externalSignal) {
    if (externalSignal.aborted) {
      localAbort.abort();
    } else {
      externalSignal.addEventListener('abort', () => localAbort.abort(), { once: true });
    }
  }

  writeLog('subagent_start', {
    subagentId,
    kind: request.kind,
    instruction: request.instruction.slice(0, 200),
  });

  // NOTE: the `started` event is emitted via emitToClient further below,
  // after bridgeWs is resolved, so it reaches the desktop client.

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
      pack = buildIntegrationPack(groupName, toolNames);
    }
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

  // Resolve bridge context for wrapping tools (ALS is lost inside agent.generate)
  const bridgeWs = explicitBridgeWs || getBridgeWs();
  const bridgeSecrets = explicitBridgeSecrets || getBridgeSecrets();

  const agent = buildSubagent(pack, correlation, model, modelId, bridgeWs, bridgeSecrets, onQuestion);
  const timeoutMs = request.timeoutMs ?? pack.timeoutMs;

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
    ? setActiveBridge(bridgeWs, bridgeSecrets)
    : (bridgeSecrets ? setActiveBridge(null, bridgeSecrets) : undefined);

  const emitToClient = (event: string, data: any) => {
    try {
      if (bridgeWs && (bridgeWs as any).readyState === WebSocket.OPEN) {
        (bridgeWs as any).send(JSON.stringify({
          type: 'subagent_event',
          subagentId,
          runId,
          event,
          data,
        }));
      }
    } catch {}
    onEvent?.({ type: 'subagent_event', subagentId, runId, event, data });
  };

  emitToClient('started', { kind: request.kind, label: request.kind });

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Subagent timed out after ${timeoutMs}ms`)), timeoutMs);
    });

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
    // Accumulate token usage across all steps for billing
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedTokens = 0;

    while (attempt <= MAX_RETRIES) {
      const messages = toolErrorHistory.length > 0
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
        const streamAgent = async () => {
          const streamResult: any = await (agent as any).stream(messages, { maxSteps: pack.maxSteps });
          const stream = streamResult?.fullStream || streamResult;

          if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
            for await (const chunk of stream) {
              if (localAbort.signal.aborted) break;
              const ct = chunk?.type;

              // Text deltas
              if (ct === 'text-delta') {
                const text = chunk.payload?.text || (typeof chunk.payload === 'string' ? chunk.payload : '');
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
                const text = chunk.payload?.text || chunk.textDelta || (typeof chunk.payload === 'string' ? chunk.payload : '');
                if (text) emitToClient('reasoning', { text });
              }
              else if (ct === 'reasoning-end' || ct === 'thinking-end') {
                emitToClient('reasoning_end', { id: chunk.payload?.id });
              }
              // Tool calls
              else if (ct === 'tool-call') {
                const tc = chunk.payload || {};
                allToolCalls.push(tc);
                emitToClient('tool_call', {
                  tool: tc.toolName,
                  toolCallId: tc.toolCallId,
                  args: tc.args,
                });
              }
              // Tool results
              else if (ct === 'tool-result') {
                const tr = chunk.payload || {};
                emitToClient('tool_result', {
                  tool: tr.toolName,
                  toolCallId: tr.toolCallId,
                  result: tr.result,
                });
                // Capture return_control result and stop stream immediately
                const trName = tr.toolName || '';
                if (trName === 'return_control' && tr.result) {
                  const res = typeof tr.result === 'string' ? (() => { try { return JSON.parse(tr.result); } catch { return {}; } })() : tr.result;
                  if (res?.summary && !returnControlResult) {
                    returnControlResult = res.summary;
                  }
                  // Subagent explicitly returned control — stop processing
                  // immediately so no more tokens are consumed or text emitted.
                  emitToClient('return_control', { summary: returnControlResult });
                  break;
                }
              }
              // Step boundaries
              else if (ct === 'step-start') {
                emitToClient('step_start', { stepId: chunk.payload?.stepId });
              }
              // Step finish — accumulate token usage for billing
              else if (ct === 'step-finish') {
                const stepUsage = chunk.payload?.usage || chunk.usage;
                if (stepUsage) {
                  const nu = normalizeUsage(stepUsage);
                  totalPromptTokens += nu.promptTokens || 0;
                  totalCompletionTokens += nu.completionTokens || 0;
                  totalCachedTokens += nu.cachedPromptTokens || 0;
                }
              }
              // Finish
              else if (ct === 'finish') {
                // Extract final usage if available
                const finishUsage = chunk.payload?.usage || chunk.usage;
                if (finishUsage && totalPromptTokens === 0 && totalCompletionTokens === 0) {
                  const nu = normalizeUsage(finishUsage);
                  totalPromptTokens = nu.promptTokens || 0;
                  totalCompletionTokens = nu.completionTokens || 0;
                  totalCachedTokens = nu.cachedPromptTokens || 0;
                }
              }
              // Fallback: plain text or textDelta
              else if (typeof chunk === 'string' && chunk) {
                fullText += chunk;
                emitToClient('delta', { text: chunk });
              } else if (chunk?.textDelta) {
                fullText += chunk.textDelta;
                emitToClient('delta', { text: chunk.textDelta });
              }
            }
          }

          // Final text fallback
          if (!fullText && streamResult?.text) fullText = streamResult.text;
          return { text: fullText, steps: streamResult?.steps || [] };
        };

        const runPromise = bridgeWs && bridgeOpen
          ? withActiveBridgeContext(
              bridgeWs as any,
              bridgeSecrets,
              () => withClientBridge(bridgeWs as any, streamAgent, bridgeSecrets),
            )
          : bridgeSecrets
            ? runWithSecrets(bridgeSecrets, streamAgent)
            : streamAgent();

        const response: any = await Promise.race([runPromise, timeoutPromise, abortPromise]);
        // Success — break out of retry loop
        const text = response?.text || fullText || '';
        const steps = response?.steps || [];
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

        const finalResult = returnControlSummary || text;

        console.log(`[subagent:${subagentId}] completed in ${durationMs}ms | text=${text.length}chars | steps=${steps.length} | toolCalls=${toolCalls.length} | returnControl=${!!returnControlSummary}`);
        if (toolCalls.length > 0) {
          console.log(`[subagent:${subagentId}] tools used:`, toolCalls.map((tc: any) => tc.toolName || tc.name || tc.tool).join(', '));
        } else {
          console.warn(`[subagent:${subagentId}] WARNING: No tool calls made! Response preview: "${text.slice(0, 200)}"`);
        }

        // Extract usage from steps if stream events didn't provide it
        if (totalPromptTokens === 0 && totalCompletionTokens === 0 && steps.length > 0) {
          for (const step of steps) {
            const su = step?.usage;
            if (su) {
              const nu = normalizeUsage(su);
              totalPromptTokens += nu.promptTokens || 0;
              totalCompletionTokens += nu.completionTokens || 0;
              totalCachedTokens += nu.cachedPromptTokens || 0;
            }
          }
        }
        // Also try streamResult.usage as final fallback
        if (totalPromptTokens === 0 && totalCompletionTokens === 0) {
          const topUsage = (response as any)?.usage;
          if (topUsage) {
            const nu = normalizeUsage(topUsage);
            totalPromptTokens = nu.promptTokens || 0;
            totalCompletionTokens = nu.completionTokens || 0;
            totalCachedTokens = nu.cachedPromptTokens || 0;
          }
        }

        // Bill the subagent's LLM usage to the user
        const userId = bridgeSecrets?.userId as string | undefined;
        const resolvedModelId = modelId || model || 'balanced';
        if (userId && (totalPromptTokens > 0 || totalCompletionTokens > 0)) {
          const costUsd = estimateCostUsd(resolvedModelId, totalPromptTokens, totalCompletionTokens, totalCachedTokens);
          const credits = creditsFromUsd(costUsd);

          writeLog('subagent_billing', {
            subagentId,
            userId,
            model: resolvedModelId,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            cachedTokens: totalCachedTokens,
            costUsd,
            credits,
            kind: request.kind,
          });

          // Log usage event (inserts into usage_events table)
          try {
            await logUsageEvent(userId, null, resolvedModelId, {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              cachedPromptTokens: totalCachedTokens,
              sourceType: 'subagent',
              subagentKind: request.kind,
              subagentId,
            });
          } catch (e: any) {
            console.warn(`[subagent:${subagentId}] failed to log usage event:`, e?.message);
          }

          // Debit credits from user's balance
          try {
            await debitCredits(userId, {
              credits,
              sourceType: 'subagent',
              sourceRef: `subagent:${subagentId}`,
              model: resolvedModelId,
              amountUsd: costUsd,
              metadata: {
                subagentKind: request.kind,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                durationMs,
              },
            });
          } catch (e: any) {
            console.warn(`[subagent:${subagentId}] failed to debit credits:`, e?.message);
          }
        }

        writeLog('subagent_complete', { subagentId, ok: true, durationMs, textLength: finalResult.length, toolCallCount: toolCalls.length, stepsCount: steps.length });
        emitToClient('completed', { ok: true, durationMs, usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, cachedTokens: totalCachedTokens } });

        return {
          ok: true,
          subagentId,
          result: finalResult,
          durationMs,
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
        totalPromptTokens = 0;
        totalCompletionTokens = 0;
        totalCachedTokens = 0;
      }
    }

    throw new Error('Subagent execution failed after retries');
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const isAborted = localAbort.signal.aborted || error?.message === 'Subagent aborted';

    if (isAborted) {
      writeLog('subagent_aborted', { subagentId, durationMs });
      emitToClient('cancelled', { durationMs });
      return {
        ok: false,
        subagentId,
        error: 'Subagent was cancelled',
        durationMs,
      };
    }

    writeLog('subagent_error', { subagentId, error: error.message, durationMs });

    onEvent?.({
      type: 'subagent_event',
      subagentId,
      runId,
      event: 'error',
      data: { error: error.message, durationMs },
    });

    return {
      ok: false,
      subagentId,
      error: error.message || 'Subagent execution failed',
      durationMs,
    };
  } finally {
    runningSubagents.delete(subagentId);
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
    ['outlook', ['outlook', 'microsoft', 'office 365']],
    ['github', ['github', 'git repo', 'pull request', 'issue']],
    ['meta', ['facebook', 'instagram', 'threads', 'meta']],
    ['whatsapp', ['whatsapp', 'wa message']],
    ['telnyx', ['telnyx', 'sms', 'phone call']],
    ['reddit', ['reddit', 'subreddit']],
    ['discord', ['discord', 'discord bot']],
  ];

  for (const [group, keywords] of groups) {
    if (keywords.some(kw => lower.includes(kw))) {
      return group;
    }
  }
  return null;
}
