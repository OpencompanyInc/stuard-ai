import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getHeadlessAgent } from '../agents/headless-agent';
import { getExternalAccount } from '../supabase';
import { getBridgeSecrets, getBridgeWs, withClientBridge, execLocalTool } from './bridge';
import { writeLog } from '../utils/logger';
import { randomUUID } from 'crypto';
import { createInterjectionUserMessage } from '../server/chat/interjections';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../shared/integration-flags';

const MAX_LOG_ENTRIES = 200;
const LOG_FLUSH_MS = 750;
const MAX_STRING = 1200;

function getBrowserUseSessionId(taskId: string): string {
  return `subagent-${taskId}`;
}

type RunningHeadlessTask = {
  controller: AbortController;
  requestId?: string;
  chatWs?: any;
  bridgeWs?: any;
};

// Store abort controllers for running headless tasks
const runningTasks = new Map<string, RunningHeadlessTask>();

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

export function abortHeadlessTask(taskId: string, reason = 'external_abort'): boolean {
  const running = runningTasks.get(taskId);
  if (running) {
    console.log(`[HeadlessAgent] Aborting task: ${taskId} | reason=${reason}`);
    abortWithReason(running.controller, reason);
    runningTasks.delete(taskId);
    return true;
  }
  return false;
}

export function abortHeadlessTasksForRequest(chatWs?: any, requestId?: string, reason = 'request_abort'): number {
  let count = 0;
  for (const [taskId, running] of Array.from(runningTasks.entries())) {
    const sameRequest = requestId ? running.requestId === requestId : true;
    const sameSocket = !chatWs || running.chatWs === chatWs || running.bridgeWs === chatWs;
    if (!sameRequest || !sameSocket) continue;
    console.log(`[HeadlessAgent] Aborting task for request: ${taskId} | reason=${reason}`);
    abortWithReason(running.controller, reason);
    runningTasks.delete(taskId);
    count++;
  }
  return count;
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
      obj[k] = sanitizeForLog(v, depth + 1);
    }
    return obj;
  }
  return String(value);
}

// ─── Schema for a single sub-agent task ───────────────────────────────────────

const SubAgentTaskSchema = z.object({
  objective: z.string().describe('The goal or objective for this sub-agent'),
  mode: z.enum(['generic', 'specialized']).optional().default('generic').describe('generic = normal agent. specialized = restricted tools + custom system prompt.'),
  tools_allowed: z.array(z.string()).optional().describe('Optional list of tools the sub-agent can use. Omit for default core tools.'),
  custom_system_prompt: z.string().optional().describe('Optional custom system instructions for this sub-agent'),
});

// ─── The tool ─────────────────────────────────────────────────────────────────

export const deployHeadlessAgent = createTool({
  id: 'deploy_headless_agent',
  description: `Deploy one or more autonomous sub-agents in parallel.

Pass a single task or an array of tasks — all tasks run concurrently.

execution_mode controls how the tool returns:
- "wait" (default): Blocks until ALL sub-agents finish and returns every result. Use this when you need the results before continuing.
- "background": Returns immediately with all taskIds. Use get_headless_agent_status to check on them later.

Examples:
  Single task (wait):   { "tasks": [{ "objective": "summarize X" }] }
  Parallel (wait):      { "tasks": [{ "objective": "research A" }, { "objective": "research B" }] }
  Parallel (background): { "tasks": [...], "execution_mode": "background" }`,
  inputSchema: z.object({
    tasks: z.array(SubAgentTaskSchema).min(1).describe('Array of sub-agent tasks to deploy in parallel'),
    execution_mode: z.enum(['wait', 'background']).default('wait').describe('wait = block until all done. background = return taskIds immediately.'),
    model: z.enum(['fast', 'balanced', 'smart']).default('fast').describe('Model tier for all sub-agents'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    results: z.array(z.object({
      taskId: z.string(),
      ok: z.boolean(),
      status: z.string(),
      objective: z.string().optional(),
      result: z.any().optional(),
      error: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { tasks, execution_mode, model } = inputData as any;
    const secrets = getBridgeSecrets();
    const bridgeWs = getBridgeWs();
    const userId = secrets?.userId;
    const conversationId = secrets?.conversationId;
    const isWaitMode = execution_mode === 'wait' || !execution_mode;

    if (!userId) {
      return { ok: false, error: 'User not authenticated' };
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { ok: false, error: 'tasks array is required and must not be empty' };
    }

    try {
      // Launch all tasks in parallel
      const launches = await Promise.all(
        tasks.map((task: any) => launchOneTask(task, userId, conversationId, model, secrets, bridgeWs))
      );

      // Background mode → return taskIds immediately
      if (!isWaitMode) {
        return {
          ok: true,
          results: launches.map((l) => ({
            taskId: l.taskId,
            ok: true,
            status: 'running',
            objective: l.objective,
          })),
        };
      }

      // Wait mode → await all completion promises
      const settled = await Promise.allSettled(launches.map((l) => l.completionPromise));

      const results = settled.map((outcome, i) => {
        const { taskId, objective } = launches[i];
        if (outcome.status === 'fulfilled') {
          const r = outcome.value;
          return {
            taskId,
            ok: r.status === 'completed',
            status: r.status,
            objective,
            result: { text: r.text, finishReason: r.finishReason },
            error: r.error,
          };
        }
        return {
          taskId,
          ok: false,
          status: 'failed',
          objective,
          error: outcome.reason?.message || 'unknown error',
        };
      });

      const allOk = results.every((r) => r.ok);
      return { ok: allOk, results };

    } catch (error: any) {
      writeLog('deploy_subagent_error', { error: error.message });
      return { ok: false, error: error.message || 'Failed to deploy sub-agents' };
    }
  },
});

// ─── Per-task launch helper ───────────────────────────────────────────────────

interface SubagentResult {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  text?: string;
  finishReason?: string;
  error?: string;
}

interface LaunchedTask {
  taskId: string;
  objective: string;
  completionPromise: Promise<SubagentResult>;
}

async function launchOneTask(
  task: any,
  userId: string,
  conversationId: string | undefined,
  model: string,
  secrets: any,
  bridgeWs: any
): Promise<LaunchedTask> {
  const objective = String(task.objective || '');
  const taskMode = task.mode === 'specialized' ? 'specialized' : 'generic';
  const toolsAllowed = Array.isArray(task.tools_allowed) && task.tools_allowed.length > 0
    ? task.tools_allowed.map((t: any) => String(t || '').trim()).filter(Boolean)
    : undefined;
  const customSystemPrompt = task.custom_system_prompt;

  if (taskMode === 'specialized') {
    const hasAllowed = Array.isArray(toolsAllowed) && toolsAllowed.length > 0;
    const hasPrompt = typeof customSystemPrompt === 'string' && customSystemPrompt.trim().length > 0;
    if (!hasAllowed && !hasPrompt) {
      const fakeId = randomUUID();
      return {
        taskId: fakeId,
        objective,
        completionPromise: Promise.resolve({
          taskId: fakeId,
          status: 'failed' as const,
          error: 'specialized mode requires tools_allowed and/or custom_system_prompt',
        }),
      };
    }
  }

  // Register sub-agent locally
  const spawnResult = await execLocalTool('subagent_spawn', {
    objective,
    parent_id: conversationId,
    model,
    tools_allowed: toolsAllowed,
    custom_system_prompt: customSystemPrompt,
  });

  if (!spawnResult?.ok) {
    const fakeId = randomUUID();
    return {
      taskId: fakeId,
      objective,
      completionPromise: Promise.resolve({
        taskId: fakeId,
        status: 'failed' as const,
        error: spawnResult?.error || 'Failed to spawn sub-agent locally',
      }),
    };
  }

  const localTaskId = spawnResult.task_id || randomUUID();
  const subagentSecrets = {
    ...(secrets || {}),
    subagentTaskId: localTaskId,
    browserUseSessionId: getBrowserUseSessionId(localTaskId),
  };

  // Create a completion promise
  let resolveCompletion!: (result: SubagentResult) => void;
  const completionPromise = new Promise<SubagentResult>((resolve) => {
    resolveCompletion = resolve;
  });

  // Start the agent execution
  const run = () =>
    runHeadlessTask(localTaskId, userId, objective, toolsAllowed, customSystemPrompt, model, taskMode, subagentSecrets, bridgeWs)
      .then(() => {
        // Fetch the final result from local registry
        return execLocalTool('subagent_status', { task_id: localTaskId })
          .then((statusResult) => {
            const t = statusResult?.task;
            resolveCompletion({
              taskId: localTaskId,
              status: t?.status || 'completed',
              text: t?.result?.text,
              finishReason: t?.result?.finishReason,
              error: t?.result?.error,
            });
          })
          .catch(() => {
            resolveCompletion({ taskId: localTaskId, status: 'completed', text: '' });
          });
      })
      .catch((err) => {
        writeLog('subagent_background_error', { taskId: localTaskId, error: err?.message || String(err) });
        execLocalTool('subagent_update', {
          task_id: localTaskId,
          status: 'failed',
          result: { error: err?.message },
        }).catch(() => {});
        resolveCompletion({
          taskId: localTaskId,
          status: 'failed',
          error: err?.message || String(err),
        });
      });

  // Preserve client bridge context for local tool access
  if (bridgeWs && bridgeWs.readyState === (bridgeWs as any).OPEN) {
    withClientBridge(bridgeWs as any, run, subagentSecrets);
  } else {
    run();
  }

  return { taskId: localTaskId, objective, completionPromise };
}

// ─── Sub-agent execution logic ────────────────────────────────────────────────

async function runHeadlessTask(
  taskId: string,
  userId: string,
  objective: string,
  toolsAllowed?: string[],
  customSystemPrompt?: string,
  model: any = 'fast',
  mode: 'generic' | 'specialized' = 'generic',
  bridgeSecrets?: Record<string, any>,
  bridgeWs?: any,
) {
  const abortController = new AbortController();
  const parentAbortSignal = bridgeSecrets?.__abortSignal as AbortSignal | undefined;
  const requestId = typeof bridgeSecrets?.__requestId === 'string' ? bridgeSecrets.__requestId : undefined;
  const chatWs = (bridgeSecrets as any)?.__chatWs;
  runningTasks.set(taskId, {
    controller: abortController,
    requestId,
    chatWs,
    bridgeWs,
  });
  let parentAbortHandler: (() => void) | undefined;
  if (parentAbortSignal) {
    if (parentAbortSignal.aborted) {
      abortWithReason(abortController, getAbortReason(parentAbortSignal) || 'parent_abort');
    } else {
      parentAbortHandler = () => abortWithReason(abortController, getAbortReason(parentAbortSignal) || 'parent_abort');
      parentAbortSignal.addEventListener('abort', parentAbortHandler, { once: true });
    }
  }

  let aggregatedText = '';
  let lastReasoningFlush = 0;
  const REASONING_FLUSH_MS = 1500;

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
          await execLocalTool('subagent_update', { task_id: taskId, log: logEntry }).catch(() => {});
        })
        .catch(() => {});
      await flushChain;
    };

    // 1. Prepare integrations and MCP tools
    const providers = ['github', 'google', ...(OUTLOOK_INTEGRATION_ENABLED ? ['outlook'] : []), ...(META_INTEGRATION_ENABLED ? ['facebook', 'instagram', 'threads'] : []), ...(WHATSAPP_INTEGRATION_ENABLED ? ['whatsapp'] : []), 'x'];
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
    // Deployed custom-integration tools — available to headless agents whose
    // allowed-tools list includes the compiled `${slug}_${tool}` names.
    try {
      const { compileInstalledToTools } = await import('../integrations/compile-tools');
      const compiled = await compileInstalledToTools(userId);
      if (Object.keys(compiled.tools).length > 0) mcpTools = { ...mcpTools, ...compiled.tools };
    } catch {}

    // 2. Initialize the headless agent
    const allowedForAgent = mode === 'specialized'
      ? (Array.isArray(toolsAllowed) && toolsAllowed.length > 0 ? toolsAllowed : ['wait', 'run_sequential', 'run_parallel'])
      : toolsAllowed;

    const bridgeWsNow = getBridgeWs();
    const hasDesktopBridge = bridgeWsNow && bridgeWsNow.readyState === (bridgeWsNow as any).OPEN;

    const agent = getHeadlessAgent(
      model,
      enabledIntegrations,
      mcpTools,
      allowedForAgent,
      customSystemPrompt,
    );

    // Prepare provider options
    const providerOptions: any = {};
    const { getDefaultModelForCategory } = await import('../pricing');
    const concreteModelId = getDefaultModelForCategory(model);
    if (concreteModelId?.includes('google/gemini-3')) {
      providerOptions.google = {
        thinkingConfig: { includeThoughts: true },
      };
    }

    // 3. Run the agent and stream results.
    //
    // prepareStep drains user-queued steering messages between steps. The desktop
    // UI POSTs to /v1/subagents/{id}/steer which enqueues into the local Python
    // registry; we drain them here so a nudge lands as a user message *before*
    // the next LLM call. This is the safe injection point — never mid-tool-call.
    const stream: any = await agent.stream([{ role: 'user', content: objective }], {
      providerOptions,
      abortSignal: abortController.signal,
      prepareStep: async ({ messages: stepMessages }: any) => {
        try {
          const res: any = await execLocalTool('subagent_consume_steers', { task_id: taskId });
          const steers: any[] = Array.isArray(res?.steers) ? res.steers : [];
          if (steers.length === 0) return {};

          const base = Array.isArray(stepMessages) ? stepMessages : [];
          const content =
            '[User steering — applied mid-task]\n' +
            steers
              .map((s: any, i: number) => `Steer ${i + 1}: ${String(s.message || '').trim()}`)
              .join('\n') +
            '\n\nUse this guidance in the next step before continuing.';

          // Surface each steer in the activity log so the UI shows it took effect.
          await Promise.all(
            steers.map((s: any) =>
              execLocalTool('subagent_update', {
                task_id: taskId,
                log: {
                  type: 'user_steer_injected',
                  steer_id: s.id,
                  message: s.message,
                  timestamp: Date.now(),
                },
              }).catch(() => {}),
            ),
          );

          return { messages: [...base, createInterjectionUserMessage(content)] };
        } catch {
          return {};
        }
      },
      onFinish: async ({ text, finishReason }) => {
        finished = true;
        runningTasks.delete(taskId);
        const finalText = String(text || '').trim() || String(aggregatedText || '').trim();
        if (abortController.signal.aborted) {
          const abortReason = getAbortReason(abortController.signal) || 'unknown';
          await execLocalTool('subagent_update', {
            task_id: taskId,
            status: 'cancelled',
            result: { text: finalText, finishReason: 'aborted', stoppedBy: abortReason }
          }).catch(() => {});
          return;
        }
        await execLocalTool('subagent_update', {
          task_id: taskId,
          status: 'completed',
          result: { text: finalText, finishReason }
        }).catch(() => {});
      }
    });

    const fullStream = (stream as any)?.fullStream || stream;

    for await (const chunk of fullStream as any) {
      if (abortController.signal.aborted) {
        const abortError = new Error('Headless agent aborted');
        (abortError as any).name = 'AbortError';
        throw abortError;
      }
      const evType = (chunk as any)?.type;

      if (evType === 'tool-call') {
        const payload = (chunk as any).payload;
        await flushLogs({
          type: 'tool_call',
          tool: payload.toolName,
          args: sanitizeForLog(payload.args),
          timestamp: Date.now(),
        });
      } else if (evType === 'tool-result') {
        const payload = (chunk as any).payload;
        await flushLogs({
          type: 'tool_result',
          tool: payload.toolName,
          result: sanitizeForLog(payload.result),
          timestamp: Date.now(),
        });
      } else if (evType === 'tool_event') {
        await flushLogs(sanitizeForLog({ type: 'tool_event', ...(chunk as any), timestamp: Date.now() }));
      } else if (evType === 'text-delta') {
        const t = (chunk as any)?.payload?.text || (chunk as any)?.text || '';
        if (typeof t === 'string' && t) {
          aggregatedText += t;
          const now = Date.now();
          if (now - lastReasoningFlush >= REASONING_FLUSH_MS) {
            lastReasoningFlush = now;
            await flushLogs({
              type: 'reasoning',
              text: aggregatedText.slice(-800),
              total_length: aggregatedText.length,
              timestamp: now,
            }, true);
          }
        }
      }
    }

    if (abortController.signal.aborted) {
      const abortError = new Error('Headless agent aborted');
      (abortError as any).name = 'AbortError';
      throw abortError;
    }

    // Final reasoning flush
    if (aggregatedText.trim()) {
      await flushLogs({
        type: 'reasoning_complete',
        text: aggregatedText.trim(),
        total_length: aggregatedText.length,
        timestamp: Date.now(),
      }, true);
    }

    // Safety net: if onFinish didn't fire, mark as completed
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
    runningTasks.delete(taskId);

    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      const abortReason = getAbortReason(abortController.signal) || 'unknown';
      console.log(`[HeadlessAgent] Task ${taskId} aborted | reason=${abortReason}`);
      const partialText = aggregatedText ? aggregatedText.trim() : '';
      await execLocalTool('subagent_update', {
        task_id: taskId,
        status: 'cancelled',
        result: { text: partialText, finishReason: 'aborted', stoppedBy: abortReason }
      }).catch(() => {});
      return;
    }

    writeLog('subagent_task_error', { taskId, error: error.message });
    await execLocalTool('subagent_update', {
      task_id: taskId,
      status: 'failed',
      result: { error: error.message }
    }).catch(() => {});
  } finally {
    const sessionId = typeof bridgeSecrets?.browserUseSessionId === 'string'
      ? bridgeSecrets.browserUseSessionId
      : '';
    if (sessionId) {
      await execLocalTool('browser_use_tabs', {
        action: 'release',
        session_id: sessionId,
      }).catch(() => {});
    }
    if (parentAbortSignal && parentAbortHandler) {
      try { parentAbortSignal.removeEventListener('abort', parentAbortHandler); } catch {}
    }
  }
}
