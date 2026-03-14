
import { WebSocket } from 'ws';
import { getAgent as getStuardAgent } from '../../agents/stuard-agent';
import { getWorkflowAgent, WORKFLOW_SYSTEM_PROMPT } from '../../agents/workflow-agent';
import { getSkillAgent, SKILL_SYSTEM_PROMPT, clearSessionSkill, setSessionSkill } from '../../agents/skill-agent';
import { withClientBridge } from '../../tools/bridge';
import { routeModel, ModelChoice } from '../../router/model-router';
import { writeLog } from '../../utils/logger';
import { normalizeUsage } from '../../utils/usage';
import { computeBudget, estimateTokens } from '../../memory/token-budget';
import {
  emergencyTruncate,
  generateMidTurnSummary,
  getRecentWithinBudget,
  pruneToolOutputs,
} from '../../memory/context-compactor';

/** Max retries when the model calls a bad/missing tool or sends invalid args */
const MAX_TOOL_ERROR_RETRIES = 3;

/**
 * Detect if an error is caused by the model calling a non-existent, invalid, or
 * broken tool. Returns info about the problematic tool, or null for other errors.
 */
function detectToolError(error: any): { toolName: string; type: 'no_such_tool' | 'invalid_args' | 'tool_not_found' | 'tool_execution_error'; message: string } | null {
  if (!error || typeof error !== 'object') return null;

  const name = String(error.name || '');
  const message = String(error.message || '');

  // AI SDK NoSuchToolError (error.name === 'AI_NoSuchToolError')
  if (name === 'AI_NoSuchToolError' || name === 'NoSuchToolError' || message.includes('is not a tool')) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'no_such_tool',
      message: message || 'The model tried to call a tool that does not exist.',
    };
  }

  // AI SDK InvalidToolArgumentsError
  if (name === 'AI_InvalidToolArgumentsError' || name === 'InvalidToolArgumentsError') {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'invalid_args',
      message: message || 'The model generated invalid arguments for a tool call.',
    };
  }

  // AI SDK ToolExecutionError (tool.execute threw during execution)
  if (name === 'AI_ToolExecutionError' || name === 'ToolExecutionError') {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_execution_error',
      message: message || 'Tool execution failed.',
    };
  }

  // Generic patterns in error message
  const lower = message.toLowerCase();
  if (
    (lower.includes('tool') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('unknown tool'))) ||
    lower.includes('no such tool')
  ) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_not_found',
      message,
    };
  }

  // Catch tool-related execution errors (bridge failures, timeout, etc.)
  if (lower.includes('tool') && (lower.includes('failed') || lower.includes('error') || lower.includes('timeout'))) {
    return {
      toolName: error.toolName || extractToolName(message) || 'unknown',
      type: 'tool_execution_error',
      message,
    };
  }

  return null;
}

/** Try to extract a tool name from an error message like "Tool 'foo' not found" */
function extractToolName(message: string): string | undefined {
  const match = message.match(/[Tt]ool\s+['"`](\w+)['"`]/);
  return match?.[1];
}

type AgentType = 'stuard' | 'workflow' | 'skill';

interface AgentMessage {
  text: string;
  agent?: AgentType;
  model?: ModelChoice | 'auto';
  modelId?: string;
  modelConfig?: any;
  reasoningLevel?: 'none' | 'low' | 'medium' | 'high';
  integrations?: string[];
  history?: any[]; // Context history
  context?: {
    paths?: Array<{ path: string; name: string; isDirectory: boolean }>;
    tone?: string;
    persona?: string;
    [key: string]: any;
  };
  userId?: string;
  conversationId?: string;
}

function normalizeTier(input: any): ModelChoice | 'auto' {
  const raw = String(input || '').toLowerCase().trim();
  if (raw === 'deep') return 'smart';
  if (raw === 'smart') return 'smart';
  if (raw === 'balanced') return 'balanced';
  if (raw === 'fast') return 'fast';
  if (raw === 'research') return 'research';
  if (raw === 'auto') return 'auto';
  return 'balanced';
}

function pickDefaultModelId(modelConfig: any, tier: ModelChoice): string | undefined {
  try {
    const cfg = modelConfig && typeof modelConfig === 'object' ? modelConfig : null;
    const entry = cfg && (cfg as any)[tier];
    const d = entry && typeof entry.default === 'string' ? String(entry.default).trim() : '';
    return d || undefined;
  } catch {
    return undefined;
  }
}

function send(ws: WebSocket, data: unknown) {
  try { ws.send(JSON.stringify(data)); } catch { }
}

// Store active abort controllers by WebSocket
const activeControllers = new WeakMap<WebSocket, AbortController>();

export function abortAgent(ws: WebSocket): boolean {
  const controller = activeControllers.get(ws);
  if (controller) {
    console.log('[AgentRunner] Aborting agent stream');
    controller.abort();
    activeControllers.delete(ws);
    return true;
  }
  return false;
}

export async function runAgent(ws: WebSocket, message: AgentMessage, bridgeWs?: WebSocket): Promise<{ text: string } | null> {
  const agentType = message.agent || 'stuard';
  let model = normalizeTier(message.model);
  const integrations = message.integrations || [];
  const history = message.history || [];
  const context = message.context || {};
  const userId = message.userId;
  const conversationId = message.conversationId;
  let resultText = '';

  // Create abort controller for this request
  const abortController = new AbortController();
  activeControllers.set(ws, abortController);

  // 1. Auto-Routing Logic
  if (model === 'auto') {
    const routingResult = await routeModel({
      messages: [...history, { role: 'user', content: message.text }],
    });
    model = routingResult.model;
    // Notify UI of routing decision
    send(ws, { type: 'progress', event: 'routing', data: { m: routingResult.modelIndex, l: routingResult.layerIndexes } });
  }

  const chosenModelId =
    (typeof message.modelId === 'string' && message.modelId.trim())
      ? message.modelId.trim()
      : pickDefaultModelId(message.modelConfig, model);
  const budget = computeBudget(chosenModelId || model);
  pruneToolOutputs(history as any[], budget);
  if (estimateTokens(history as any[]).totalTokens > budget.historyBudget) {
    emergencyTruncate(history as any[], budget);
  }
  const effectiveHistory = getRecentWithinBudget(history as any[], budget);

  // Notify UI of final model decision (tier + optional concrete provider modelId)
  try {
    send(ws, { type: 'progress', event: 'model', data: { tier: model, modelId: chosenModelId } });
  } catch { }

  await withClientBridge(bridgeWs || ws, async () => {
    let fullText = '';
    let usage: any = null;

    try {
      // Select agent based on type
      if (agentType === 'skill') {
        try {
          clearSessionSkill();
          const incomingSkill = message?.context?.skill;
          if (incomingSkill && typeof incomingSkill === 'object' && !Array.isArray(incomingSkill)) {
            setSessionSkill(incomingSkill);
          }
        } catch { }
      }

      const agent = agentType === 'workflow'
        ? getWorkflowAgent(chosenModelId)
        : agentType === 'skill'
          ? getSkillAgent(chosenModelId)
          : getStuardAgent(model as ModelChoice, undefined, integrations, {}, chosenModelId);

      // Build context prefix for paths
      let contextPrefix = '';
      if (context.paths && context.paths.length > 0) {
        const pathsList = context.paths.map(p =>
          `- ${p.isDirectory ? '[DIR]' : '[FILE]'} ${p.path}`
        ).join('\n');
        contextPrefix = `[Context: The user has provided these local file/folder paths for reference]\n${pathsList}\n\n`;
      }

      // Hidden context (e.g. SMS formatting instructions) — prepend as system-level guidance
      const hiddenContextMsg = context.hiddenContext
        ? { role: 'system', content: String(context.hiddenContext) }
        : null;

      // Prepare input with context
      const userContent = contextPrefix + message.text;
      const buildInput = (extraMessages?: Array<{ role: string; content: string }>) => {
        const extra = extraMessages || [];
        if (effectiveHistory.length > 0 || extra.length > 0 || hiddenContextMsg) {
          const prefix = hiddenContextMsg ? [hiddenContextMsg] : [];
          const base = [...prefix, ...effectiveHistory, ...extra, { role: 'user', content: userContent }];
          if (agentType === 'workflow') {
            return [{ role: 'system', content: WORKFLOW_SYSTEM_PROMPT }, ...base];
          }
          if (agentType === 'skill') {
            return [{ role: 'system', content: SKILL_SYSTEM_PROMPT }, ...base];
          }
          return base;
        }
        if (agentType === 'workflow') {
          return [{ role: 'system', content: WORKFLOW_SYSTEM_PROMPT }, { role: 'user', content: userContent }];
        }
        if (agentType === 'skill') {
          return [{ role: 'system', content: SKILL_SYSTEM_PROMPT }, { role: 'user', content: userContent }];
        }
        return userContent;
      };

      // Notify start
      send(ws, { type: 'progress', event: 'start', data: {} });

      // Build stream options
      // Workflow agent needs more steps for tool discovery and testing
      const maxToolSteps = (agentType === 'workflow' || agentType === 'skill') ? 60 : 40;
      let cumulativeInputTokens = 0;
      let currentTurnStartIndex = 0;
      let midTurnCompacted = false;
      const streamOptions: any = {
        maxSteps: maxToolSteps,
        abortSignal: abortController.signal,
        prepareStep: async ({ messages, stepNumber }: any) => {
          if (!Array.isArray(messages) || stepNumber <= 1 || midTurnCompacted) {
            return {};
          }

          const estimate = estimateTokens(messages as any[]);
          if (estimate.totalTokens < budget.historyBudget * 0.85) {
            return {};
          }

          const safeCurrentTurnStart = Math.max(1, Math.min(currentTurnStartIndex, messages.length));
          const preTurnMessages = messages.slice(0, safeCurrentTurnStart) as any[];
          if (preTurnMessages.length < 4) {
            return {};
          }

          try {
            console.log(`[compactor] Mid-turn compaction at step ${stepNumber}: ${estimate.totalTokens} tokens`);
            const summary = await generateMidTurnSummary(preTurnMessages);
            messages.splice(0, safeCurrentTurnStart, { role: 'system', content: summary });
            midTurnCompacted = true;
            console.log(`[compactor] Mid-turn compacted: ${estimateTokens(messages as any[]).totalTokens} tokens remaining`);
          } catch (err) {
            console.warn('[compactor] Mid-turn summarization failed, falling back to pruning:', err);
            pruneToolOutputs(messages as any[], budget);
          }

          return {};
        },
        onStepFinish: ({ usage: stepUsage }: any) => {
          if (!stepUsage) return;
          const normalized = normalizeUsage(stepUsage);
          cumulativeInputTokens += normalized.promptTokens;
        },
      };

      // Enable thinking/reasoning streams for supported providers.
      const reasoningLevel: 'none' | 'low' | 'medium' | 'high' =
        (['none', 'low', 'medium', 'high'].includes(message.reasoningLevel || '') ? message.reasoningLevel : 'high') as any;

      // ---------- Google Gemini thinking ----------
      const isGemini3 = chosenModelId?.includes('google/gemini-3');
      const isGemini25 = chosenModelId?.includes('google/gemini-2.5');
      if (isGemini25) {
        const gemini25Budget: Record<'none' | 'low' | 'medium' | 'high', number> = {
          none: 0,
          low: 1024,
          medium: 8192,
          high: 24576,
        };
        streamOptions.providerOptions = {
          ...(streamOptions.providerOptions || {}),
          google: {
            thinkingConfig: {
              thinkingBudget: gemini25Budget[reasoningLevel],
              includeThoughts: reasoningLevel !== 'none',
            },
          },
        };
      } else if (isGemini3 && reasoningLevel !== 'none') {
        streamOptions.providerOptions = {
          ...(streamOptions.providerOptions || {}),
          google: {
            thinkingConfig: {
              thinkingLevel: reasoningLevel as 'low' | 'medium' | 'high',
              includeThoughts: true,
            },
          },
        };
      }

      // ---------- Anthropic thinking ----------
      if (chosenModelId?.includes('anthropic/')) {
        if (reasoningLevel === 'none') {
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            anthropic: {
              thinking: { type: 'disabled' },
            },
          };
        } else {
          const anthropicBudget: Record<string, number | undefined> = {
            low: 5000,
            medium: 16384,
            high: undefined, // no cap
          };
          const budgetTokens = anthropicBudget[reasoningLevel];
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            anthropic: {
              sendReasoning: true,
              thinking: budgetTokens
                ? { type: 'enabled', budgetTokens }
                : { type: 'enabled' },
            },
          };
        }
      }

      // ---------- OpenAI reasoning effort ----------
      if (chosenModelId?.includes('openai/')) {
        const modelPart = (chosenModelId || '').split('/').pop() || '';
        const supportsEffort = /^(o[1-9]|gpt-5(?:$|[-.]))/.test(modelPart);
        if (supportsEffort) {
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            openai: {
              reasoningEffort: reasoningLevel,
              // Responses API: expose reasoning summaries as streaming chunks
              reasoningSummary: reasoningLevel !== 'none' ? 'auto' : undefined,
            },
          };
        }
      }

      // ---------- xAI/Grok reasoning ----------
      if (chosenModelId?.includes('xai/')) {
        const modelPart = (chosenModelId || '').split('/').pop() || '';
        const supportsReasoning = !modelPart.includes('non-reasoning');
        if (supportsReasoning && reasoningLevel !== 'none') {
          // xAI Chat API only supports 'low' | 'high' (not 'medium' or 'none')
          const xaiEffort = reasoningLevel === 'low' ? 'low' : 'high';
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            xai: { reasoningEffort: xaiEffort },
          };
        }
      }

      // ---------- DeepSeek thinking ----------
      if (chosenModelId?.includes('deepseek/')) {
        if (reasoningLevel === 'none') {
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            deepseek: { thinking: { type: 'disabled' } },
          };
        } else {
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            deepseek: { thinking: { type: 'enabled' } },
          };
        }
      }

      // Track tool errors for retry logic
      const toolErrorHistory: string[] = [];
      let attempt = 0;

      while (attempt <= MAX_TOOL_ERROR_RETRIES) {
        try {
          // Build input, injecting tool error feedback if retrying
          const extraMessages = toolErrorHistory.length > 0
            ? [{ role: 'assistant', content: fullText || 'I tried to use a tool.' },
               { role: 'user', content: `[System: Tool call failed] ${toolErrorHistory[toolErrorHistory.length - 1]}. Please use only the tools available to you. Do NOT invent or guess tool names.` }]
            : undefined;
          const input = buildInput(extraMessages) as any;
          currentTurnStartIndex = Array.isArray(input) ? input.length : 1;
          midTurnCompacted = false;

          // Get stream result from Mastra
          const streamResult: any = await agent.stream(input, streamOptions);

          // Try to get the async iterable - Mastra uses fullStream
          const stream = streamResult?.fullStream || streamResult;

          // Check if it's actually iterable
          if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
            // Stream is async iterable - process chunks
            let chunkCount = 0;
            let reasoningChunks = 0;
            for await (const chunk of stream) {
              chunkCount++;
              if (chunk?.type === 'finish') {
                const finishUsage = chunk?.usage ?? chunk?.payload?.usage ?? chunk?.payload;
                if (finishUsage) {
                  usage = normalizeUsage(finishUsage);
                }
              }
              // Debug: log thinking/reasoning chunks
              if (chunk?.type?.includes('reasoning') || chunk?.type?.includes('thinking')) {
                reasoningChunks++;
                console.log('[AgentRunner] THINKING chunk:', chunk.type, chunk.payload?.text?.slice(0, 80) || chunk.textDelta?.slice(0, 80));
              }
              const delta = handleStreamChunk(ws, chunk);
              if (delta) fullText += delta;
            }
            console.log(`[AgentRunner] Stream complete: ${chunkCount} chunks, ${reasoningChunks} reasoning`);
          } else {
            // Not iterable - this is the aggregated result
            console.log('[AgentRunner] Stream not iterable, using aggregated result');
            if (streamResult?.text) {
              fullText = streamResult.text;
              send(ws, { type: 'progress', event: 'delta', data: { text: fullText } });
            }
            if (streamResult?.usage) {
              usage = normalizeUsage(streamResult.usage);
            }
          }

          // Try to get final text if we didn't accumulate any
          if (!fullText && streamResult?.text) {
            fullText = streamResult.text;
          }

          // Get usage from stream result if not set
          if (!usage && streamResult?.usage) {
            usage = normalizeUsage(streamResult.usage);
          }

          // Check for reasoning/thinking in final result
          if (streamResult?.reasoning) {
            console.log('[AgentRunner] Final reasoning found:', String(streamResult.reasoning).slice(0, 100));
            send(ws, { type: 'progress', event: 'reasoning', data: { text: streamResult.reasoning } });
          }
          if (streamResult?.thinking) {
            console.log('[AgentRunner] Final thinking found:', String(streamResult.thinking).slice(0, 100));
            send(ws, { type: 'progress', event: 'reasoning', data: { text: streamResult.thinking } });
          }

          // Stream succeeded - break out of retry loop
          break;

        } catch (streamError: any) {
          // Check if this is a tool error we can retry
          const toolError = detectToolError(streamError);
          if (toolError && attempt < MAX_TOOL_ERROR_RETRIES) {
            attempt++;
            const toolCallId = `tc-error-${Date.now()}`;
            const isHallucination = toolError.type === 'no_such_tool' || toolError.type === 'tool_not_found';
            const label = isHallucination ? 'hallucinated' : toolError.type === 'invalid_args' ? 'invalid args' : 'execution failed';

            console.warn(`[AgentRunner] Tool error (${label}): "${toolError.toolName}" (${toolError.type}), retrying (${attempt}/${MAX_TOOL_ERROR_RETRIES})`);

            try {
              writeLog('tool_error_retry', {
                toolName: toolError.toolName,
                type: toolError.type,
                attempt,
                message: toolError.message,
              });
            } catch { }

            // Notify UI about the failed tool call (show as error pill)
            send(ws, {
              type: 'progress',
              event: 'tool_event',
              data: {
                tool: toolError.toolName,
                status: 'called',
                toolCallId,
                args: {},
                description: `${toolError.toolName} (${label})`,
              }
            });
            send(ws, {
              type: 'progress',
              event: 'tool_event',
              data: {
                tool: toolError.toolName,
                status: 'error',
                toolCallId,
                error: isHallucination
                  ? `Tool "${toolError.toolName}" does not exist. Use search_tools to find available tools, or execute_tool to run tools by name. (attempt ${attempt}/${MAX_TOOL_ERROR_RETRIES})`
                  : `Tool "${toolError.toolName}" failed: ${toolError.message}. Check args with get_tool_schema first. (attempt ${attempt}/${MAX_TOOL_ERROR_RETRIES})`,
              }
            });

            // Store error feedback to inject into the retry
            if (isHallucination) {
              toolErrorHistory.push(
                `The tool "${toolError.toolName}" does not exist and cannot be called directly. ` +
                `Use search_tools to find available tools, or use execute_tool({ tool_name: "...", args: {...} }) to run tools by name. ` +
                `Do NOT invent tool names — only use tools you can verify exist.`
              );
            } else if (toolError.type === 'invalid_args') {
              toolErrorHistory.push(
                `Tool "${toolError.toolName}" received invalid arguments: ${toolError.message}. ` +
                `Use get_tool_schema({ tool_name: "${toolError.toolName}" }) to see the correct argument format before retrying.`
              );
            } else {
              toolErrorHistory.push(
                `Tool "${toolError.toolName}" failed during execution: ${toolError.message}. ` +
                `Try a different approach or use a different tool.`
              );
            }

            // Continue to next iteration of the retry loop
            continue;
          }

          // Not a retryable tool error, or retries exhausted - re-throw
          throw streamError;
        }
      }

      if (usage) {
        const promptTokens = Math.max(usage.promptTokens || 0, cumulativeInputTokens);
        usage = {
          ...usage,
          promptTokens,
          totalTokens: Math.max(usage.totalTokens || 0, promptTokens + (usage.completionTokens || 0)),
        };
      } else if (cumulativeInputTokens > 0) {
        usage = {
          promptTokens: cumulativeInputTokens,
          completionTokens: 0,
          totalTokens: cumulativeInputTokens,
        };
      }

      // Send final message (include conversationId for SMS multi-turn continuity)
      send(ws, {
        type: 'final',
        model: chosenModelId || model,
        conversationId,
        result: { text: fullText, response: fullText, usage, modelId: chosenModelId || model },
        usage,
      });

      resultText = fullText;

    } catch (error: any) {
      // Handle abort specifically
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        console.log('[AgentRunner] Stream aborted by user');
        send(ws, {
          type: 'final',
          model: chosenModelId || model,
          result: { text: fullText || '(Stopped)', response: fullText || '(Stopped)', modelId: chosenModelId || model },
          aborted: true
        });
        resultText = fullText || '(Stopped)';
      } else {
        console.error('[AgentRunner] Error:', error);

        // Check for tool errors that exhausted retries
        const toolError = detectToolError(error);
        if (toolError) {
          const toolCallId = `tc-error-final-${Date.now()}`;
          const isHallucination = toolError.type === 'no_such_tool' || toolError.type === 'tool_not_found';
          console.error(`[AgentRunner] Tool error (retries exhausted): "${toolError.toolName}" (${toolError.type})`);

          try {
            writeLog('tool_error_final', {
              toolName: toolError.toolName,
              type: toolError.type,
              message: toolError.message,
            });
          } catch { }

          // Show the failed tool as an error in the UI
          send(ws, {
            type: 'progress',
            event: 'tool_event',
            data: {
              tool: toolError.toolName,
              status: 'called',
              toolCallId,
              args: {},
              description: `${toolError.toolName} (${isHallucination ? 'not found' : 'failed'})`,
            }
          });
          send(ws, {
            type: 'progress',
            event: 'tool_event',
            data: {
              tool: toolError.toolName,
              status: 'error',
              toolCallId,
              error: isHallucination
                ? `Tool "${toolError.toolName}" does not exist. All retry attempts exhausted.`
                : `Tool "${toolError.toolName}" failed after ${MAX_TOOL_ERROR_RETRIES} attempts: ${toolError.message}`,
            }
          });

          const errorText = fullText
            ? fullText + (isHallucination
              ? `\n\nI apologize, but I attempted to use a tool called "${toolError.toolName}" that doesn't exist. Please try rephrasing your request.`
              : `\n\nThe tool "${toolError.toolName}" encountered an error: ${toolError.message}. Please try a different approach.`)
            : (isHallucination
              ? `I attempted to use a tool called "${toolError.toolName}" that doesn't exist. Please try rephrasing your request, and I'll use only the tools available to me.`
              : `The tool "${toolError.toolName}" failed: ${toolError.message}. Let me try a different approach.`);
          send(ws, { type: 'final', model: chosenModelId || model, result: { text: errorText, response: errorText, modelId: chosenModelId || model } });
          resultText = errorText;
          return;
        }

        const toolCallParseError =
          error &&
          typeof error === 'object' &&
          typeof (error as any).input === 'string' &&
          ((error as any).error instanceof SyntaxError || String((error as any).error || '').includes('SyntaxError'));

        if (toolCallParseError) {
          const errMsg = String((error as any)?.error?.message || 'Invalid JSON in tool call input');
          const inputPreview = String((error as any).input || '').slice(0, 2000);
          const toolCallId = `tc-parse-${Date.now()}`;

          try {
            writeLog('tool_call_parse_error', {
              message: errMsg,
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
                message: errMsg,
                inputPreview,
              }
            });
          } catch { }

          const finalText = `Tool call failed: ${errMsg}. Please retry.`;
          send(ws, { type: 'final', model: chosenModelId || model, result: { text: finalText, response: finalText, modelId: chosenModelId || model } });
          resultText = finalText;
          return;
        }

        // Send what we have if any
        if (fullText) {
          send(ws, { type: 'final', model: chosenModelId || model, result: { text: fullText, response: fullText, modelId: chosenModelId || model } });
          resultText = fullText;
        } else {
          send(ws, { type: 'error', message: error.message || 'Agent execution failed' });
        }
      }
    } finally {
      // Clean up abort controller
      activeControllers.delete(ws);
    }
  }, { userId, conversationId });

  return resultText ? { text: resultText } : null;
}

// Returns the text delta if any, so caller can accumulate
function handleStreamChunk(ws: WebSocket, chunk: any): string {
  try {
    // Debug: log all chunk types to see what's coming through
    if (chunk?.type) {
      const payloadKeys = chunk.payload ? Object.keys(chunk.payload) : [];
      const hasText = chunk.payload?.text || chunk.textDelta;
      if (!['text-delta'].includes(chunk.type) || hasText?.includes('think')) {
        console.log('[AgentRunner] Chunk:', chunk.type, payloadKeys, hasText ? `"${String(hasText).slice(0, 50)}..."` : '');
      }
    }

    // Handle tool_event pass-through from nested tools
    if (chunk?.type === 'tool_event') {
      send(ws, { type: 'progress', event: 'tool_event', data: chunk });
      return '';
    }

    // Legacy AI SDK toolCall shape
    if (chunk?.toolCall?.name) {
      send(ws, {
        type: 'progress',
        event: 'tool_event',
        data: { tool: chunk.toolCall.name, status: 'called', args: chunk.toolCall.args }
      });
      return '';
    }

    // Legacy AI SDK toolResult shape
    if (chunk?.toolResult) {
      send(ws, {
        type: 'progress',
        event: 'tool_event',
        data: {
          tool: chunk.toolResult.toolName,
          status: 'completed',
          toolCallId: chunk.toolResult.toolCallId,
          result: chunk.toolResult.result
        }
      });
      return '';
    }

    // Mastra native event types
    switch (chunk?.type) {
      case 'text-delta': {
        const text = chunk.payload?.text || (typeof chunk.payload === 'string' ? chunk.payload : '');
        if (text) {
          send(ws, { type: 'progress', event: 'delta', data: { text } });
          return text;
        }
        break;
      }

      // Reasoning events (for models that support it like o1, o3, Grok with reasoning)
      case 'reasoning-start': {
        console.log('[AgentRunner] reasoning-start received');
        send(ws, { type: 'progress', event: 'reasoning_start', data: { id: chunk.payload?.id } });
        break;
      }

      case 'reasoning-delta': {
        const reasoning = chunk.payload?.text || (typeof chunk.payload === 'string' ? chunk.payload : '');
        if (reasoning) {
          send(ws, { type: 'progress', event: 'reasoning', data: { text: reasoning } });
        }
        break;
      }

      case 'reasoning-end': {
        console.log('[AgentRunner] reasoning-end received');
        send(ws, { type: 'progress', event: 'reasoning_end', data: { id: chunk.payload?.id } });
        break;
      }

      case 'reasoning-signature': {
        // Some models emit this for reasoning metadata
        console.log('[AgentRunner] reasoning-signature:', chunk.payload?.signature);
        break;
      }

      // Gemini thinking events (different naming from reasoning)
      case 'thinking-start': {
        console.log('[AgentRunner] thinking-start received');
        send(ws, { type: 'progress', event: 'reasoning_start', data: { id: chunk.payload?.id } });
        break;
      }

      case 'thinking-delta': {
        const thinking = chunk.payload?.text || chunk.textDelta || (typeof chunk.payload === 'string' ? chunk.payload : '');
        if (thinking) {
          send(ws, { type: 'progress', event: 'reasoning', data: { text: thinking } });
        }
        break;
      }

      case 'thinking-end': {
        console.log('[AgentRunner] thinking-end received');
        send(ws, { type: 'progress', event: 'reasoning_end', data: { id: chunk.payload?.id } });
        break;
      }

      case 'tool-call':
        send(ws, {
          type: 'progress',
          event: 'tool_event',
          data: {
            tool: chunk.payload?.toolName,
            status: 'called',
            toolCallId: chunk.payload?.toolCallId,
            args: chunk.payload?.args
          }
        });
        break;

      case 'tool-result':
        send(ws, {
          type: 'progress',
          event: 'tool_event',
          data: {
            tool: chunk.payload?.toolName,
            status: 'completed',
            toolCallId: chunk.payload?.toolCallId,
            result: chunk.payload?.result
          }
        });
        break;

      case 'step-start':
        send(ws, { type: 'progress', event: 'start', data: { stepId: chunk.payload?.stepId } });
        break;

      case 'error': {
        // Handle error chunks from the stream (e.g. tool execution errors)
        const errPayload = chunk.payload || {};
        const errMessage = errPayload.message || errPayload.error || 'Stream error';
        console.error('[AgentRunner] Error chunk received:', errMessage);
        send(ws, {
          type: 'progress',
          event: 'tool_event',
          data: {
            tool: errPayload.toolName || 'stream',
            status: 'error',
            toolCallId: errPayload.toolCallId || `tc-err-${Date.now()}`,
            error: String(errMessage),
          }
        });
        break;
      }

      case 'finish':
        // Don't send final here - we'll send it after the loop
        break;

      default:
        // Handle plain string chunks
        if (typeof chunk === 'string' && chunk) {
          send(ws, { type: 'progress', event: 'delta', data: { text: chunk } });
          return chunk;
        }
        // Handle textDelta property (AI SDK format)
        if (chunk?.textDelta) {
          send(ws, { type: 'progress', event: 'delta', data: { text: chunk.textDelta } });
          return chunk.textDelta;
        }
        break;
    }
  } catch (e) {
    console.error('Error handling chunk:', e);
  }
  return '';
}

