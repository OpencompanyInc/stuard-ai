
import { WebSocket } from 'ws';
import { getAgent as getStuardAgent } from '../../agents/stuard-agent';
import { getWorkflowAgent, WORKFLOW_SYSTEM_PROMPT } from '../../agents/workflow-agent';
import { withClientBridge } from '../../tools/bridge';
import { routeModel, ModelChoice } from '../../router/model-router';
import { writeLog } from '../../utils/logger';
import { normalizeUsage } from '../../utils/usage';

type AgentType = 'stuard' | 'workflow';

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
  try { ws.send(JSON.stringify(data)); } catch {}
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

export async function runAgent(ws: WebSocket, message: AgentMessage): Promise<{ text: string } | null> {
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

  // Notify UI of final model decision (tier + optional concrete provider modelId)
  try {
    send(ws, { type: 'progress', event: 'model', data: { tier: model, modelId: chosenModelId } });
  } catch {}

  await withClientBridge(ws, async () => {
    let fullText = '';
    let usage: any = null;
    
    try {
      // Select agent based on type
      const agent = agentType === 'workflow'
        ? getWorkflowAgent(chosenModelId)
        : getStuardAgent(model as ModelChoice, undefined, integrations, {}, chosenModelId);

      // Build context prefix for paths
      let contextPrefix = '';
      if (context.paths && context.paths.length > 0) {
        const pathsList = context.paths.map(p => 
          `- ${p.isDirectory ? '[DIR]' : '[FILE]'} ${p.path}`
        ).join('\n');
        contextPrefix = `[Context: The user has provided these local file/folder paths for reference]\n${pathsList}\n\n`;
      }

      // Prepare input with context
      const userContent = contextPrefix + message.text;
      const input = (() => {
        if (history.length > 0) {
          const base = [...history, { role: 'user', content: userContent }];
          if (agentType === 'workflow') {
            return [{ role: 'system', content: WORKFLOW_SYSTEM_PROMPT }, ...base];
          }
          return base;
        }
        if (agentType === 'workflow') {
          return [{ role: 'system', content: WORKFLOW_SYSTEM_PROMPT }, { role: 'user', content: userContent }];
        }
        return userContent;
      })();

      // Notify start
      send(ws, { type: 'progress', event: 'start', data: {} });

      // Build stream options
      // Workflow agent needs more steps for tool discovery and testing
      const maxToolSteps = agentType === 'workflow' ? 60 : 40;
      const streamOptions: any = {
        maxSteps: maxToolSteps,
        abortSignal: abortController.signal,
      };

      // Enable thinking/reasoning streams for supported providers.
      const reasoningLevel: 'none' | 'low' | 'medium' | 'high' =
        (['none', 'low', 'medium', 'high'].includes(message.reasoningLevel || '') ? message.reasoningLevel : 'high') as any;

      // ---------- Google Gemini thinking ----------
      if (chosenModelId?.includes('google/gemini-3') || chosenModelId?.includes('google/gemini-2.5')) {
        streamOptions.providerOptions = {
          ...(streamOptions.providerOptions || {}),
          google: {
            thinkingConfig: {
              thinkingLevel: reasoningLevel,
              includeThoughts: reasoningLevel !== 'none',
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
        const supportsEffort = /^(o[1-9]|gpt-5-pro|gpt-5\.1)/.test(modelPart);
        if (supportsEffort && reasoningLevel !== 'none') {
          streamOptions.providerOptions = {
            ...(streamOptions.providerOptions || {}),
            openai: {
              reasoningEffort: reasoningLevel,
            },
          };
        }
      }

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
        // Mastra might return { text, toolCalls, usage, steps }
        console.log('[AgentRunner] Stream not iterable, using aggregated result');
        if (streamResult?.text) {
          fullText = streamResult.text;
          // Send all at once as a delta
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

      // Check for reasoning/thinking in final result (Gemini returns this with includeThoughts)
      if (streamResult?.reasoning) {
        console.log('[AgentRunner] Final reasoning found:', String(streamResult.reasoning).slice(0, 100));
        send(ws, { type: 'progress', event: 'reasoning', data: { text: streamResult.reasoning } });
      }
      if (streamResult?.thinking) {
        console.log('[AgentRunner] Final thinking found:', String(streamResult.thinking).slice(0, 100));
        send(ws, { type: 'progress', event: 'reasoning', data: { text: streamResult.thinking } });
      }

      // Send final message
      send(ws, {
        type: 'final',
        result: { text: fullText, response: fullText, usage },
        usage
      });

      resultText = fullText;

    } catch (error: any) {
      // Handle abort specifically
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        console.log('[AgentRunner] Stream aborted by user');
        send(ws, { 
          type: 'final', 
          result: { text: fullText || '(Stopped)', response: fullText || '(Stopped)' },
          aborted: true 
        });
        resultText = fullText || '(Stopped)';
      } else {
        console.error('[AgentRunner] Error:', error);

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
          } catch {}

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
          } catch {}

          const finalText = `Tool call failed: ${errMsg}. Please retry.`;
          send(ws, { type: 'final', result: { text: finalText, response: finalText } });
          resultText = finalText;
          return;
        }

        // Send what we have if any
        if (fullText) {
          send(ws, { type: 'final', result: { text: fullText, response: fullText } });
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

