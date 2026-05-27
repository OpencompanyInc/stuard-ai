/**
 * Proactive Agent Endpoint
 *
 * POST /v1/proactive/wakeup
 *
 * Receives tasks + config from the desktop scheduler, creates an in-memory
 * kanban + Mastra agent with proactive system prompt, runs synchronously
 * via agent.generate(), and returns { text, taskUpdates, newTasks, deletedTaskIds }.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { requireAuth } from '../auth/http';
import { PROACTIVE_SYSTEM_PROMPT } from '../agents/stuard/prompts';
import { getModel } from '../agents/stuard/models';
import { search_tools, get_tool_schema, execute_tool, initToolRegistry } from '../tools/meta-tools';
import { buildAvailableSkillsPromptSection, get_skill_info, getSkillsFromContext } from '../tools/skill-tools';
import { runWithSecrets } from '../tools/bridge';
import type { ModelChoice } from '../router/model-router';
import { getDefaultModelForCategory } from '../pricing';
import { buildProactiveMessageContent, expandProactiveAllowedToolNames, generateWithToolRecovery, isProactiveToolAllowed } from './proactive-utils';
import { verifyVMAuthFromRequest } from '../services/vm-tokens';
import { telnyx_send_sms, telnyx_voice_call } from '../tools/telnyx-tools';
import { whatsapp_send_message } from '../tools/whatsapp-tools';
import { WHATSAPP_INTEGRATION_ENABLED } from '../../../../shared/integration-flags';
import { stripMarkdownForSms } from './sms-utils';
import { getBridgeSecrets } from '../tools/bridge';
import { normalizeUsage } from '../utils/usage';
import { search_past_conversations, get_conversation_context } from '../tools/device-tools';
import {
  agent_memory_list,
  agent_memory_create,
  agent_memory_update,
  agent_memory_delete,
  agent_memory_log,
  bot_memory_list,
  bot_memory_create,
  bot_memory_update,
  bot_memory_delete,
  bot_memory_log,
} from '../tools/bot-memory-tools';
import { upsertSmsUserState } from '../supabase';
import { buildKnowledgeContext } from '../knowledge/retrieval';
import { getOrCreateQueryEmbedding } from '../utils/shared-embedding';
import * as memoryService from '../memory/conversations';
import { withClientBridge } from '../tools/bridge';
import { getDesktopWs } from '../services/vm-bridge';
import { sendVMCommand } from '../services/vm-command';
import { getToolRegistry } from '../tools/tool-registry';
import { browser_use_configure } from '../tools/device-tools';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => {
      try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch { }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res: ServerResponse, status: number, obj: any) {
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Vary': 'Origin',
    });
    res.end(body);
  } catch {
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"internal"}'); } catch { }
  }
}

function pickDefaultModelId(modelConfig: any, tier: ModelChoice): string | undefined {
  try {
    const cfg = modelConfig && typeof modelConfig === 'object' ? modelConfig : null;
    const entry = cfg && (cfg as any)[tier];
    const fallback = entry && typeof entry.default === 'string' ? String(entry.default).trim() : '';
    return fallback || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reshape the VM bot scheduler's wakeup payload into the proactive runner's
 * shape. The VM nests bot config under `config`, has no kanban tasks, and
 * always wants notifications delivered.
 */
function normalizeBotWakeupBody(raw: any): Record<string, any> {
  const cfg = (raw && typeof raw.config === 'object' && raw.config) || {};
  const channels = Array.isArray(cfg.notificationChannels)
    ? cfg.notificationChannels
    : (Array.isArray(raw?.notificationChannels) ? raw.notificationChannels : ['app']);
  return {
    botId: typeof raw?.botId === 'string' ? raw.botId : undefined,
    botName: typeof raw?.botName === 'string' ? raw.botName : undefined,
    tasks: [],
    instructions: typeof cfg.instructions === 'string' ? cfg.instructions : (raw?.instructions || ''),
    kanbanContext: typeof raw?.kanbanContext === 'string' ? raw.kanbanContext : undefined,
    prompt: '',
    allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools : (Array.isArray(raw?.allowedTools) ? raw.allowedTools : []),
    modelMode: typeof cfg.modelMode === 'string' ? cfg.modelMode : (raw?.modelMode || 'balanced'),
    modelId: cfg.modelId || raw?.modelId,
    modelConfig: (cfg.modelConfig && typeof cfg.modelConfig === 'object') ? cfg.modelConfig : raw?.modelConfig,
    context: {
      ...((raw && typeof raw.context === 'object' && raw.context) || {}),
      ...((raw?.triggerPayload || raw?.context?.triggerPayload) ? { triggerPayload: raw?.triggerPayload || raw?.context?.triggerPayload } : {}),
    },
    memoryContext: typeof raw?.memoryContext === 'string' ? raw.memoryContext : undefined,
    skills: Array.isArray(raw?.skills) ? raw.skills : [],
    notificationChannels: channels,
    deliverNotifications: true,
    sendNotifications: true,
    notificationDigest: [],
  };
}

async function requireProactiveAuth(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string } | null> {
  const vmUserIdHeader = req.headers['x-vm-user-id'] as string | undefined;
  if (vmUserIdHeader) {
    try {
      const authHeader = String(req.headers['authorization'] || '');
      const vmAuth = await verifyVMAuthFromRequest(authHeader, vmUserIdHeader);
      if (vmAuth?.userId) {
        return { userId: vmAuth.userId };
      }
    } catch {}
    writeJson(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }

  const auth = await requireAuth(req, res);
  if (!auth?.success || !auth.userId) return null;
  return { userId: auth.userId };
}

async function deliverProactiveNotifications(
  text: string,
  channels: unknown,
  userId?: string,
): Promise<Record<string, any>> {
  const message = String(text || '').trim();
  if (!message) return {};

  const requested = new Set(
    (Array.isArray(channels) ? channels : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const results: Record<string, any> = {};
  if (requested.has('sms')) {
    const smsText = stripMarkdownForSms(message);
    const smsFooter = '\n\n(Proactive mode. Reply to respond, or text /agent to switch.)';
    const maxBody = 1500 - smsFooter.length;
    const smsWithFooter = smsText.slice(0, maxBody) + smsFooter;
    results.sms = await (telnyx_send_sms as any).execute({
      message: smsWithFooter,
    }, {} as any);
    // Persist SMS mode + the proactive message so the reply handler can include it as context.
    try {
      const resolvedUserId = userId || String((getBridgeSecrets() as any)?.userId || '');
      if (resolvedUserId) {
        await upsertSmsUserState({
          userId: resolvedUserId,
          mode: 'proactive',
          proactiveMessage: smsText.slice(0, 2000),
        });
      }
    } catch {}
  }
  if (WHATSAPP_INTEGRATION_ENABLED && requested.has('whatsapp')) {
    const waText = stripMarkdownForSms(message);
    const waFooter = '\n\n(Proactive mode. Reply to respond, or text /agent to switch.)';
    const maxWaBody = 4096 - waFooter.length;
    const waWithFooter = waText.slice(0, maxWaBody) + waFooter;
    results.whatsapp = await (whatsapp_send_message as any).execute({
      message: waWithFooter,
    }, {} as any);
    // Persist WhatsApp mode + proactive message for reply context
    try {
      const resolvedUserId = userId || String((getBridgeSecrets() as any)?.userId || '');
      if (resolvedUserId) {
        await upsertSmsUserState({
          userId: resolvedUserId,
          mode: 'proactive',
          proactiveMessage: waText.slice(0, 2000),
        });
      }
    } catch {}
  }
  if (requested.has('call')) {
    results.call = await (telnyx_voice_call as any).execute({
      provider: 'auto',
      initial_message: message.slice(0, 500),
    }, {} as any);
  }
  return results;
}

async function ensureProactiveBrowserHeadless(runCtx: any): Promise<void> {
  await (browser_use_configure as any).execute?.({ mode: 'headless' }, runCtx);
}

function wrapProactiveTool(name: string, tool: any): any {
  if (!tool || typeof tool.execute !== 'function') return tool;

  if (name === 'browser_use_configure') {
    return createTool({
      id: name,
      description: `${tool.description || ''} Proactive agents always run browser_use in headless mode; headed mode is not allowed here.`.trim(),
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      execute: async (inputData: any, runCtx: any) => {
        const safeInput = {
          ...(inputData && typeof inputData === 'object' ? inputData : {}),
          mode: 'headless',
        };
        return await tool.execute(safeInput, runCtx);
      },
    });
  }

  if (name.startsWith('browser_use_')) {
    return createTool({
      id: name,
      description: `${tool.description || ''} Proactive agents use browser_use only in headless mode.`.trim(),
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      execute: async (inputData: any, runCtx: any) => {
        await ensureProactiveBrowserHeadless(runCtx);
        return await tool.execute(inputData, runCtx);
      },
    });
  }

  return tool;
}

function wrapBotScopedTool(name: string, tool: any, scope: { botId?: string; userId?: string }): any {
  const botId = String(scope.botId || '').trim();
  if (!botId || !tool || typeof tool.execute !== 'function') return tool;
  return createTool({
    id: name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    execute: async (inputData: any, runCtx: any) => {
      const scopedInput = {
        ...(inputData && typeof inputData === 'object' ? inputData : {}),
        __proactiveBotId: botId,
        __userId: scope.userId,
      };
      return await tool.execute(scopedInput, runCtx);
    },
  });
}

function formatBotAllowedToolsSection(allowedTools: unknown): string {
  const names = Array.isArray(allowedTools)
    ? Array.from(new Set(
        allowedTools
          .map((tool) => String(tool || '').trim())
          .filter(Boolean),
      ))
    : [];

  const allowedText = names.length > 0 ? names.join(', ') : '(none added)';
  return `## AGENT TOOL SCOPE
Added non-internal tools for this agent: ${allowedText}.

${names.length > 0 ? 'All other non-internal tools are not part of this agent.' : 'This agent has no added non-internal tools.'} Do not mention or imply access to tools outside this agent. If the user asks what tools you have, list only:
- the added non-internal tools above, and
- your internal agent tools: proactive_task_*, agent_memory_*, search_past_conversations, get_conversation_context, choose_notification_channel, write_session_summary, search_tools/get_tool_schema/execute_tool, get_skill_info.

Kanban truth rule: if the user asks you to add, update, move, or delete a card, call the matching agent_memory_* tool and check that it returned ok=true before saying it was done.`;
}

// ─── In-Memory Kanban Tools Factory ──────────────────────────────────────────

interface TaskState {
  id: string;
  title: string;
  instructions: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

interface TaskUpdate {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  result?: string;
}

interface NewTask {
  title: string;
  instructions?: string;
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
}

function createKanbanTools(initialTasks: TaskState[]) {
  // In-memory state the tools mutate during the agent run
  const tasks: TaskState[] = initialTasks.map(t => ({ ...t }));
  const taskUpdates: TaskUpdate[] = [];
  const newTasks: NewTask[] = [];
  const deletedTaskIds: string[] = [];

  const proactive_task_list = createTool({
    id: 'proactive_task_list',
    description: 'List all proactive tasks with their current status. Call this first to see what needs to be done.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        title: z.string(),
        instructions: z.string(),
        status: z.string(),
        result: z.string().optional(),
      })),
    }),
    execute: async () => {
      return { tasks: tasks.map(t => ({ id: t.id, title: t.title, instructions: t.instructions, status: t.status, result: t.result })) };
    },
  });

  const proactive_task_update = createTool({
    id: 'proactive_task_update',
    description: 'Update the status of a proactive task. Use this to mark tasks as in_progress, completed, or failed.',
    inputSchema: z.object({
      task_id: z.string().describe('The ID of the task to update'),
      status: z.enum(['queued', 'in_progress', 'completed', 'failed']).describe('New status'),
      result: z.string().optional().describe('Result summary or failure reason'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      task: z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        result: z.string().optional(),
      }).optional(),
      error: z.string().optional(),
    }),
    execute: async ({ task_id, status, result }) => {
      const t = tasks.find(t => t.id === task_id);
      if (!t) return { ok: false, error: `Task '${task_id}' not found` };
      t.status = status;
      if (result !== undefined) t.result = result;
      taskUpdates.push({ id: task_id, status, result });
      return { ok: true, task: { id: t.id, title: t.title, status: t.status, result: t.result } };
    },
  });

  const proactive_task_create = createTool({
    id: 'proactive_task_create',
    description: 'Create a new proactive task for the user. Use this when you spot something helpful to add to their board.',
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      instructions: z.string().optional().describe('Detailed instructions'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      task: z.object({
        id: z.string(),
        title: z.string(),
        instructions: z.string(),
        status: z.string(),
      }),
    }),
    execute: async ({ title, instructions }) => {
      const id = `ptask_agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const task: TaskState = { id, title, instructions: instructions || '', status: 'queued' };
      tasks.push(task);
      newTasks.push({ title, instructions: instructions || '', status: 'queued' });
      return { ok: true, task: { id: task.id, title: task.title, instructions: task.instructions, status: task.status } };
    },
  });

  const proactive_task_delete = createTool({
    id: 'proactive_task_delete',
    description: 'Delete a proactive task from the board. Use this to remove obsolete or duplicate tasks.',
    inputSchema: z.object({
      task_id: z.string().describe('The ID of the task to delete'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async ({ task_id }) => {
      const idx = tasks.findIndex(t => t.id === task_id);
      if (idx < 0) return { ok: false, error: `Task '${task_id}' not found` };
      tasks.splice(idx, 1);
      deletedTaskIds.push(task_id);
      return { ok: true };
    },
  });

  return {
    tools: { proactive_task_list, proactive_task_update, proactive_task_create, proactive_task_delete },
    getResults: () => ({ taskUpdates, newTasks, deletedTaskIds }),
  };
}

// ─── Urgency-Based Channel Selection Tool ────────────────────────────────────

function createChannelSelectionTool(enabledChannels: string[]) {
  let chosenChannel: string = 'app';
  let chosenUrgency: string = 'normal';

  const choose_notification_channel = createTool({
    id: 'choose_notification_channel',
    description: `Decide which notification channel to use based on urgency. Available channels: ${enabledChannels.join(', ')}. Use this AFTER assessing the situation in Phase 1. Urgency levels: critical (call), high (sms/whatsapp), normal (app notification), low (skip or minimal notification).`,
    inputSchema: z.object({
      urgency: z.enum(['critical', 'high', 'normal', 'low']).describe('How urgent is this notification?'),
      channel: z.enum(['app', 'sms', 'whatsapp', 'call', 'skip']).describe('Which channel to use'),
      reason: z.string().describe('Brief reason for this choice (e.g., "exam in 1 hour and user is gaming")'),
    }),
    outputSchema: z.object({ ok: z.boolean(), channel: z.string(), urgency: z.string() }),
    execute: async ({ urgency, channel, reason }) => {
      // Enforce: only allow channels the user has enabled
      if (channel !== 'skip' && !enabledChannels.includes(channel)) {
        // Fall back to the best available channel for this urgency
        if (urgency === 'critical' && enabledChannels.includes('call')) channel = 'call';
        else if ((urgency === 'critical' || urgency === 'high') && enabledChannels.includes('sms')) channel = 'sms';
        else if ((urgency === 'critical' || urgency === 'high') && WHATSAPP_INTEGRATION_ENABLED && enabledChannels.includes('whatsapp')) channel = 'whatsapp';
        else channel = 'app';
      }
      chosenChannel = channel;
      chosenUrgency = urgency;
      return { ok: true, channel, urgency };
    },
  });

  return {
    tool: choose_notification_channel,
    getChoice: () => ({ channel: chosenChannel, urgency: chosenUrgency }),
  };
}

// ─── Session Summary Tool ────────────────────────────────────────────────────

function createSessionSummaryTool() {
  let sessionSummary: string | null = null;

  const write_session_summary = createTool({
    id: 'write_session_summary',
    description: 'Record observations from this session for your future self. Be specific about what you saw, what you did (or chose not to do), and any patterns emerging. This is your memory.',
    inputSchema: z.object({
      user_activity: z.string().describe('Specific observation of what the user was doing (app names, not generic "working")'),
      intervention: z.string().optional().describe('What you notified/acted on, OR "skipped — [reason]" if you stayed silent'),
      pattern_notes: z.string().optional().describe('Emerging patterns (e.g., "user games Tuesday evenings", "ignores task reminders but responds to deadline warnings")'),
      urgency_used: z.string().optional().describe('Channel and urgency chosen, and why'),
    }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async ({ user_activity, intervention, pattern_notes, urgency_used }) => {
      const parts = [`Activity: ${user_activity}`];
      if (intervention) parts.push(`Intervention: ${intervention}`);
      if (pattern_notes) parts.push(`Patterns: ${pattern_notes}`);
      if (urgency_used) parts.push(`Urgency: ${urgency_used}`);
      sessionSummary = parts.join(' | ');
      return { ok: true };
    },
  });

  return {
    tool: write_session_summary,
    getSummary: () => sessionSummary,
  };
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function handleProactiveRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS' && (path.startsWith('/v1/proactive/') || path.startsWith('/v1/bot/') || path.startsWith('/v1/agent/'))) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-VM-User-Id',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  // /v1/agent/wakeup — single-agent wakeup invoked by the VM scheduler.
  // Shares the proactive runner; only the request body is reshaped: VM bots
  // nest fields under `config`, have no kanban tasks, and always want
  // notifications delivered (nothing else hears their output).
  if (req.method === 'POST' && (path === '/v1/proactive/wakeup' || path === '/v1/bot/wakeup' || path === '/v1/agent/wakeup')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true; // 401 already sent

    const rawBody = await readJsonBody(req);
    const body = (path === '/v1/bot/wakeup' || path === '/v1/agent/wakeup') ? normalizeBotWakeupBody(rawBody) : rawBody;
    const {
      botId = '',
      botName = '',
      tasks: incomingTasks = [],
      instructions = '',
      kanbanContext = '',
      prompt = '',
      allowedTools = [],
      modelMode = 'balanced',
      modelId,
      modelConfig,
      context = {},
      memoryContext: preBuiltMemoryContext,
      skills: incomingSkills = [],
      notificationChannels = [],
      deliverNotifications = false,
      sendNotifications = false,
      notificationDigest = [],
    } = body;
    const isVMOrigin = path === '/v1/bot/wakeup' || path === '/v1/agent/wakeup'
      || !!req.headers['x-vm-user-id']
      || context?.isVM === true
      || String(context?.executionTarget || '').toLowerCase() === 'vm';

    // Build in-memory kanban
    const taskStates: TaskState[] = (incomingTasks as any[]).map((t: any) => ({
      id: String(t.id || ''),
      title: String(t.title || ''),
      instructions: String(t.instructions || ''),
      status: String(t.status || 'queued') as TaskState['status'],
      result: t.result,
    }));

    const kanban = createKanbanTools(taskStates);

    // Create channel selection + session summary tools
    const enabledChannels = (Array.isArray(notificationChannels) ? notificationChannels : ['app'])
      .map((c: any) => String(c).toLowerCase().trim()).filter(Boolean)
      .filter((c) => WHATSAPP_INTEGRATION_ENABLED || c !== 'whatsapp');
    const channelSelector = createChannelSelectionTool(enabledChannels);
    const sessionSummaryTool = createSessionSummaryTool();

    const proactiveSearchTools = createTool({
      id: 'search_tools',
      description: 'Search the tools available to this bot by category or query. Discovered tools can be called via execute_tool({ tool_name, args }) or after fetching their schema with get_tool_schema.',
      inputSchema: (search_tools as any).inputSchema,
      outputSchema: (search_tools as any).outputSchema,
      execute: async (inputData, runCtx) => {
        const result = await (search_tools as any).execute?.(inputData, runCtx);
        if (result && Array.isArray((result as any).tools)) {
          return {
            ...(result as any),
            tools: (result as any).tools.filter((tool: any) => isProactiveToolAllowed(String(tool?.name || ''), allowedTools)),
          };
        }
        return result;
      },
    });

    const proactiveGetToolSchema = createTool({
      id: 'get_tool_schema',
      description: 'Get the full JSON schema for a tool. After calling this, you can call the tool directly by name or via execute_tool.',
      inputSchema: (get_tool_schema as any).inputSchema,
      outputSchema: (get_tool_schema as any).outputSchema,
      execute: async (inputData, runCtx) => {
        const toolName = String((inputData as any)?.tool_name || '').trim();
        if (!isProactiveToolAllowed(toolName, allowedTools)) {
          throw new Error(`Tool '${toolName}' is not allowed for this agent.`);
        }
        const result = await (get_tool_schema as any).execute?.(inputData, runCtx);
        // Dynamically register the tool into the agent's tool map so the LLM can call it directly
        if (result && toolName && !tools[toolName]) {
          const registeredTool = getToolRegistry().get(toolName);
          if (registeredTool && typeof (registeredTool as any).execute === 'function' && isProactiveToolAllowed(toolName, allowedTools)) {
            tools[toolName] = wrapProactiveTool(toolName, registeredTool);
          }
        }
        return result;
      },
    });

    const proactiveExecuteTool = createTool({
      id: 'execute_tool',
      description: 'Execute any tool by name with arguments. Use get_tool_schema first to see the correct argument format.',
      inputSchema: (execute_tool as any).inputSchema,
      outputSchema: (execute_tool as any).outputSchema,
      execute: async (inputData, runCtx) => {
        const toolName = String((inputData as any)?.tool_name || '').trim();
        if (!isProactiveToolAllowed(toolName, allowedTools)) {
          return {
            success: false,
            tool: toolName,
            error: `Tool '${toolName}' is not allowed for this agent.`,
          };
        }
        // Also register the tool for future direct calls
        if (toolName && !tools[toolName]) {
          const registeredTool = getToolRegistry().get(toolName);
          if (registeredTool && typeof (registeredTool as any).execute === 'function' && isProactiveToolAllowed(toolName, allowedTools)) {
            tools[toolName] = wrapProactiveTool(toolName, registeredTool);
          }
        }
        if (toolName === 'browser_use_configure') {
          const nextInput = {
            ...(inputData as any),
            args: {
              ...(((inputData as any)?.args && typeof (inputData as any).args === 'object') ? (inputData as any).args : {}),
              mode: 'headless',
            },
          };
          return await (execute_tool as any).execute?.(nextInput, runCtx);
        }
        if (toolName.startsWith('browser_use_')) {
          await ensureProactiveBrowserHeadless(runCtx);
        }
        return await (execute_tool as any).execute?.(inputData, runCtx);
      },
    });

    // Build this agent's own tool set. It starts with agent-internal tools only;
    // configured tools are added below by exact name or explicit prefix.
    //   - kanban.tools = the user's task board (proactive_task_*)
    //   - agent_memory_* = the agent's private kanban (working memory across runs)
    //   - search_past_conversations / get_conversation_context = recall memory
    //   - choose_notification_channel + write_session_summary = bookkeeping
    //   - search_tools / get_tool_schema / execute_tool = lazy-load only this
    //     agent's added tools, not Stuard's global tool surface.
    const tools: Record<string, any> = {
      ...kanban.tools,
      agent_memory_list: wrapBotScopedTool('agent_memory_list', agent_memory_list, { botId, userId: auth.userId }),
      agent_memory_create: wrapBotScopedTool('agent_memory_create', agent_memory_create, { botId, userId: auth.userId }),
      agent_memory_update: wrapBotScopedTool('agent_memory_update', agent_memory_update, { botId, userId: auth.userId }),
      agent_memory_delete: wrapBotScopedTool('agent_memory_delete', agent_memory_delete, { botId, userId: auth.userId }),
      agent_memory_log: wrapBotScopedTool('agent_memory_log', agent_memory_log, { botId, userId: auth.userId }),
      bot_memory_list: wrapBotScopedTool('bot_memory_list', bot_memory_list, { botId, userId: auth.userId }),
      bot_memory_create: wrapBotScopedTool('bot_memory_create', bot_memory_create, { botId, userId: auth.userId }),
      bot_memory_update: wrapBotScopedTool('bot_memory_update', bot_memory_update, { botId, userId: auth.userId }),
      bot_memory_delete: wrapBotScopedTool('bot_memory_delete', bot_memory_delete, { botId, userId: auth.userId }),
      bot_memory_log: wrapBotScopedTool('bot_memory_log', bot_memory_log, { botId, userId: auth.userId }),
      choose_notification_channel: channelSelector.tool,
      write_session_summary: sessionSummaryTool.tool,
      search_tools: proactiveSearchTools,
      get_tool_schema: proactiveGetToolSchema,
      execute_tool: proactiveExecuteTool,
      get_skill_info,
      search_past_conversations,
      get_conversation_context,
    };
    const expandedAllowedTools = expandProactiveAllowedToolNames(allowedTools);
    try {
      initToolRegistry();
      const registry = getToolRegistry();
      for (const name of expandedAllowedTools) {
        if (name.endsWith('_')) {
          for (const [toolName, tool] of registry.entries()) {
            if (
              !tools[toolName] &&
              isProactiveToolAllowed(toolName, allowedTools) &&
              toolName.startsWith(name) &&
              tool &&
              typeof (tool as any).execute === 'function'
            ) {
              tools[toolName] = wrapProactiveTool(toolName, tool);
            }
          }
          continue;
        }
        const tool = registry.get(name);
        if (!tools[name] && isProactiveToolAllowed(name, allowedTools) && tool && typeof (tool as any).execute === 'function') {
          tools[name] = wrapProactiveTool(name, tool);
        }
      }
    } catch (e: any) {
      console.warn('[proactive] Failed to augment allowed tools from registry:', e?.message || e);
    }

    // Build system prompt with user instructions and skill awareness
    let systemPrompt = PROACTIVE_SYSTEM_PROMPT;

    // Always remind the agent which tools belong to it by default. The actual
    // kanban contents arrive separately via `kanbanContext` (or are embedded
    // inside `instructions` for legacy callers); this section is the
    // tool-usage contract — it stays in the prompt even when the kanban is
    // empty so the agent knows the surface exists.
    systemPrompt += `\n\n## YOUR DEFAULT TOOLKIT (always available, regardless of allowedTools)
- **proactive_task_*** — manage the USER's task board (tasks they see). Use list/create/update/delete to keep it tidy.
- **agent_memory_*** — manage YOUR PRIVATE kanban. This is your working memory across runs:
  * agent_memory_list — see your cards (filter by status when needed).
  * agent_memory_create({ title, notes?, status? }) — capture a plan, finding, or in-flight work.
  * agent_memory_update({ id, ... }) — move cards between columns or edit notes.
  * agent_memory_delete({ id }) — drop a card (prefer "completed" so history sticks).
  * agent_memory_log({ summary, outcome }) — append a one-line wrap-up after each run.
- **search_past_conversations / get_conversation_context** — recall what happened in prior runs / chats.
- **choose_notification_channel / write_session_summary** — pick how to reach the user, and journal the run.

Use agent_memory_* aggressively. The kanban is HOW you stay coherent across wake-ups — without it you start every run blind. When you start a card, move it to in_progress; when you finish, mark it completed; when you fail, mark it failed with notes for your future self. The user can also see and edit these cards from the Agents → Kanban tab.`;

    systemPrompt += `\n\n${formatBotAllowedToolsSection(allowedTools)}`;

    // Render the bot's actual kanban (cards + recent run log) as its own
    // section. This is the *content* — the section above is the *contract*.
    const kanbanText = String(kanbanContext || '').trim();
    if (kanbanText) {
      systemPrompt += `\n\n${kanbanText}`;
    }

    if (instructions.trim()) {
      systemPrompt += `\n\n## USER INSTRUCTIONS\n${instructions.trim()}`;
    }
    systemPrompt += '\n\n## BROWSER CONSTRAINT\nIf browser automation is needed, use browser_use_configure with mode="headless" and keep browser_use in headless mode for the whole proactive run. Never switch to headed mode. Never use legacy browser_* headed desktop browser tools.';

    // ── Inject memory context for personalization ──
    // The VM sends pre-built memoryContext (built locally from its Python agent).
    // For desktop-originated wakeups, use the desktop WS bridge to query knowledge.
    try {
      if (typeof preBuiltMemoryContext === 'string' && preBuiltMemoryContext.trim()) {
        // VM path: memory context was built on the VM, use it directly
        systemPrompt += `\n\n${preBuiltMemoryContext.trim()}`;
      } else {
        // Desktop path: build memory context via desktop bridge
        const proactiveQuery = prompt || instructions || 'proactive check-in';
        const queryEmbedding = await getOrCreateQueryEmbedding(proactiveQuery).catch(() => undefined as number[] | undefined);
        const KNOWLEDGE_MAX_CHARS = 2000;

        const desktopWs = isVMOrigin ? undefined : getDesktopWs(auth.userId);

        const fetchMemoryCtx = async (): Promise<string[]> => {
          const [knowledgeCtx, segmentMatches] = await Promise.all([
            buildKnowledgeContext(proactiveQuery, {
              includeIdentity: true,
              includeDirectives: true,
              includeBio: false,
              maxGlobalFacts: 4,
              detectEntities: false,
              queryEmbedding,
            }).catch(() => null),
            queryEmbedding
              ? memoryService.searchSegmentsByEmbedding(queryEmbedding, { limit: 3, threshold: 0.6 }).catch(() => [])
              : memoryService.listRecentSegments({ limit: 3 }).catch(() => []),
          ]);

          const parts: string[] = [];
          if (knowledgeCtx?.text?.trim()) {
            parts.push(knowledgeCtx.text.trim().slice(0, KNOWLEDGE_MAX_CHARS));
          }
          if (Array.isArray(segmentMatches) && segmentMatches.length > 0) {
            const lines = ['[PAST CONTEXT]'];
            for (const match of segmentMatches.slice(0, 3)) {
              const seg = (match as any).segment || match;
              const summary = String(seg.summary || '').trim().slice(0, 100);
              if (summary) lines.push(`- ${summary}`);
            }
            if (lines.length > 1) parts.push(lines.join('\n'));
          }
          return parts;
        };

        const ctxParts: string[] = desktopWs
          ? await withClientBridge(desktopWs, fetchMemoryCtx) as string[]
          : await fetchMemoryCtx();

        if (ctxParts.length > 0) {
          systemPrompt += `\n\n${ctxParts.join('\n\n')}`;
        }
      }
    } catch (e: any) {
      console.warn('[proactive] Memory context injection failed:', e?.message);
    }

    // Inject environmental context (open windows, time, session summaries)
    const envContextParts: string[] = [];

    // Time context
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    envContextParts.push(`Current time: ${timeStr}, ${dayStr}`);

    // Open windows from desktop
    if (Array.isArray(context.openWindows) && context.openWindows.length > 0) {
      const winLines = ['[OPEN WINDOWS — user\'s currently visible apps]'];
      for (const w of (context.openWindows as any[]).slice(0, 20)) {
        const title = String(w?.title || '').trim();
        if (title) winLines.push(`- ${title}`);
      }
      envContextParts.push(winLines.join('\n'));
    }

    // Recent session summaries for pattern awareness
    if (Array.isArray(context.recentSessionSummaries) && context.recentSessionSummaries.length > 0) {
      const sumLines = [
        '[LAST 5 WAKE-UP SUMMARIES — use these to avoid repeating yourself]',
        'If the same activity shows up across multiple summaries, acknowledge the persistence and change your approach instead of repeating the same reminder.',
      ];
      for (const s of (context.recentSessionSummaries as string[]).slice(0, 5)) {
        sumLines.push(`- ${String(s).trim()}`);
      }
      envContextParts.push(sumLines.join('\n'));
    }

    if (envContextParts.length > 0) {
      systemPrompt += `\n\n${envContextParts.join('\n\n')}`;
    }

    // Set up secrets context so get_skill_info can access skills
    const secretBag: Record<string, any> = {};
    secretBag.userId = auth.userId;
    if (isVMOrigin) {
      secretBag.executionTarget = 'vm';
      secretBag.__executionTarget = 'vm';
      secretBag.__vmOrigin = true;
    }
    if (typeof botId === 'string' && botId.trim()) {
      secretBag.proactiveBotId = botId.trim();
    }
    if (Array.isArray(incomingSkills) && incomingSkills.length > 0) {
      secretBag.__skills = incomingSkills;
    }

    // Run agent within secrets context
    await runWithSecrets(secretBag, async () => {
      // Inject available skills summary into system prompt
      const skillsSection = buildAvailableSkillsPromptSection(getSkillsFromContext());
      if (skillsSection) {
        systemPrompt += `\n\n${skillsSection}`;
      }

      // Select model
      const resolvedModelChoice = (modelMode === 'auto' ? 'balanced' : (modelMode || 'balanced')) as ModelChoice;
      const resolvedModelId =
        typeof modelId === 'string' && modelId.trim()
          ? modelId.trim()
          : pickDefaultModelId(modelConfig, resolvedModelChoice)
            || getDefaultModelForCategory(resolvedModelChoice as any);
      const model = getModel(resolvedModelChoice, resolvedModelId);
      const safeBotId = String(botId || 'default').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'default';
      const displayBotName = String(botName || safeBotId).trim().slice(0, 80);

      const agent = new Agent({
        id: `stuard-bot-${safeBotId}`,
        name: displayBotName ? `Stuard Bot: ${displayBotName}` : `Stuard Bot ${safeBotId}`,
        instructions: [{ role: 'system', content: systemPrompt }] as any,
        model,
        tools,
      });

      // Build the user message content (supports screenshot as image)
      const screenshotData = typeof context.screenshot === 'string' && context.screenshot.length > 100
        ? context.screenshot
        : null;
      const systemAudioData = typeof context.systemAudio === 'string' && context.systemAudio.length > 100
        ? context.systemAudio
        : null;
      const micAudioData = typeof context.micAudio === 'string' && context.micAudio.length > 100
        ? context.micAudio
        : null;

      const messageContent = buildProactiveMessageContent({
        prompt,
        taskCount: taskStates.length,
        tasks: taskStates,
        screenshot: screenshotData,
        systemAudio: systemAudioData,
        micAudio: micAudioData,
        notificationDigest: Array.isArray(notificationDigest) ? notificationDigest : [],
        triggerPayload: context.triggerPayload,
      });

      try {
        // Run with timeout
        const TIMEOUT_MS = 180_000; // 3 minutes
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Proactive agent timed out after 3 minutes')), TIMEOUT_MS);
        });

        const generatePromise = generateWithToolRecovery({
          agent: agent as any,
          baseMessages: [{ role: 'user', content: messageContent }],
          maxSteps: 20,
          maxRetries: 3,
          onToolNotFound: (toolName: string) => {
            // Dynamically register missing tools so the retry finds them
            if (!tools[toolName] && isProactiveToolAllowed(toolName, allowedTools)) {
              initToolRegistry();
              const registeredTool = getToolRegistry().get(toolName);
              if (registeredTool && typeof (registeredTool as any).execute === 'function') {
                tools[toolName] = wrapProactiveTool(toolName, registeredTool);
              }
            }
          },
        });

        const response: any = await Promise.race([generatePromise, timeoutPromise]);
        const text = response?.text || '';
        const usage = response?.usage ? normalizeUsage(response.usage) : undefined;
        const { taskUpdates, newTasks, deletedTaskIds } = kanban.getResults();

        // Use agent's channel choice if it called choose_notification_channel,
        // otherwise fall back to user-configured channels
        const agentChoice = channelSelector.getChoice();
        const sessionSummary = sessionSummaryTool.getSummary();
        let effectiveChannels = notificationChannels;

        if (agentChoice.channel === 'skip') {
          // Agent decided not to notify — respect that
          effectiveChannels = [];
        } else if (agentChoice.channel !== 'app') {
          // Agent chose a specific elevated channel — use it
          effectiveChannels = [agentChoice.channel];
        }

        const notifications = (deliverNotifications || sendNotifications) && effectiveChannels.length > 0
          ? await deliverProactiveNotifications(text, effectiveChannels, auth.userId)
          : undefined;

        writeJson(res, 200, {
          ok: true,
          text,
          taskUpdates,
          newTasks,
          deletedTaskIds,
          notifications,
          usage,
          modelId: resolvedModelId,
          agentUrgency: agentChoice.urgency,
          agentChannel: agentChoice.channel,
          sessionSummary,
        });
      } catch (e: any) {
        console.error('[proactive] Agent execution failed:', e?.message || e);
        const { taskUpdates, newTasks, deletedTaskIds } = kanban.getResults();
        writeJson(res, 200, {
          ok: false,
          error: String(e?.message || 'Agent execution failed'),
          text: '',
          taskUpdates,
          newTasks,
          deletedTaskIds,
          modelId: resolvedModelId,
        });
      }
    });

    return true;
  }

  // ── Sync proactive config to VM ─────────────────────────────────────────────
  // Desktop calls this when executionTarget changes to 'cloud' to enable
  // the VM's own standalone proactive scheduler.
  if (req.method === 'POST' && path === '/v1/proactive/vm-config') {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const {
      enabled,
      interval,
      modelMode,
      instructions,
      notificationChannels,
    } = body;

    // Map desktop config shape to VM ProactiveConfig shape
    const intervalMap: Record<string, number> = {
      '10m': 10 * 60_000, '15m': 15 * 60_000, '30m': 30 * 60_000,
      '1h': 60 * 60_000, '2h': 2 * 60 * 60_000, 'random': 20 * 60_000,
    };

    const vmUpdates: Record<string, any> = {};
    if (typeof enabled === 'boolean') vmUpdates.enabled = enabled;
    if (typeof interval === 'string' && intervalMap[interval]) {
      vmUpdates.intervalMs = intervalMap[interval];
    }
    if (typeof modelMode === 'string') vmUpdates.modelMode = modelMode;
    if (Array.isArray(notificationChannels)) vmUpdates.channels = notificationChannels.filter((c: any) => c !== 'app');
    if (typeof instructions === 'string') vmUpdates.instructions = instructions;

    try {
      const result = await sendVMCommand(auth.userId, 'proactive_config', { updates: vmUpdates }, 15_000);
      writeJson(res, 200, { ok: result.ok, config: result.result?.config, error: result.error });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // ── Sync skills.json to VM ──────────────────────────────────────────────────
  // Desktop pushes the user's full active skill set so the VM bot scheduler
  // can include the right subset of skills in /v1/bot/wakeup payloads.
  if (req.method === 'POST' && (path === '/v1/bot/skills-sync' || path === '/v1/agent/skills-sync')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const skills = Array.isArray(body?.skills) ? body.skills : [];

    try {
      const result = await sendVMCommand(auth.userId, 'skills_sync', { skills }, 15_000);
      writeJson(res, 200, { ok: result.ok, count: result.result?.count, error: result.error });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Sync deployed bot configs to the VM's multi-bot scheduler. The desktop is
  // the source of truth for bot identity/config; the VM owns runtime state.
  if (req.method === 'POST' && (path === '/v1/bot/sync' || path === '/v1/agent/sync')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const bots = Array.isArray(body?.bots) ? body.bots : [];
    // Pass through the desktop-supplied IANA timezone so the VM can keep
    // process.env.TZ in sync with the user's *current* zone (cron triggers
    // and quiet-hour math read from it). Validated VM-side too.
    const timezone = typeof body?.timezone === 'string' ? body.timezone.trim() : '';

    try {
      const result = await sendVMCommand(
        auth.userId,
        'agents_sync',
        { bots, timezone: timezone || undefined },
        15_000,
      );
      writeJson(res, 200, {
        ok: result.ok,
        count: result.result?.count,
        timezone: result.result?.timezone,
        error: result.error || result.result?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Runtime snapshot for the VM-owned bot scheduler. The desktop uses this
  // after manual triggers so the UI can show "running" immediately instead of
  // waiting for a completed run-log entry.
  if (req.method === 'POST' && (path === '/v1/bot/status' || path === '/v1/agent/status')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const botId = String(body?.agentId || body?.agent_id || body?.botId || body?.id || '').trim();

    try {
      const result = await sendVMCommand(auth.userId, 'agents_status', {}, 10_000);
      const status = result.result || {};
      const bots = Array.isArray(status?.bots) ? status.bots : [];
      writeJson(res, 200, {
        ok: result.ok,
        ...status,
        bot: botId ? (bots.find((b: any) => String(b?.id || '') === botId) || null) : undefined,
        error: result.error || status?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Pull the VM-local private kanban/run-log for a bot so the desktop UI can
  // show memory written while the laptop was offline.
  if (req.method === 'POST' && (path === '/v1/bot/memory/export' || path === '/v1/agent/memory/export')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const botId = String(body?.agentId || body?.agent_id || body?.botId || body?.id || '').trim();
    if (!botId) {
      writeJson(res, 400, { ok: false, error: 'agent_id_required' });
      return true;
    }

    try {
      const result = await sendVMCommand(auth.userId, 'agent_memory_export', { botId }, 15_000);
      writeJson(res, 200, {
        ok: result.ok,
        ...(result.result || {}),
        error: result.error || result.result?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Manually run a single deployed bot on the VM right now. Used by the
  // desktop's "Run Once" action when the bot has been deployed to VM —
  // routes the wake-up there instead of executing locally so behavior is
  // consistent with scheduled runs.
  if (req.method === 'POST' && (path === '/v1/bot/run' || path === '/v1/agent/run')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const botId = String(body?.agentId || body?.agent_id || body?.botId || body?.id || '').trim();
    if (!botId) {
      writeJson(res, 400, { ok: false, error: 'agent_id_required' });
      return true;
    }

    try {
      const result = await sendVMCommand(auth.userId, 'agents_run', { id: botId }, 30_000);
      writeJson(res, 200, {
        ok: result.ok,
        ...(result.result || {}),
        error: result.error || result.result?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Delete a single deployed agent from the VM scheduler and remove its VM-local
  // memory. This does not mutate the desktop's local agent config.
  if (req.method === 'POST' && (path === '/v1/bot/delete' || path === '/v1/agent/delete')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const agentId = String(body?.agentId || body?.agent_id || body?.botId || body?.id || '').trim();
    if (!agentId) {
      writeJson(res, 400, { ok: false, error: 'agent_id_required' });
      return true;
    }

    try {
      const result = await sendVMCommand(auth.userId, 'agents_delete', { id: agentId }, 15_000);
      writeJson(res, 200, {
        ok: result.ok,
        ...(result.result || {}),
        error: result.error || result.result?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  // Push the desktop's latest bot memory snapshot to the VM after user edits.
  if (req.method === 'POST' && (path === '/v1/bot/memory/replace' || path === '/v1/agent/memory/replace')) {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true;

    const body = await readJsonBody(req);
    const botId = String(body?.agentId || body?.agent_id || body?.botId || body?.id || '').trim();
    if (!botId) {
      writeJson(res, 400, { ok: false, error: 'agent_id_required' });
      return true;
    }

    try {
      const result = await sendVMCommand(auth.userId, 'agent_memory_replace', {
        botId,
        memory: body?.memory || {},
      }, 15_000);
      writeJson(res, 200, {
        ok: result.ok,
        ...(result.result || {}),
        error: result.error || result.result?.error,
      });
    } catch (e: any) {
      writeJson(res, 200, { ok: false, error: e?.message || 'vm_unreachable' });
    }
    return true;
  }

  return false;
}
