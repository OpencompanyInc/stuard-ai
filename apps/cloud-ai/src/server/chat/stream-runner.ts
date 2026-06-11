import { generateText } from 'ai';

import { getDefaultModelForCategory } from '../../pricing';
import { buildNativeProviderModel } from '../../utils/models';
import { writeLog } from '../../utils/logger';
import { sanitizeToolEvent, sanitizeSteps } from '../../utils/sanitize';
import { normalizeUsage } from '../../utils/usage';
import { normalizeThreadTitle, THREAD_TITLE_SYSTEM } from '../../utils/thread-title';
import { compactHistory } from '../../memory/context-compactor';
import * as memoryService from '../../memory/conversations';
import { withClientBridge, getBridgeWs, getBridgeSecrets } from '../../tools/bridge';
import { getSessionWorkflow, getWorkflowById } from '../../tools/workflow';
import { attachResearchReportForClient } from '../../tools/research-mode';
import {
  addAssistantMessage,
  addUserMessage,
  finishRun,
} from '../../supabase';
import { LiveUsageBillingTracker } from '../../services/live-usage-billing';
import { getDesktopWs } from '../../services/vm-bridge';
import { resolvePendingSubagentQuestionsForRequest } from '../../orchestrator/delegation-coordinator-registry';
import {
  addPendingApproval,
  registerRun,
  removePendingApprovalByToolId,
  setTerminalResult,
} from '../../services/run-state';
import { conversations, deleteAbortController, setAbortController } from '../socket/state';
import { isSISMetaTool, send } from '../socket/helpers';
import { getHardTimeoutMs } from './provider-options';
import {
  appendInterjectionToMessages,
  drainInterjectionPayload,
  type InterjectionPayload,
} from './interjections';
import { buildEmptyOutputMessage, mapStreamError, summarizeInputAttachments } from './error-messages';
import type { PreparedChatRequest, StreamChunkRecord } from './types';
import { isQuickChatRequest } from './quick-request';
import { registerNestedRecorder, unregisterNestedRecorder } from './nested-chunk-recorder';

interface RuntimeState {
  didSendFinal: boolean;
  aggregatedText: string;
  sawAnyTextDelta: boolean;
  sawToolCall: boolean;
}

type BridgeWebSocket = import('ws').WebSocket;

// Workflow-mutation tools return a COMPACT result to the model (no full
// workflow JSON) to avoid quadratic token growth — see workflow.ts. But the
// desktop canvas needs the full workflow to repaint and mark the editor dirty.
// The tool stores the mutated workflow in session state, so before forwarding
// the tool-result to the client we re-attach it. Only the client-bound copy
// gets the workflow; the result persisted to model history stays compact.
const WORKFLOW_MUTATION_TOOLS = new Set(['modify_workflow', 'workflow_modify']);

export function attachWorkflowForClient(toolName: string, result: any): any {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (!WORKFLOW_MUTATION_TOOLS.has(toolName)) return result;
  // Only successful mutations carry a workflow; errors are forwarded untouched.
  if (result.ok !== true) return result;
  // Sub-workflow file edits (stuardFile) don't touch the session/main workflow
  // — attaching the main workflow here would hand the canvas a stale document.
  if (result.stuardFile) return result;
  // Respect a workflow the tool already attached (e.g. headless/no-writer path).
  if (result.workflow) return result;
  // Resolve the FRESH workflow by id first. The workflow-agent runs each tool
  // inside its own withClientBridge (fresh ALS `state` Map), so the tool's
  // session write never reaches this request-level context — getSessionWorkflow()
  // here returns the PRE-edit workflow that prepare-chat-request stored and would
  // clobber the canvas. The tool always `workflowMap.set(wf.id, wf)`, so keying
  // off the id returned in the result yields the just-modified copy. Fall back to
  // the session only when no id is present.
  const byId = typeof result.workflowId === 'string' ? getWorkflowById(result.workflowId) : null;
  const workflow = byId || getSessionWorkflow();
  if (!workflow) return result;
  return { ...result, workflow };
}

function isOpenBridge(ws: BridgeWebSocket | undefined): ws is BridgeWebSocket {
  if (!ws) return false;
  const openState = typeof ws.OPEN === 'number' ? ws.OPEN : 1;
  return ws.readyState === openState;
}

function abortWithReason(controller: AbortController | null | undefined, reason: string) {
  if (!controller) return;
  try {
    (controller as any).abort(reason);
  } catch {
    try { controller.abort(); } catch { }
  }
}

function getAbortReason(signal: AbortSignal | null | undefined): string {
  const reason = (signal as any)?.reason;
  if (typeof reason === 'string' && reason) return reason;
  if (reason && typeof reason?.message === 'string') return reason.message;
  return signal?.aborted ? 'aborted' : '';
}

export async function runPreparedChatStream(prepared: PreparedChatRequest) {
  const {
    ws,
    msg,
    requestId,
    history,
    prompt,
    inputMessages,
    agent,
    agentType,
    authUser,
    requestedMode,
    routedTier,
    chosenModelId,
    modelSource,
    conversationId,
    conversationCreatedNow,
    memoryOwner,
    modelLabel,
    contextPathsForMeta,
    resource,
    thread,
    maxSteps,
    providerOptions,
  } = prepared;

  let abortController: AbortController | null = null;
  let hardTimeout: NodeJS.Timeout | null = null;
  const runtime: RuntimeState = {
    didSendFinal: false,
    aggregatedText: '',
    sawAnyTextDelta: false,
    sawToolCall: false,
  };
  const toolCallsMap = new Map<string, any>();
  const streamChunks: StreamChunkRecord[] = [];
  // Let delegated subagents (which stream out-of-band via emitToClient) weave
  // their reasoning/text/tool activity into this same chunk log so it persists
  // locally and replays on reopen. Cleared in the function's finally.
  registerNestedRecorder(requestId, streamChunks);
  const finishedSteps: Array<{ usage: any; providerMetadata: any }> = [];
  const sourceLabel = agentType === 'workflow'
    ? 'Workflow Architect'
    : agentType === 'skill'
      ? 'Skill Architect'
      : agentType === 'bot'
        ? 'Bot Agent'
        : 'Chat';
  const billingExcluded = !!(agent as any)?.__billingExcluded;
  const billingTracker = new LiveUsageBillingTracker({
    userId: authUser?.userId ?? null,
    conversationId,
    model: chosenModelId || routedTier,
    sourceRef: `chat:${requestId || conversationId || Date.now()}`,
    sourceType: 'inference',
    sourceLabel,
    billingExcluded,
    onSettlement: (summary) => {
      send(ws, {
        type: 'progress',
        event: 'billing_update',
        data: {
          sourceRef: summary.sourceRef,
          trigger: summary.trigger,
          stepNumber: summary.stepNumber,
          conversationId,
          model: chosenModelId || routedTier,
          sourceType: 'inference',
          sourceLabel,
          delta: summary.delta,
          cumulative: summary.cumulative,
        },
      }, requestId);
    },
  });

  const buildMetadata = (finishReason?: string) => {
    const filteredToolCalls = Array.from(toolCallsMap.values()).filter((toolCall) => !isSISMetaTool(toolCall.tool));
    return {
      mode: requestedMode,
      tier: routedTier,
      modelId: chosenModelId,
      toolCalls: filteredToolCalls.length > 0 ? filteredToolCalls : undefined,
      streamChunks: streamChunks.length > 0 ? streamChunks : undefined,
      finishReason,
    };
  };

  const persistAssistantText = async (text: string, finishReason?: string) => {
    if (!authUser || !conversationId) return;
    try {
      await addAssistantMessage(authUser.userId, conversationId, text, buildMetadata(finishReason));
    } catch { }
  };

  const persistUserInterjection = async (
    interjection: InterjectionPayload,
    appliedTo: 'step' | 'next_turn',
  ) => {
    history.push({ role: 'user', content: interjection.content });
    if (!authUser || !conversationId) return;

    try {
      await addUserMessage(authUser.userId, conversationId, interjection.content, {
        kind: 'steer',
        interjection: true,
        appliedTo,
      });
    } catch { }
  };

  const deferInterjectionToQueuedTurn = (interjection: InterjectionPayload) => {
    send(ws, {
      type: 'progress',
      event: 'interjection_deferred',
      data: { count: interjection.count },
    }, requestId);
  };

  const setRequestTerminalResult = (payload: {
    text: string;
    finishReason: string;
    error?: boolean;
    aborted?: boolean;
    model?: string;
    conversationId?: string;
  }) => {
    if (authUser?.userId && requestId) {
      setTerminalResult(authUser.userId, requestId, payload);
    }
  };

  // Capture the bridge WS now — the AI SDK's onFinish callback may lose
  // the AsyncLocalStorage context, so we snapshot it for later re-establishment.
  const bridgeWs = getBridgeWs();

  try {
    const resolvedSource = (agent as any)?.__modelSource ?? 'unknown';
    console.log('[cloud-ai] Starting stream with model:', modelLabel, '| requested modelSource:', modelSource ?? '(none)', '| resolved source:', resolvedSource, '| billingExcluded:', billingExcluded);
    writeLog('stream_start', { model: modelLabel, conversationId, modelSource, resolvedSource });

    if (authUser?.userId && requestId) {
      registerRun(authUser.userId, requestId);
    }

    // Fire title generation early in parallel with the stream
    if (authUser && conversationId && conversationCreatedNow && prompt) {
      fireAndForgetConversationTitle(authUser.userId, conversationId, prompt, ws, requestId);
    }

    abortController = new AbortController();
    setAbortController(ws, requestId, abortController);
    const bridgeSecrets = getBridgeSecrets();
    if (bridgeSecrets) {
      bridgeSecrets.__modelSource = (agent as any)?.__modelSource;
      bridgeSecrets.__billingExcluded = billingExcluded;
      if (requestId) {
        bridgeSecrets.__requestId = requestId;
      }
      bridgeSecrets.__chatWs = ws;
      bridgeSecrets.__abortSignal = abortController.signal;
    }

    const hardTimeoutMs = getHardTimeoutMs(agentType);
    if (hardTimeoutMs > 0) {
      hardTimeout = setTimeout(() => {
        if (runtime.didSendFinal) return;
        runtime.didSendFinal = true;
        try {
          abortWithReason(abortController, 'hard_timeout');
        } catch { }
        try {
          deleteAbortController(ws, requestId);
        } catch { }

        const timeoutText = runtime.aggregatedText.trim() || 'Request timed out. Please retry.';
        send(ws, {
          type: 'final',
          origin: 'cloud-ai',
          model: chosenModelId || routedTier,
          conversationId,
          result: { text: timeoutText, steps: [], finishReason: 'timeout' },
          timedOut: true,
        }, requestId);
        setRequestTerminalResult({
          text: timeoutText,
          finishReason: 'timeout',
          model: chosenModelId || routedTier,
          conversationId: conversationId || undefined,
        });
      }, hardTimeoutMs);
    }

    let stepCount = 0;
    let cumulativeInputTokens = 0;
    const activeToolNames: string[] | undefined = (agent as any).__activeToolNames;
    const streamOptions: any = {
      maxSteps,
      providerOptions,
      abortSignal: abortController.signal,
      ...(activeToolNames ? { activeTools: activeToolNames } : {}),
      onStepFinish: async (stepData: any) => {
        stepCount++;
        finishedSteps.push({
          usage: stepData?.usage,
          providerMetadata: stepData?.providerMetadata,
        });
        const stepUsage = stepData?.usage;
        const normalized = stepUsage ? normalizeUsage(stepUsage) : null;
        if (normalized) {
          cumulativeInputTokens += normalized.promptTokens;
        }

        const rawCalls = stepData?.toolCalls || stepData?.tool_calls || [];
        const extractToolName = (toolCall: any) =>
          toolCall?.toolName
          || toolCall?.tool_name
          || toolCall?.name
          || toolCall?.function?.name
          || toolCall?.payload?.toolName
          || toolCall?.payload?.tool_name
          || toolCall?.payload?.name
          || '?';
        const toolNames = (Array.isArray(rawCalls) ? rawCalls : []).map(extractToolName).join(', ');
        const inputTokens = normalized
          ? `input: ${normalized.promptTokens} tok | output: ${normalized.completionTokens} tok | cumulative input: ${cumulativeInputTokens} tok`
          : 'no usage';
        console.log(`[cloud-ai] ── Step ${stepCount} ── ${inputTokens}${toolNames ? ` | tools: ${toolNames}` : ''}`);
        await billingTracker.settleIncrement(stepData, {
          trigger: 'step_finish',
          stepNumber: stepCount,
        });
        if (Array.isArray(rawCalls) && rawCalls.length > 0 && stepCount < maxSteps) {
          send(ws, {
            type: 'progress',
            event: 'step_finished',
            data: { step: stepCount },
          }, requestId);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      },
      onFinish: async ({ text, steps, finishReason, usage, totalUsage }: any) => {
        if (runtime.didSendFinal) {
          try {
            if (hardTimeout) clearTimeout(hardTimeout);
          } catch { }
          return;
        }

        runtime.didSendFinal = true;
        try {
          if (hardTimeout) clearTimeout(hardTimeout);
        } catch { }

        const normalizedUsage = normalizeUsage(totalUsage || usage);
        try {
          console.log('[cloud-ai] onFinish reason:', finishReason, 'usage:', normalizedUsage);
        } catch { }

        const billableSteps = finishedSteps.length > 0
          ? finishedSteps
          : Array.isArray(steps) && steps.length > 0
            ? steps.map((step: any) => ({
                usage: step?.usage,
                providerMetadata: step?.providerMetadata,
              }))
            : (totalUsage || usage)
              ? [{ usage: totalUsage || usage, providerMetadata: (totalUsage || usage)?.providerMetadata }]
              : [];
        await billingTracker.settleToUsageList(billableSteps, { trigger: 'finish' });
        const billedTotals = billingTracker.getCumulativeTotals();
        const finalUsage = billedTotals.totalTokens > 0 || billedTotals.credits > 0
          ? {
              ...normalizedUsage,
              promptTokens: billedTotals.promptTokens,
              completionTokens: billedTotals.completionTokens,
              totalTokens: billedTotals.totalTokens,
              cachedPromptTokens: billedTotals.cachedPromptTokens,
              reasoningTokens: billedTotals.reasoningTokens,
              costUsd: billedTotals.costUsd,
              creditCost: billedTotals.credits,
            }
          : normalizedUsage;

        let finalText = String(text || '').trim();
        if (!finalText && runtime.aggregatedText) {
          finalText = runtime.aggregatedText.trim();
        }

        writeLog('stream_finish', {
          finishReason,
          usage: finalUsage,
          textLength: finalText.length,
          sawToolCall: runtime.sawToolCall,
          sawAnyTextDelta: runtime.sawAnyTextDelta,
        });

        appendCompletedToolCallsToHistory(history, toolCallsMap);
        if (finalText) {
          history.push({ role: 'assistant', content: finalText });
        }

        const carriedInterjection = drainInterjectionPayload(ws, requestId);
        if (carriedInterjection) {
          deferInterjectionToQueuedTurn(carriedInterjection);
        }

        scheduleHistoryCompaction(ws, history);
        if (authUser && conversationId) {
          try {
            await addAssistantMessage(authUser.userId, conversationId, finalText, buildMetadata());
          } catch { }
        }

        const safeSteps = typeof steps !== 'undefined' ? sanitizeSteps(steps) : steps;
        send(ws, {
          type: 'final',
          origin: 'cloud-ai',
          model: chosenModelId || routedTier,
          conversationId,
          result: { text: finalText, steps: safeSteps, finishReason, usage: finalUsage },
        }, requestId);

        setRequestTerminalResult({
          text: finalText,
          finishReason: finishReason || 'done',
          model: chosenModelId || routedTier,
          conversationId: conversationId || undefined,
        });

        if (authUser) {
          try {
            if (conversationId) {
              await finishRun(authUser.userId, conversationId, finalText || '');
            }
          } catch { }
        }

        if (!isQuickChatRequest(msg)) {
          if (agentType === 'stuard') {
            startKnowledgeIngestion(history, conversationId, finalUsage?.totalTokens, {
              bridgeWs,
              userId: authUser?.userId,
            });
          }
          startLocalMemoryPersistence(conversationId || resource, history, prompt, finalText, {
            bridgeWs,
            // SMS/mobile turns have their own local ingest path after `final`.
            userId: msg?.mobileSource ? undefined : authUser?.userId,
            userAttachments: Array.isArray(msg?.attachments) ? msg.attachments : undefined,
            userMetadata: contextPathsForMeta ? { contextPaths: contextPathsForMeta } : undefined,
            assistantMetadata: buildMetadata(),
            owner: memoryOwner,
            source: agentType === 'workflow'
              ? 'workflow'
              : agentType === 'skill'
                ? 'skill'
                : agentType === 'bot'
                  ? 'proactive'
                  : 'stuard',
          });
        }
      },
    };

    const basePrepareStep = streamOptions.prepareStep || streamOptions.experimental_prepareStep;
    streamOptions.prepareStep = async (options: any) => {
      const preparedStep = typeof basePrepareStep === 'function'
        ? await basePrepareStep(options)
        : undefined;
      const interjection = drainInterjectionPayload(ws, requestId);
      if (!interjection) return preparedStep;

      const baseMessages = Array.isArray(preparedStep?.messages)
        ? preparedStep.messages
        : Array.isArray(options?.messages)
          ? options.messages
          : inputMessages;

      await persistUserInterjection(interjection, 'step');
      send(ws, {
        type: 'progress',
        event: 'interjection_applied',
        data: { count: interjection.count },
      }, requestId);

      return {
        ...(preparedStep || {}),
        messages: appendInterjectionToMessages(baseMessages, interjection.content),
      };
    };

    if (agentType !== 'workflow' && !isQuickChatRequest(msg)) {
      streamOptions.memory = { resource, thread };
    }

    const stream: any = await agent.stream(inputMessages, streamOptions);
    const hasFull = !!stream?.fullStream;
    const fullStream = stream?.fullStream || stream;
    try {
      console.log('[cloud-ai] Stream obtained. hasFullStream:', hasFull, 'type:', typeof fullStream);
    } catch { }

    let streamIterationError: any = null;
    try {
      for await (const chunk of fullStream as any) {
        if (abortController.signal.aborted) {
          console.log(`[cloud-ai] Stream loop detected abort, breaking | reason=${getAbortReason(abortController.signal) || 'unknown'}`);
          break;
        }

        try {
          handleStreamChunk({
            chunk,
            ws,
            requestId,
            authUser,
            runtime,
            toolCallsMap,
            streamChunks,
          });
        } catch (error: any) {
          console.error('[cloud-ai] Stream chunk error:', error);
          writeLog('stream_chunk_error', { message: error?.message || String(error) });
        }
      }
    } catch (error: any) {
      streamIterationError = error;
      console.error('[cloud-ai] Stream iteration error:', error);
      writeLog('stream_iteration_error', { message: error?.message || String(error) });
    }

    if (streamIterationError && !runtime.didSendFinal) {
      runtime.didSendFinal = true;
      try {
        if (hardTimeout) clearTimeout(hardTimeout);
      } catch { }
      deleteAbortController(ws, requestId);

      const messageText = String(streamIterationError?.message || streamIterationError || 'Agent stream failed');
      const errorFinalText = runtime.aggregatedText ? runtime.aggregatedText.trim() : `Error: ${messageText}`;
      await persistAssistantText(errorFinalText, 'error');
      await billingTracker.settleToUsageList(finishedSteps, {
        trigger: 'iteration_error',
        partial: true,
      });

      send(ws, {
        type: 'final',
        origin: 'cloud-ai',
        model: chosenModelId || routedTier,
        conversationId,
        result: { text: errorFinalText, steps: [], finishReason: 'error' },
        error: true,
      }, requestId);

      setRequestTerminalResult({
        text: errorFinalText,
        finishReason: 'error',
        error: true,
        model: chosenModelId || routedTier,
        conversationId: conversationId || undefined,
      });
      return;
    }

    if (!runtime.didSendFinal) {
      try {
        const maybe = stream?.text;
        const maybeText = typeof maybe === 'string'
          ? maybe
          : maybe && typeof maybe?.then === 'function'
            ? await maybe
            : '';
        if (!runtime.aggregatedText && typeof maybeText === 'string' && maybeText.trim()) {
          runtime.aggregatedText = maybeText;
        }
      } catch { }
    }

    if (abortController?.signal.aborted) {
      const abortReason = getAbortReason(abortController.signal) || 'unknown';
      console.log(`[cloud-ai] Stream aborted (loop break) | reason=${abortReason}`);
      if (runtime.didSendFinal) {
        try {
          if (hardTimeout) clearTimeout(hardTimeout);
        } catch { }
        deleteAbortController(ws, requestId);
        await billingTracker.settleToUsageList(finishedSteps, {
          trigger: abortReason === 'hard_timeout' ? 'timeout' : 'abort_after_final',
          partial: true,
        });
        return;
      }
      runtime.didSendFinal = true;
      try {
        if (hardTimeout) clearTimeout(hardTimeout);
      } catch { }
      deleteAbortController(ws, requestId);

      const partialText = runtime.aggregatedText ? runtime.aggregatedText.trim() : '';
      if (partialText) {
        await persistAssistantText(partialText, 'aborted');
      }
      await billingTracker.settleToUsageList(finishedSteps, {
        trigger: 'aborted',
        partial: true,
      });

      send(ws, {
        type: 'final',
        origin: 'cloud-ai',
        model: chosenModelId || routedTier,
        conversationId,
        result: { text: partialText || '(Stopped)', steps: [], finishReason: 'aborted' },
        aborted: true,
      }, requestId);

      setRequestTerminalResult({
        text: partialText || '(Stopped)',
        finishReason: 'aborted',
        aborted: true,
        model: chosenModelId || routedTier,
        conversationId: conversationId || undefined,
      });
      return;
    }

    if (!runtime.didSendFinal) {
      let finalText = runtime.aggregatedText ? runtime.aggregatedText.trim() : '';
      let emptyOutput = !finalText && !runtime.sawAnyTextDelta && !runtime.sawToolCall;

      if (emptyOutput && agentType === 'workflow' && typeof (agent as any)?.generate === 'function') {
        try {
          const generated = await (agent as any).generate(inputMessages);
          const generatedText = String(generated?.text || '').trim();
          if (generatedText) {
            finalText = generatedText;
            emptyOutput = false;
          }
        } catch { }
      }

      if (!runtime.didSendFinal) {
        runtime.didSendFinal = true;
        try {
          if (hardTimeout) clearTimeout(hardTimeout);
        } catch { }

        if (finalText) {
          history.push({ role: 'assistant', content: finalText });
        }
        const carriedInterjection = drainInterjectionPayload(ws, requestId);
        if (carriedInterjection) {
          deferInterjectionToQueuedTurn(carriedInterjection);
        }

        let outputText = finalText;
        if (emptyOutput) {
          const mapped = await buildEmptyOutputMessage({
            modelId: chosenModelId,
            modelLabel,
            attachments: summarizeInputAttachments(inputMessages),
          });
          outputText = `Error: ${mapped.message}`;
          try { writeLog('empty_output', { code: mapped.code, model: chosenModelId || routedTier }); } catch { }
        }

        send(ws, {
          type: 'final',
          origin: 'cloud-ai',
          model: chosenModelId || routedTier,
          conversationId,
          result: {
            text: outputText,
            steps: [],
            finishReason: emptyOutput ? 'empty' : 'done',
          },
          error: emptyOutput ? true : undefined,
        }, requestId);
      }
    }

    try {
      if (hardTimeout) clearTimeout(hardTimeout);
    } catch { }
    deleteAbortController(ws, requestId);
  } catch (error: any) {
    try {
      if (hardTimeout) clearTimeout(hardTimeout);
    } catch { }
    deleteAbortController(ws, requestId);

    if (error?.name === 'AbortError' || abortController?.signal.aborted) {
      const abortReason = getAbortReason(abortController?.signal) || 'unknown';
      console.log(`[cloud-ai] Stream aborted | reason=${abortReason}`);
      if (runtime.didSendFinal) {
        await billingTracker.settleToUsageList(finishedSteps, {
          trigger: abortReason === 'hard_timeout' ? 'timeout' : 'abort_after_final',
          partial: true,
        });
        return;
      }
      const partialText = runtime.aggregatedText ? runtime.aggregatedText.trim() : '';

      if (partialText) {
        await persistAssistantText(partialText, 'aborted');
      }
      await billingTracker.settleToUsageList(finishedSteps, {
        trigger: 'abort_error',
        partial: true,
      });

      send(ws, {
        type: 'final',
        origin: 'cloud-ai',
        model: chosenModelId || routedTier,
        conversationId,
        result: { text: partialText || '(Stopped)', steps: [], finishReason: 'aborted' },
        aborted: true,
      }, requestId);

      setRequestTerminalResult({
        text: partialText || '(Stopped)',
        finishReason: 'aborted',
        aborted: true,
        model: chosenModelId || routedTier,
        conversationId: conversationId || undefined,
      });
      return;
    }

    console.error('[cloud-ai] Stream error:', error);
    const toolCallParseError =
      error
      && typeof error === 'object'
      && typeof (error as any).input === 'string'
      && ((error as any).error instanceof SyntaxError || String((error as any).error || '').includes('SyntaxError'));

    if (toolCallParseError) {
      const errorMessage = String((error as any)?.error?.message || 'Invalid JSON in tool call input');
      const inputPreview = String((error as any).input || '').slice(0, 2000);
      const toolCallId = `tc-parse-${Date.now()}`;

      try {
        writeLog('tool_call_parse_error', {
          message: errorMessage,
          inputChars: typeof (error as any).input === 'string' ? (error as any).input.length : undefined,
        });
      } catch { }

      try {
        send(ws, {
          type: 'progress',
          event: 'tool_event',
          data: {
            tool: 'tool_call',
            status: 'error',
            toolCallId,
            error: 'invalid_json',
            message: errorMessage,
            inputPreview,
          },
        }, requestId);
      } catch { }

      const finalText = `Tool call failed: ${errorMessage}. Please retry.`;
      await persistAssistantText(finalText, 'error');

      send(ws, {
        type: 'final',
        origin: 'cloud-ai',
        result: { text: finalText, steps: [], finishReason: 'error' },
      }, requestId);

      setRequestTerminalResult({
        text: finalText,
        finishReason: 'error',
        error: true,
        model: chosenModelId || routedTier,
        conversationId: conversationId || undefined,
      });
      return;
    }

    const mappedError = mapStreamError(error, {
      modelId: chosenModelId,
      modelLabel,
      attachments: summarizeInputAttachments(inputMessages),
    });
    const friendlyMessage = mappedError?.message || error?.message || String(error);
    if (mappedError) {
      try { writeLog('stream_error_mapped', { code: mappedError.code, model: chosenModelId || routedTier }); } catch { }
    }

    const errorText = runtime.aggregatedText ? runtime.aggregatedText.trim() : `Error: ${friendlyMessage}`;
    await persistAssistantText(errorText, 'error');
    await billingTracker.settleToUsageList(finishedSteps, {
      trigger: 'stream_error',
      partial: true,
    });

    send(ws, { type: 'error', message: friendlyMessage, code: mappedError?.code }, requestId);
    setRequestTerminalResult({
      text: runtime.aggregatedText || '',
      finishReason: 'error',
      error: true,
      model: chosenModelId || routedTier,
      conversationId: conversationId || undefined,
    });
  } finally {
    unregisterNestedRecorder(requestId);
    // Safety net: never leave a delegated subagent hung on ask_orchestrator
    // after the orchestrator turn ends. In the normal case the orchestrator
    // replies first — reply_to_subagent blocks the stream until the subagent
    // finishes, and the system prompt forbids ending with a question pending —
    // so this only fires when the model stops anyway. It unblocks + aborts the
    // stragglers so the UI never sticks on "Using ask_orchestrator…".
    //
    // Imported lazily: a static import would pull subagent-runtime's heavy
    // dependency graph into this module's load and only matters for the
    // orchestrator (stuard) path that actually delegates.
    if (requestId && agentType === 'stuard') {
      try {
        const stranded = resolvePendingSubagentQuestionsForRequest(requestId, 'turn_ended');
        if (stranded.length > 0) {
          writeLog('subagent_questions_backstop', { requestId, count: stranded.length });
          const { abortRunningSubagent } = await import('../../orchestrator/subagent-runtime');
          for (const id of stranded) {
            try { abortRunningSubagent(id, 'turn_ended'); } catch { }
          }
        }
      } catch { }
    }
  }
}

function appendCompletedToolCallsToHistory(history: any[], toolCallsMap: Map<string, any>) {
  const completedToolCalls = Array.from(toolCallsMap.values()).filter((toolCall) => toolCall.status === 'completed');
  if (completedToolCalls.length === 0) {
    return;
  }

  history.push({
    role: 'assistant',
    content: completedToolCalls.map((toolCall) => ({
      type: 'tool-call' as const,
      toolCallId: toolCall.id,
      toolName: toolCall.tool,
      input: toolCall.input ?? toolCall.args ?? {},
      args: toolCall.args || {},
    })),
  });

  for (const toolCall of completedToolCalls) {
    let resultText = typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result ?? '');
    const toolName = String(toolCall.tool || '');
    const isRichExtract = toolName === 'scrape_url' || toolName === 'web_search';
    const maxKeep = isRichExtract ? 14_000 : 1800;
    const maxBeforeTrim = isRichExtract ? 16_000 : 2000;
    if (resultText.length > maxBeforeTrim) {
      resultText = resultText.slice(0, maxKeep) + `\n...[truncated, ${resultText.length} chars total]`;
    }

    history.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: toolCall.id,
        toolName: toolCall.tool,
        output: { type: 'text', value: resultText },
        result: resultText,
      }],
    });
  }
}

function scheduleHistoryCompaction(ws: PreparedChatRequest['ws'], history: any[]) {
  compactHistory(history).then(() => {
    conversations.set(ws, history);
  }).catch((error) => {
    console.warn('[cloud-ai] Compaction failed:', error);
    if (history.length > 60) {
      history.splice(0, history.length - 60);
    }
    conversations.set(ws, history);
  });
}

function fireAndForgetConversationTitle(
  userId: string,
  conversationId: string,
  prompt: string,
  ws: PreparedChatRequest['ws'],
  requestId: string | undefined,
) {
  // Fully non-blocking: the conversation row already has a provisional title
  // (the first words of the user message) set at creation time, so the UI
  // never shows "Untitled" while this LLM call is in flight. When the result
  // arrives we overwrite both the DB row and the UI tab.
  (async () => {
    try {
      const titlePrompt = `User message:\n${prompt}`;
      const titleModelId = getDefaultModelForCategory('fast');
      const titleModel = buildNativeProviderModel(titleModelId);
      const result = await generateText({
        model: titleModel as any,
        system: THREAD_TITLE_SYSTEM,
        prompt: titlePrompt,
        temperature: 0.2,
      });
      const title = normalizeThreadTitle((result as any)?.text);
      if (title) {
        await memoryService.updateConversation(conversationId, { title }).catch(() => undefined);
        send(ws, { type: 'title', conversationId, title, provisional: false }, requestId);
      }
    } catch { }
  })();
}

function resolvePostRunBridge(
  bridgeWs: BridgeWebSocket | undefined,
  userId: string | undefined,
): BridgeWebSocket | undefined {
  const desktopWs = userId ? getDesktopWs(userId) : undefined;
  if (isOpenBridge(desktopWs)) {
    return desktopWs;
  }
  if (isOpenBridge(bridgeWs)) {
    return bridgeWs;
  }
  return undefined;
}

function startWithPostRunBridge(
  bridgeWs: BridgeWebSocket | undefined,
  userId: string | undefined,
  run: () => Promise<void> | void,
) {
  // Prefer the persistent desktop bridge for background work. The per-chat
  // stream socket may close as soon as `final` is delivered.
  const postRunBridge = resolvePostRunBridge(bridgeWs, userId);
  if (postRunBridge) {
    void withClientBridge(postRunBridge, run);
  } else {
    void run();
  }
}

/**
 * B5: in-memory per-process counter for "turns since last collection
 * synthesis". Cheap heuristic — when it hits the interval, we kick off a
 * background `synthesizeCollections` run. Process restarts reset to 0 (a
 * full synthesis on the *next* trigger is fine; the synthesizer is idempotent
 * for already-fresh topics).
 */
let _collectionSynthesisTurnCounter = 0;
function shouldRunCollectionSynthesis(): boolean {
  _collectionSynthesisTurnCounter += 1;
  const interval = Math.max(1, parseInt(process.env.COLLECTION_SYNTHESIS_INTERVAL || '20', 10));
  if (_collectionSynthesisTurnCounter >= interval) {
    _collectionSynthesisTurnCounter = 0;
    return true;
  }
  return false;
}

/** B2: separate counter for the consolidation pass (vector dedup of bio/project
 *  facts). Runs more often than synthesis because facts accumulate faster than
 *  topic drawers go stale. */
let _consolidationTurnCounter = 0;
function shouldRunConsolidation(): boolean {
  _consolidationTurnCounter += 1;
  const interval = Math.max(1, parseInt(process.env.FACT_CONSOLIDATION_INTERVAL || '10', 10));
  if (_consolidationTurnCounter >= interval) {
    _consolidationTurnCounter = 0;
    return true;
  }
  return false;
}

function startKnowledgeIngestion(
  history: any[],
  conversationId: string | null,
  totalTokens: number | undefined,
  bridge: { bridgeWs?: BridgeWebSocket; userId?: string },
) {
  // Re-establish the bridge context so execLocalTool can reach the desktop.
  // The onFinish callback from the AI SDK may lose the AsyncLocalStorage context.

  const run = async () => {
    try {
      const { ingestConversationTurn, analyzeForAutoSkill } = await import('../../knowledge');
      const { synthesizeCollections } = await import('../../memory/collection-synthesizer');
      const { execLocalTool } = await import('../../tools/bridge');
      const fullHistory = [...history];
      console.log('[cloud-ai] Starting knowledge ingestion, history length:', fullHistory.length);

      // B1: thread conversationId through so extraction can be incremental.
      ingestConversationTurn(fullHistory, conversationId ? { conversationId } : undefined)
        .then(({ extracted, executed }) => {
          console.log('[cloud-ai] Knowledge ingestion complete:', {
            actionsExtracted: extracted.actions.length,
            actionsSucceeded: executed.success,
            actionsFailed: executed.failed,
            actions: extracted.actions.map((action: any) => action.action),
          });
          if (extracted.actions.length > 0) {
            writeLog('knowledge_ingested', {
              actionsExtracted: extracted.actions.length,
              actionsSucceeded: executed.success,
              actionsFailed: executed.failed,
            });
          }
        }).catch((error) => {
          console.error('[cloud-ai] Knowledge ingestion failed:', error);
        });

      analyzeForAutoSkill(fullHistory, conversationId ?? undefined, totalTokens).then((draft) => {
        if (draft) {
          console.log(`[cloud-ai] Auto-skill generated: "${draft.name}" (confidence=${draft.confidence}, steps=${draft.steps.length})`);
        }
      }).catch((error) => {
        console.error('[cloud-ai] Auto-skill analysis failed:', error);
      });

      // B4: pending-memory TTL + cap hygiene. Single SQL — runs every turn.
      execLocalTool('pending_memory_expire', {}, undefined, 5000, { silent: true })
        .then((result: any) => {
          if (result && (result.expired > 0 || result.dropped > 0)) {
            writeLog('pending_memory_expire', result);
          }
        })
        .catch((error) => {
          console.log('[cloud-ai] pending_memory_expire failed (non-fatal):', error);
        });

      // B5: periodic collection synthesizer. Cheap fast-LLM calls, only
      // refreshes stale/new topics. Fires every N turns.
      if (shouldRunCollectionSynthesis()) {
        synthesizeCollections({ minSegments: 5 })
          .then((stats: any) => {
            console.log('[cloud-ai] Collection synthesis ran:', stats);
            writeLog('collection_synthesis_complete', stats);
          })
          .catch((error: any) => {
            console.log('[cloud-ai] Collection synthesis failed (non-fatal):', error);
          });
      }

      // B2 stage 1: pairwise vector dedup for bio + project facts. Pure
      // SQL+numpy on the desktop side — no vectors crossing the bridge, no
      // LLM. Catches accidental duplicates from drift in extraction phrasing.
      if (shouldRunConsolidation()) {
        Promise.all([
          execLocalTool('knowledge_consolidate_facts', { category: 'personal', subtype: 'bio' }, undefined, 30000, { silent: true }),
          execLocalTool('knowledge_consolidate_facts', { category: 'project', subtype: 'detail' }, undefined, 30000, { silent: true }),
        ])
          .then(([bioStats, projStats]) => {
            const totalConsolidated = (Number(bioStats?.consolidated) || 0) + (Number(projStats?.consolidated) || 0);
            if (totalConsolidated > 0) {
              console.log('[cloud-ai] Fact consolidation:', { bio: bioStats, project: projStats });
              writeLog('fact_consolidation_complete', { bio: bioStats, project: projStats });
            }
          })
          .catch((error) => {
            console.log('[cloud-ai] Fact consolidation failed (non-fatal):', error);
          });
      }
    } catch (error) {
      console.error('[cloud-ai] Knowledge pipeline import failed:', error);
    }
  };

  startWithPostRunBridge(bridge.bridgeWs, bridge.userId, run);
}

function startLocalMemoryPersistence(
  localConversationId: string,
  history: any[],
  prompt: string,
  finalText: string,
  options?: {
    bridgeWs?: BridgeWebSocket;
    userId?: string;
    userAttachments?: any[];
    userMetadata?: Record<string, any>;
    assistantMetadata?: Record<string, any>;
    source?: 'stuard' | 'workflow' | 'skill' | 'proactive';
    owner?: memoryService.MemoryOwnerScope;
  },
) {
  startWithPostRunBridge(options?.bridgeWs, options?.userId, () => {
    try {
      if (prompt) {
        memoryService.storeMessageLocally(localConversationId, 'user', prompt, {
          attachments: options?.userAttachments,
          metadata: options?.userMetadata,
          source: options?.source,
          owner: options?.owner,
        }).catch((error) => {
          console.error('[cloud-ai] Failed to store user message locally:', error);
        });
      }

      if (finalText) {
        memoryService.storeMessageLocally(localConversationId, 'assistant', finalText, {
          metadata: options?.assistantMetadata,
          source: options?.source,
          owner: options?.owner,
        }).catch((error) => {
          console.error('[cloud-ai] Failed to store assistant message locally:', error);
        });
      }

      const fullHistory = [...history];
      memoryService.processConversationTurn(localConversationId, fullHistory, {
        source: options?.source,
        owner: options?.owner,
      }).catch((error) => {
        console.error('[cloud-ai] Local memory processing failed:', error);
      });
    } catch (error) {
      console.error('[cloud-ai] Local memory storage import failed:', error);
    }
  });
}

function appendTextChunk(text: string, runtime: RuntimeState, streamChunks: StreamChunkRecord[]) {
  if (!text) return;

  runtime.sawAnyTextDelta = true;
  runtime.aggregatedText += text;
  const lastChunk = streamChunks[streamChunks.length - 1];
  // Only coalesce into the previous orchestrator text chunk — never a nested
  // subagent text chunk, or the orchestrator's reply would corrupt a delegated
  // agent's narration (and vice-versa).
  if (lastChunk?.type === 'text' && !lastChunk.nested) {
    lastChunk.content += text;
  } else {
    streamChunks.push({ type: 'text', content: text });
  }
}

export function handleStreamChunk({
  chunk,
  ws,
  requestId,
  authUser,
  runtime,
  toolCallsMap,
  streamChunks,
}: {
  chunk: any;
  ws: PreparedChatRequest['ws'];
  requestId: string | undefined;
  authUser: PreparedChatRequest['authUser'];
  runtime: RuntimeState;
  toolCallsMap: Map<string, any>;
  streamChunks: StreamChunkRecord[];
}) {
  const chunkKeys = Object.keys(chunk || {});
  const eventType = chunk?.type;
  if (process.env.CLOUD_DEBUG_STREAM === '1' && chunkKeys.length > 0 && !chunk?.textDelta) {
    console.log('[cloud-ai] Stream chunk keys:', chunkKeys, chunk);
  }

  let handledChunk = false;
  if (eventType) {
    switch (eventType) {
      case 'start':
        send(ws, { type: 'progress', event: 'start', data: {} }, requestId);
        handledChunk = true;
        break;

      case 'text-delta': {
        const text = chunk?.payload?.text || chunk?.text || '';
        if (text) {
          appendTextChunk(text, runtime, streamChunks);
          send(ws, { type: 'progress', event: 'delta', data: { text } }, requestId);
          writeLog('delta', { length: text.length });
        }
        handledChunk = true;
        break;
      }

      case 'reasoning-start':
      case 'thinking-start':
        send(ws, { type: 'progress', event: 'reasoning_start', data: { id: chunk?.payload?.id } }, requestId);
        handledChunk = true;
        break;

      case 'reasoning-delta':
      case 'thinking-delta': {
        const reasoningText = chunk?.payload?.text
          || chunk?.textDelta
          || (typeof chunk?.payload === 'string' ? chunk.payload : '');
        if (reasoningText) {
          send(ws, { type: 'progress', event: 'reasoning', data: { text: reasoningText } }, requestId);
        }
        handledChunk = true;
        break;
      }

      case 'reasoning-end':
      case 'thinking-end':
        send(ws, { type: 'progress', event: 'reasoning_end', data: { id: chunk?.payload?.id } }, requestId);
        handledChunk = true;
        break;

      case 'reasoning-signature':
        handledChunk = true;
        break;

      case 'tool_event': {
        runtime.sawToolCall = true;
        const safeEvent = sanitizeToolEvent(chunk);
        if (safeEvent?.tool === 'workflow_modify' && safeEvent?.status === 'completed') {
          console.log('[cloud-ai] Forwarding workflow_modify completed event with result:', {
            hasResult: !!safeEvent?.result,
            hasWorkflow: !!safeEvent?.result?.workflow,
            changes: safeEvent?.result?.changes,
          });
        }

        if (authUser?.userId && requestId && safeEvent?.status === 'approval_required' && safeEvent?.id) {
          addPendingApproval(authUser.userId, requestId, {
            id: safeEvent.id,
            tool: safeEvent.tool || '',
            args: safeEvent.args,
            description: safeEvent.description,
            createdAt: Date.now(),
          });
        }
        if (
          authUser?.userId
          && requestId
          && (safeEvent?.status === 'completed' || safeEvent?.status === 'error' || safeEvent?.status === 'failed')
          && safeEvent?.id
        ) {
          removePendingApprovalByToolId(authUser.userId, safeEvent.id);
        }

        send(ws, { type: 'progress', event: 'tool_event', data: safeEvent }, requestId);
        writeLog('tool_event', { source: 'top-level', tool: safeEvent?.tool, status: safeEvent?.status });
        handledChunk = true;
        break;
      }

      case 'tool-call': {
        runtime.sawToolCall = true;
        const toolName = chunk?.payload?.toolName || chunk?.payload?.tool || chunk?.payload?.name || chunk?.toolName || chunk?.tool || chunk?.name || 'tool';
        const toolCallId = chunk?.payload?.toolCallId || chunk?.payload?.id || chunk?.toolCallId || chunk?.id || `tc-${Date.now()}`;
        const toolArgs = chunk?.payload?.args ?? chunk?.payload?.input ?? chunk?.args ?? chunk?.input ?? {};
        const toolCall = {
          id: toolCallId,
          tool: toolName,
          status: 'called',
          input: toolArgs,
          args: toolArgs,
          timestamp: Date.now(),
        };
        toolCallsMap.set(toolCallId, toolCall);
        streamChunks.push({ type: 'tool', tool: { ...toolCall } });

        if (!isSISMetaTool(toolName)) {
          send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolName, status: 'called', toolCallId, args: toolArgs } }, requestId);
        }
        writeLog('tool_call', { name: toolName });
        handledChunk = true;
        break;
      }

      case 'tool-result': {
        runtime.sawToolCall = true;
        const toolName = chunk?.payload?.toolName || chunk?.payload?.tool || chunk?.payload?.name || chunk?.toolName || chunk?.tool || chunk?.name || 'tool';
        const toolCallId = chunk?.payload?.toolCallId || chunk?.payload?.id || chunk?.toolCallId || chunk?.id || '';
        const toolResult = chunk?.payload?.result ?? chunk?.payload?.output ?? chunk?.result ?? chunk?.output;
        const existingCall = toolCallsMap.get(toolCallId);
        if (existingCall) {
          existingCall.status = 'completed';
          existingCall.result = toolResult;
          for (const streamChunk of streamChunks) {
            if (streamChunk.type === 'tool' && streamChunk.tool.id === toolCallId) {
              streamChunk.tool.status = 'completed';
              streamChunk.tool.result = toolResult;
              break;
            }
          }
        }

        if (!isSISMetaTool(toolName)) {
          const clientResult = attachResearchReportForClient(
            toolName,
            attachWorkflowForClient(toolName, toolResult),
          );
          send(ws, {
            type: 'progress',
            event: 'tool_event',
            data: { tool: toolName, status: 'completed', toolCallId, result: clientResult },
          }, requestId);
        }
        handledChunk = true;
        break;
      }

      case 'finish': {
        const text = chunk?.payload?.text || chunk?.payload?.response?.text || chunk?.text || '';
        if (typeof text === 'string' && text) {
          appendTextChunk(text, runtime, streamChunks);
        }
        handledChunk = true;
        break;
      }

      case 'step-finish':
      case 'step-start':
      case 'response-metadata':
        handledChunk = true;
        break;
    }
  }

  if (!handledChunk) {
    if (eventType && process.env.CLOUD_DEBUG_STREAM === '1') {
      console.log('[cloud-ai] Unhandled chunk type:', eventType, JSON.stringify(chunk).slice(0, 300));
    }

    let textDelta: string | undefined;
    if (typeof chunk === 'string') {
      textDelta = chunk;
    } else if (typeof chunk?.textDelta === 'string') {
      textDelta = chunk.textDelta;
    } else if (typeof chunk?.delta === 'string') {
      textDelta = chunk.delta;
    } else if (typeof chunk?.text === 'string') {
      textDelta = chunk.text;
    }

    if (textDelta && textDelta.length > 0) {
      appendTextChunk(textDelta, runtime, streamChunks);
      if (process.env.CLOUD_DEBUG_DELTA === '1') {
        console.log('[cloud-ai] Delta length:', textDelta.length, 'preview:', textDelta.slice(0, 80));
      }
      send(ws, { type: 'progress', event: 'delta', data: { text: textDelta } }, requestId);
      writeLog('delta', { length: textDelta.length });
    }
  }

  if (!handledChunk) {
    const toolCall = chunk?.toolCall;
    if (toolCall?.name) {
      runtime.sawToolCall = true;
      console.log(`[cloud-ai] Tool called: ${toolCall.name}`, toolCall.args);
      if (!isSISMetaTool(toolCall.name)) {
        send(ws, { type: 'progress', event: 'tool_event', data: { tool: toolCall.name, status: 'called', args: toolCall.args } }, requestId);
      }
      writeLog('tool_call', { name: toolCall.name });
    }

    const toolResult = chunk?.toolResult;
    if (toolResult) {
      runtime.sawToolCall = true;
      console.log('[cloud-ai] Tool result:', toolResult);
    }
  }
}
