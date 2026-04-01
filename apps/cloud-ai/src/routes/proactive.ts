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
import { web_search } from '../tools/perplexity-tools';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { buildAvailableSkillsPromptSection, get_skill_info, getSkillsFromContext } from '../tools/skill-tools';
import { runWithSecrets } from '../tools/bridge';
import type { ModelChoice } from '../router/model-router';
import { getDefaultModelForCategory } from '../pricing';
import { buildProactiveMessageContent, expandProactiveAllowedToolNames, filterProactiveTools, generateWithToolRecovery, isBlockedProactiveToolName } from './proactive-utils';
import { verifyVMAuthFromRequest } from '../services/vm-tokens';
import { telnyx_send_sms, telnyx_voice_call } from '../tools/telnyx-tools';
import { whatsapp_send_message } from '../tools/whatsapp-tools';
import { stripMarkdownForSms } from './sms-utils';
import { getBridgeSecrets } from '../tools/bridge';
import { normalizeUsage } from '../utils/usage';
import { search_past_conversations, get_conversation_context } from '../tools/device-tools';
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
  if (requested.has('whatsapp')) {
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
        else if ((urgency === 'critical' || urgency === 'high') && enabledChannels.includes('whatsapp')) channel = 'whatsapp';
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
  if (req.method === 'OPTIONS' && path.startsWith('/v1/proactive/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-VM-User-Id',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (req.method === 'POST' && path === '/v1/proactive/wakeup') {
    const auth = await requireProactiveAuth(req, res);
    if (!auth) return true; // 401 already sent

    const body = await readJsonBody(req);
    const {
      tasks: incomingTasks = [],
      instructions = '',
      prompt = '',
      allowedTools = [],
      modelMode = 'balanced',
      modelId,
      context = {},
      memoryContext: preBuiltMemoryContext,
      skills: incomingSkills = [],
      notificationChannels = [],
      deliverNotifications = false,
      sendNotifications = false,
      notificationDigest = [],
    } = body;

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
      .map((c: any) => String(c).toLowerCase().trim()).filter(Boolean);
    const channelSelector = createChannelSelectionTool(enabledChannels);
    const sessionSummaryTool = createSessionSummaryTool();

    const proactiveSearchTools = createTool({
      id: 'search_tools',
      description: 'Search for available tools by category or query. Discovered tools can be called via execute_tool({ tool_name, args }) or after fetching their schema with get_tool_schema.',
      inputSchema: (search_tools as any).inputSchema,
      outputSchema: (search_tools as any).outputSchema,
      execute: async (inputData, runCtx) => {
        const result = await (search_tools as any).execute?.(inputData, runCtx);
        if (result && Array.isArray((result as any).tools)) {
          return {
            ...(result as any),
            tools: (result as any).tools.filter((tool: any) => !isBlockedProactiveToolName(String(tool?.name || ''))),
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
        if (isBlockedProactiveToolName(toolName)) {
          throw new Error(`Tool '${toolName}' is not available to proactive agents. Use headless browser_use_* tools instead.`);
        }
        const result = await (get_tool_schema as any).execute?.(inputData, runCtx);
        // Dynamically register the tool into the agent's tool map so the LLM can call it directly
        if (result && toolName && !tools[toolName]) {
          const registeredTool = getToolRegistry().get(toolName);
          if (registeredTool && typeof (registeredTool as any).execute === 'function' && !isBlockedProactiveToolName(toolName)) {
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
        if (isBlockedProactiveToolName(toolName)) {
          return {
            success: false,
            tool: toolName,
            error: `Tool '${toolName}' is not available to proactive agents. Use headless browser_use_* tools instead.`,
          };
        }
        // Also register the tool for future direct calls
        if (toolName && !tools[toolName]) {
          const registeredTool = getToolRegistry().get(toolName);
          if (registeredTool && typeof (registeredTool as any).execute === 'function' && !isBlockedProactiveToolName(toolName)) {
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

    // Build tool set — include kanban, discovery, web search, skills, and headless agents
    const availableTools: Record<string, any> = {
      ...kanban.tools,
      choose_notification_channel: channelSelector.tool,
      write_session_summary: sessionSummaryTool.tool,
      web_search,
      deploy_headless_agent: deployHeadlessAgent,
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
              !availableTools[toolName] &&
              !isBlockedProactiveToolName(toolName) &&
              toolName.startsWith(name) &&
              tool &&
              typeof (tool as any).execute === 'function'
            ) {
              availableTools[toolName] = wrapProactiveTool(toolName, tool);
            }
          }
          continue;
        }
        const tool = registry.get(name);
        if (!availableTools[name] && !isBlockedProactiveToolName(name) && tool && typeof (tool as any).execute === 'function') {
          availableTools[name] = wrapProactiveTool(name, tool);
        }
      }
    } catch (e: any) {
      console.warn('[proactive] Failed to augment allowed tools from registry:', e?.message || e);
    }
    const tools = filterProactiveTools(availableTools, expandedAllowedTools);

    // Build system prompt with user instructions and skill awareness
    let systemPrompt = PROACTIVE_SYSTEM_PROMPT;
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

        const desktopWs = getDesktopWs(auth.userId);

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
      const sumLines = ['[SESSION OBSERVATIONS — your notes from previous wake-ups]'];
      for (const s of (context.recentSessionSummaries as string[]).slice(0, 10)) {
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
          : getDefaultModelForCategory(resolvedModelChoice as any);
      const model = getModel(resolvedModelChoice, resolvedModelId);

      const agent = new Agent({
        id: 'stuard-proactive',
        name: 'stuard-proactive',
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
            if (!tools[toolName] && !isBlockedProactiveToolName(toolName)) {
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

  return false;
}
