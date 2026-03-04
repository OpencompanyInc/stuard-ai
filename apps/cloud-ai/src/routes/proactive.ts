/**
 * Proactive Agent Endpoint
 *
 * POST /v1/proactive/wakeup
 *
 * Receives tasks + config from the desktop scheduler, creates an in-memory
 * kanban + Mastra agent with proactive system prompt, runs synchronously
 * via agent.generate(), and returns { text, taskUpdates, newTasks }.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { requireAuth } from '../auth/http';
import { PROACTIVE_SYSTEM_PROMPT } from '../agents/stuard/prompts';
import { getModel } from '../agents/stuard/models';
import { search_tools, get_tool_schema, execute_tool } from '../tools/meta-tools';
import { web_search } from '../tools/perplexity-tools';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import type { ModelChoice } from '../router/model-router';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: any) => {
      try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch {}
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
    try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"internal"}'); } catch {}
  }
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

  return {
    tools: { proactive_task_list, proactive_task_update, proactive_task_create },
    getResults: () => ({ taskUpdates, newTasks }),
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
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (req.method === 'POST' && path === '/v1/proactive/wakeup') {
    const auth = await requireAuth(req, res);
    if (!auth) return true; // 401 already sent

    const body = await readJsonBody(req);
    const {
      tasks: incomingTasks = [],
      instructions = '',
      modelMode = 'balanced',
      modelId,
      context = {},
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

    // Build tool set
    const tools: Record<string, any> = {
      ...kanban.tools,
      web_search,
      deploy_headless_agent: deployHeadlessAgent,
      search_tools,
      get_tool_schema,
      execute_tool,
    };

    // Build system prompt with user instructions
    let systemPrompt = PROACTIVE_SYSTEM_PROMPT;
    if (instructions.trim()) {
      systemPrompt += `\n\n## USER INSTRUCTIONS\n${instructions.trim()}`;
    }

    // Select model
    const model = getModel(
      (modelMode || 'balanced') as ModelChoice,
      typeof modelId === 'string' && modelId.trim() ? modelId : undefined,
    );

    const agent = new Agent({
      id: 'stuard-proactive',
      name: 'stuard-proactive',
      instructions: [{ role: 'system', content: systemPrompt }] as any,
      model,
      tools,
    });

    // Build the user message
    const parts: string[] = ['[Proactive Wake-Up]'];
    if (taskStates.length > 0) {
      parts.push(`\nYou have ${taskStates.length} task(s) on your board. Call proactive_task_list to see them.`);
    } else {
      parts.push('\nNo tasks on the board right now. Check in with the user.');
    }
    if (context.screenshot) {
      parts.push('\n(A screenshot of the user\'s screen is attached for context.)');
    }
    const userMessage = parts.join('\n');

    try {
      // Run with timeout
      const TIMEOUT_MS = 180_000; // 3 minutes
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Proactive agent timed out after 3 minutes')), TIMEOUT_MS);
      });

      const generatePromise = agent.generate(
        [{ role: 'user', content: userMessage }],
        { maxSteps: 20 },
      );

      const response: any = await Promise.race([generatePromise, timeoutPromise]);
      const text = response?.text || '';
      const { taskUpdates, newTasks } = kanban.getResults();

      writeJson(res, 200, { ok: true, text, taskUpdates, newTasks });
    } catch (e: any) {
      console.error('[proactive] Agent execution failed:', e?.message || e);
      const { taskUpdates, newTasks } = kanban.getResults();
      writeJson(res, 200, {
        ok: false,
        error: String(e?.message || 'Agent execution failed'),
        text: '',
        taskUpdates,
        newTasks,
      });
    }

    return true;
  }

  return false;
}
