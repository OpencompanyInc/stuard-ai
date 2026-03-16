import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getHeadlessAgent } from '../agents/headless-agent';
import { getExternalAccount } from '../supabase';
import { getBridgeSecrets, getBridgeWs, withClientBridge, execLocalTool } from './bridge';
import { writeLog } from '../utils/logger';
import { randomUUID } from 'crypto';

const MAX_LOG_ENTRIES = 200;
const LOG_FLUSH_MS = 750;
const MAX_STRING = 1200;

function getBrowserUseSessionId(taskId: string): string {
  return `subagent-${taskId}`;
}

// Store abort controllers for running headless tasks
const runningTasks = new Map<string, AbortController>();

export function abortHeadlessTask(taskId: string): boolean {
  const controller = runningTasks.get(taskId);
  if (controller) {
    console.log(`[HeadlessAgent] Aborting task: ${taskId}`);
    controller.abort();
    runningTasks.delete(taskId);
    return true;
  }
  return false;
}

export function getRunningTaskIds(): string[] {
  return Array.from(runningTasks.keys());
}

function sanitizeForLog(value: any, depth = 0): any {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    if (s.length <= MAX_STRING) return s;
    return { preview: s.slice(0, 300), tail: s.slice(-200), length: s.length };
  }
  if (t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    if (value.length > 50) {
      return { items: value.slice(0, 20).map((v) => sanitizeForLog(v, depth + 1)), length: value.length };
    }
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }
  if (t === 'object') {
    const obj: any = {};
    for (const [k, v] of Object.entries(value)) {
      // common large fields
      if (k === 'data' || k === 'content' || k === 'stdout' || k === 'stderr' || k === 'text') {
        obj[k] = sanitizeForLog(v, depth + 1);
      } else {
        obj[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return obj;
  }
  return String(value);
}

export const deployHeadlessAgent = createTool({
  id: 'deploy_headless_agent',
  description: 'Deploys an autonomous sub-agent to run a task in the background locally. Returns a taskId to track progress. Multiple sub-agents can run in parallel.',
  inputSchema: z.object({
    objective: z.string().describe('The goal or objective for the sub-agent'),
    mode: z.enum(['generic', 'specialized']).optional().default('generic').describe('Sub-agent mode. generic = normal headless agent. specialized = restricted tools + custom system prompt.'),
    tools_allowed: z.array(z.string()).optional().describe('Optional list of specific tools the sub-agent is allowed to use. If omitted, it uses the default core tools.'),
    // Backwards compatibility (deprecated)
    tool: z.string().optional().describe('DEPRECATED: single tool name. Prefer tools_allowed.'),
    custom_system_prompt: z.string().optional().describe('Optional custom system instructions for the sub-agent'),
    model: z.enum(['fast', 'balanced', 'smart']).default('fast').describe('Model tier to use'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    taskId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { objective, mode, tools_allowed, tool, custom_system_prompt, model  } = inputData as any;
    const secrets = getBridgeSecrets();
    const bridgeWs = getBridgeWs();
    const userId = secrets?.userId;
    const conversationId = secrets?.conversationId;

    if (!userId) {
      return { ok: false, error: 'User not authenticated' };
    }

    const taskId = randomUUID();

    try {
      const normalizedToolsAllowed =
        Array.isArray(tools_allowed) && tools_allowed.length > 0
          ? tools_allowed.map((t: any) => String(t || '').trim()).filter(Boolean)
          : (typeof tool === 'string' && tool.trim() ? [tool.trim()] : undefined);

      const normalizedMode = (mode === 'specialized' || mode === 'generic') ? mode : 'generic';
      if (normalizedMode === 'specialized') {
        const hasAllowed = Array.isArray(normalizedToolsAllowed) && normalizedToolsAllowed.length > 0;
        const hasPrompt = typeof custom_system_prompt === 'string' && custom_system_prompt.trim().length > 0;
        if (!hasAllowed && !hasPrompt) {
          return {
            ok: false,
            error: 'specialized mode requires tools_allowed and/or custom_system_prompt',
          };
        }
      }

      // 1. Register sub-agent locally (not in Supabase)
      const spawnResult = await execLocalTool('subagent_spawn', {
        objective,
        parent_id: conversationId,
        model,
        tools_allowed: normalizedToolsAllowed,
        custom_system_prompt,
      });

      if (!spawnResult?.ok) {
        throw new Error(spawnResult?.error || 'Failed to spawn sub-agent locally');
      }

      const localTaskId = spawnResult.task_id || taskId;
      const subagentSecrets = {
        ...(secrets || {}),
        subagentTaskId: localTaskId,
        browserUseSessionId: getBrowserUseSessionId(localTaskId),
      };

      // 2. Start the agent execution in the background (fire and forget)
      // We don't await this so the tool returns immediately
      const run = () =>
        runHeadlessTask(localTaskId, userId, objective, normalizedToolsAllowed, custom_system_prompt, model, normalizedMode).catch((err) => {
          writeLog('subagent_background_error', { taskId: localTaskId, error: err?.message || String(err) });
          // Update local status to failed
          execLocalTool('subagent_update', { task_id: localTaskId, status: 'failed', result: { error: err?.message } }).catch(() => {});
        });

      // CRITICAL: Preserve the active client bridge context so the sub-agent can
      // use local tools (list_directory, read_file, etc.) via in-band WS tool execution.
      if (bridgeWs && bridgeWs.readyState === (bridgeWs as any).OPEN) {
        withClientBridge(bridgeWs as any, run, subagentSecrets);
      } else {
        run();
      }

      return {
        ok: true,
        taskId: localTaskId,
      };

    } catch (error: any) {
      writeLog('deploy_subagent_error', { error: error.message });
      return {
        ok: false,
        error: error.message || 'Failed to deploy sub-agent',
      };
    }
  },
});

/**
 * Sub-agent execution logic - runs locally, updates local storage
 */
async function runHeadlessTask(
  taskId: string,
  userId: string,
  objective: string,
  toolsAllowed?: string[],
  customSystemPrompt?: string,
  model: any = 'fast',
  mode: 'generic' | 'specialized' = 'generic'
) {
  // Create abort controller for this task
  const abortController = new AbortController();
  runningTasks.set(taskId, abortController);

  // Move aggregatedText outside try block so it can be accessed in catch for abort handling
  let aggregatedText = '';
  let lastReasoningFlush = 0;
  const REASONING_FLUSH_MS = 1500; // Flush accumulated reasoning text every 1.5s

  try {
    let finished = false;
    let lastFlush = 0;
    let flushChain: Promise<void> = Promise.resolve();

    const flushLogs = async (logEntry: any, force = false) => {
      const now = Date.now();
      if (!force && now - lastFlush < LOG_FLUSH_MS) return;
      lastFlush = now;
      flushChain = flushChain
        .then(async () => {
          // Update local sub-agent with log entry
          await execLocalTool('subagent_update', { task_id: taskId, log: logEntry }).catch(() => {});
        })
        .catch(() => {});
      await flushChain;
    };

    // 1. Prepare integrations and MCP tools
    const providers = ['github', 'google', 'outlook', 'facebook', 'instagram', 'threads', 'whatsapp'];
    const checks = await Promise.all(providers.map(p => getExternalAccount(userId, p)));
    const enabledIntegrations = providers.filter((_, i) => !!checks[i]);
    
    let mcpTools: Record<string, any> = {};
    try {
      const { getConnectedMCPIntegrations, getMCPToolsForIntegrations } = await import('../mcp');
      const connected = await getConnectedMCPIntegrations(userId);
      if (connected.length > 0) {
        mcpTools = await getMCPToolsForIntegrations(userId, connected);
      }
    } catch (e) {
      // ignore
    }

    // 2. Initialize the headless agent
    const allowedForAgent = mode === 'specialized'
      ? (Array.isArray(toolsAllowed) && toolsAllowed.length > 0 ? toolsAllowed : ['wait', 'run_sequential', 'run_parallel'])
      : toolsAllowed;

    // Detect if running without a desktop bridge (e.g. VM-only context)
    const bridgeWsNow = getBridgeWs();
    const hasDesktopBridge = bridgeWsNow && bridgeWsNow.readyState === (bridgeWsNow as any).OPEN;

    const agent = getHeadlessAgent({
      model,
      enabledIntegrations,
      mcpTools,
      allowedTools: allowedForAgent,
      customSystemPrompt,
      vmMode: !hasDesktopBridge,
    });

    // Prepare provider options
    const providerOptions: any = {};
    // Enable thinking for Google Gemini 3 models to support tool calling with thought signatures.
    // Gemini 3 models require thought parts to be preserved and passed back with function responses.
    const { getDefaultModelForCategory } = await import('../pricing');
    const concreteModelId = getDefaultModelForCategory(model);
    if (concreteModelId?.includes('google/gemini-3')) {
      providerOptions.google = {
        thinkingConfig: {
          includeThoughts: true,
        },
      };
    }

    // 3. Run the agent and stream results to update logs locally
    const stream: any = await agent.stream([{ role: 'user', content: objective }], {
        providerOptions,
        abortSignal: abortController.signal,
        onFinish: async ({ text, finishReason }) => {
            finished = true;
            runningTasks.delete(taskId); // Clean up on finish
            const finalText = String(text || '').trim() || String(aggregatedText || '').trim();
            // Update local sub-agent status to completed
            await execLocalTool('subagent_update', {
              task_id: taskId,
              status: 'completed',
              result: { text: finalText, finishReason }
            }).catch(() => {});
        }
    });

    const fullStream = (stream as any)?.fullStream || stream;

    for await (const chunk of fullStream as any) {
      const evType = (chunk as any)?.type;
      
      if (evType === 'tool-call') {
        const payload = (chunk as any).payload;
        const logEntry = {
          type: 'tool_call',
          tool: payload.toolName,
          args: sanitizeForLog(payload.args),
          timestamp: Date.now(),
        };
        await flushLogs(logEntry);
      } else if (evType === 'tool-result') {
        const payload = (chunk as any).payload;
        const logEntry = {
          type: 'tool_result',
          tool: payload.toolName,
          result: sanitizeForLog(payload.result),
          timestamp: Date.now(),
        };
        await flushLogs(logEntry);
      } else if (evType === 'tool_event') {
        // execLocalTool emits tool_event chunks that are very useful for live status
        const logEntry = sanitizeForLog({ type: 'tool_event', ...(chunk as any), timestamp: Date.now() });
        await flushLogs(logEntry);
      } else if (evType === 'text-delta') {
        const t = (chunk as any)?.payload?.text || (chunk as any)?.text || '';
        if (typeof t === 'string' && t) {
          aggregatedText += t;
          // Periodically flush reasoning text so the UI can show chain-of-thought live
          const now = Date.now();
          if (now - lastReasoningFlush >= REASONING_FLUSH_MS) {
            lastReasoningFlush = now;
            const reasoningSnapshot = aggregatedText.slice(-800); // last 800 chars
            await flushLogs({
              type: 'reasoning',
              text: reasoningSnapshot,
              total_length: aggregatedText.length,
              timestamp: now,
            }, true);
          }
        }
      }
    }

    // Final reasoning flush — send the complete text as a log entry
    if (aggregatedText.trim()) {
      await flushLogs({
        type: 'reasoning_complete',
        text: aggregatedText.trim(),
        total_length: aggregatedText.length,
        timestamp: Date.now(),
      }, true);
    }

    // If for some reason onFinish didn't fire, mark as completed with what we have
    if (!finished) {
      runningTasks.delete(taskId);
      const finalText = String(aggregatedText || '').trim();
      await execLocalTool('subagent_update', {
        task_id: taskId,
        status: 'completed',
        result: { text: finalText, finishReason: 'stream_ended' }
      }).catch(() => {});
    }

  } catch (error: any) {
    // Clean up abort controller
    runningTasks.delete(taskId);

    // Handle abort specifically
    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      console.log(`[HeadlessAgent] Task ${taskId} was stopped by user`);
      const partialText = aggregatedText ? aggregatedText.trim() : '';
      await execLocalTool('subagent_update', {
        task_id: taskId,
        status: 'cancelled',
        result: { text: partialText, finishReason: 'aborted', stoppedBy: 'user' }
      }).catch(() => {});
      return;
    }

    writeLog('subagent_task_error', { taskId, error: error.message });
    await execLocalTool('subagent_update', {
      task_id: taskId,
      status: 'failed',
      result: { error: error.message }
    }).catch(() => {});
  }
}

