/**
 * MCP Server — Tool definitions
 *
 * The tools an external MCP client (Claude Code, Codex, Cursor) gets. They wrap
 * the *same* internals the main Stuard agent uses, so behavior and gating stay in
 * lockstep:
 *   - stuard_search_tools  → search_tools  (chat surface, semantic registry search)
 *   - stuard_execute_tool  → execute_tool  (registry → custom → desktop bridge; INTERNAL_TOOLS refused)
 *   - stuard_ask           → ask_user over the bridge, but non-blocking (returns a job_id)
 *   - stuard_status        → poll a job_id
 *   - stuard_inbox         → list the caller's jobs
 *
 * WORKFLOW AUTHORING — the MCP client IS the architect.
 * Earlier these wrapped `route_to_workflow_agent`, which handed a natural-language
 * brief to a separate Workflow Architect *subagent* that re-derived everything and
 * failed opaquely ("Subagent ended without final text…"). Instead we now expose the
 * architect's OWN primitives directly, so the connected agent composes/wires/
 * validates the graph itself — no nested LLM, no lossy hand-off:
 *   - stuard_search_workflow_docs → search_workflow_docs (the authoring manual)
 *   - stuard_search_workflow_nodes → search_workflow_nodes (node discovery)
 *   - stuard_get_node_schema      → get_tool_schema (exact args for a node)
 *   - stuard_create_workflow      → create_workflow (compose a spec + persist it)
 *   - stuard_read_workflow        → read_workflow (compact DSL + topology validate)
 *   - stuard_modify_workflow      → modify_workflow (structured add/update/wire ops)
 *   - stuard_deploy_workflow      → deploy_workflow (activate so triggers fire)
 *   - stuard_list_workflows       → search_workflows (find an existing flow id)
 * Edits address a workflow by id; create/modify persist through the desktop bridge.
 *
 * User context (userId + desktop WS) is supplied by the route via the bridge
 * AsyncLocalStorage (see routes/mcp-server.ts). These tools read it lazily.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { search_tools, execute_tool, search_workflow_nodes } from '../tools/meta-tools';
import { createWorkflowTool, retrieveToolFormat } from '../tools/workflow-system';
import { workflowModifyTool, getWorkflowById } from '../tools/workflow';
import { readWorkflow } from '../tools/workflow-dsl';
import { createSearchWorkflowDocsTool } from '../agents/workflow-agent/docs';
import { searchWorkflows, loadWorkflow } from '../agents/workflow-agent/tools';
import { deployWorkflow } from '../agents/workflow-agent/deploy';
import { execLocalTool, hasClientBridge, getBridgeSecrets } from '../tools/bridge';
import { completeJob, createJob, failJob, getJob, listJobs, publicJob, updateJob } from './job-store';

function currentUserId(): string {
  const id = String(getBridgeSecrets()?.userId || '').trim();
  return id;
}

// ── stuard_search_tools ──────────────────────────────────────────────────────
// Reuses the chat-surface search_tools instance verbatim, so the MCP client sees
// exactly the tools the main agent can discover (compact input signatures included).
export const stuard_search_tools = createTool({
  id: 'stuard_search_tools',
  description:
    'Search Stuard for available tools by free-text query. Returns up to 8 matches, each with a compact input signature — usually enough to call stuard_execute_tool directly. This is the same catalog the main Stuard agent can run (tasks, memories, projects, agents, workflows, integrations, device actions, etc.).',
  inputSchema: z.object({
    query: z.string().min(1).describe('What you want to do, in plain language (e.g. "create a task", "search my memories").'),
    category: z.string().optional().describe('Optional category filter.'),
    kind: z.string().optional().describe('Optional kind filter (local, cloud, orchestration).'),
  }),
  execute: async (inputData, runCtx) => {
    return (search_tools as any).execute(inputData, runCtx);
  },
});

// ── stuard_execute_tool ──────────────────────────────────────────────────────
export const stuard_execute_tool = createTool({
  id: 'stuard_execute_tool',
  description:
    'Execute any Stuard tool by exact name. Use stuard_search_tools first to find the name and its argument shape. Set background:true for long-running tools to get a job_id immediately (poll it with stuard_status) instead of blocking. Device tools require the user\'s Stuard desktop app to be online.',
  inputSchema: z.object({
    tool_name: z.string().describe('Exact tool name from stuard_search_tools.'),
    args: z.record(z.string(), z.any()).optional().default({}).describe('Arguments matching the tool schema.'),
    background: z.boolean().optional().default(false).describe('Run async and return a job_id instead of waiting for the result.'),
  }),
  execute: async (inputData, runCtx) => {
    const { tool_name, args = {}, background = false } = inputData as {
      tool_name: string;
      args?: Record<string, any>;
      background?: boolean;
    };
    const userId = currentUserId();

    if (!background) {
      return (execute_tool as any).execute({ tool_name, args }, runCtx);
    }

    // Background: fire the execution (it stays inside the active bridge context,
    // so device tools still relay) and resolve the job when it settles.
    const job = createJob({
      userId,
      kind: 'execute',
      summary: `execute ${tool_name}`,
      request: { tool_name, args },
      status: 'running',
    });
    Promise.resolve((execute_tool as any).execute({ tool_name, args }, runCtx))
      .then((result: any) => {
        if (result && typeof result === 'object' && result.success === false) {
          failJob(job.id, String(result.error || 'tool execution failed'));
        } else {
          completeJob(job.id, result);
        }
      })
      .catch((err: any) => failJob(job.id, err?.message || String(err)));

    return { success: true, job_id: job.id, status: 'running' };
  },
});

// ── stuard_ask ───────────────────────────────────────────────────────────────
const MIN_EXPIRY_S = 30;
const MAX_EXPIRY_S = 1800; // 30 min — ask_user's bridge call also bounds the wait

function mapAskResult(type: string, r: any): { status: 'completed' | 'dismissed'; reply?: string; result: any } {
  if (!r || typeof r !== 'object') return { status: 'completed', reply: undefined, result: r };
  if (r.dismissed || r.ok === false) return { status: 'dismissed', result: r };
  let reply: string | undefined;
  if (type === 'confirm') reply = r.confirmed ? 'yes' : 'no';
  else if (type === 'choices') reply = r.selectedLabel || r.selected;
  else if (type === 'text') reply = r.text;
  if (reply === undefined && typeof r.text === 'string') reply = r.text;
  return { status: 'completed', reply, result: r };
}

export const stuard_ask = createTool({
  id: 'stuard_ask',
  description:
    'Ask the Stuard user a question and return immediately with a job_id (the message is shown in the desktop app). Poll stuard_status(job_id) to get the reply once they answer. type: confirm = yes/no, choices = pick an option, text = free text. Requires the desktop app to be online.',
  inputSchema: z.object({
    message: z.string().min(1).describe('The question to show the user.'),
    type: z.enum(['confirm', 'choices', 'text']).optional().default('text').describe('How the user answers.'),
    options: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .optional()
      .describe('Choices to pick from (required when type=choices).'),
    title: z.string().optional().describe('Optional short title shown above the message.'),
    placeholder: z.string().optional().describe('Optional placeholder for text input.'),
    expires_in_seconds: z
      .number()
      .optional()
      .default(300)
      .describe('How long to wait for a reply before the job expires (30–1800s).'),
  }),
  execute: async (inputData) => {
    const { message, type = 'text', options, title, placeholder, expires_in_seconds = 300 } = inputData as any;
    const userId = currentUserId();

    if (!hasClientBridge()) {
      return {
        ok: false,
        error: 'desktop_offline',
        note: 'The user\'s Stuard desktop app must be online to show a question.',
      };
    }

    const expiresMs = Math.max(MIN_EXPIRY_S, Math.min(MAX_EXPIRY_S, Number(expires_in_seconds) || 300)) * 1000;
    const job = createJob({
      userId,
      kind: 'ask',
      summary: message,
      request: { message, type, options },
      status: 'awaiting_reply',
      expiresInMs: expiresMs,
    });

    // Fire the question over the bridge (initiated inside the active bridge
    // context → captures the desktop WS). Don't await — resolve the job on reply.
    Promise.resolve(execLocalTool('ask_user', { message, type, options, title, placeholder }, undefined, expiresMs))
      .then((r: any) => {
        if (r && r.timedOut) {
          updateJob(job.id, { status: 'expired' });
          return;
        }
        const mapped = mapAskResult(type, r);
        if (mapped.status === 'dismissed') updateJob(job.id, { status: 'dismissed', result: mapped.result });
        else completeJob(job.id, mapped.result, mapped.reply);
      })
      .catch((err: any) => failJob(job.id, err?.message || 'ask failed'));

    return { ok: true, job_id: job.id, status: 'awaiting_reply' };
  },
});

// ── stuard_status ────────────────────────────────────────────────────────────
export const stuard_status = createTool({
  id: 'stuard_status',
  description:
    'Get the current status and result of a job_id returned by stuard_ask or a background stuard_execute_tool. Terminal statuses: completed, failed, expired, dismissed.',
  inputSchema: z.object({
    job_id: z.string().describe('The job_id to check.'),
  }),
  execute: async (inputData) => {
    const { job_id } = inputData as { job_id: string };
    const job = getJob(currentUserId(), job_id);
    if (!job) return { ok: false, error: 'job_not_found' };
    return { ok: true, ...publicJob(job) };
  },
});

// ── stuard_inbox ─────────────────────────────────────────────────────────────
export const stuard_inbox = createTool({
  id: 'stuard_inbox',
  description: 'List your recent Stuard jobs (asks and background executions) with their statuses.',
  inputSchema: z.object({
    limit: z.number().optional().default(20).describe('Max jobs to return (1–100).'),
  }),
  execute: async (inputData) => {
    const { limit = 20 } = inputData as { limit?: number };
    const items = listJobs(currentUserId(), limit).map(publicJob);
    return { ok: true, jobs: items };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW AUTHORING — you are the architect
//
// The MCP client drives the same primitives the Workflow Architect subagent uses
// internally, so it builds the graph directly instead of briefing a nested LLM.
// Typical loop: search_workflow_docs (ground) → search_workflow_nodes /
// get_node_schema (find nodes + args) → create_workflow (seed the spec) →
// read_workflow / modify_workflow (build + validate) → deploy_workflow (activate).
// ═══════════════════════════════════════════════════════════════════════════

// ── stuard_search_workflow_nodes ─────────────────────────────────────────────
export const stuard_search_workflow_nodes = createTool({
  id: 'stuard_search_workflow_nodes',
  description:
    'Search the nodes/tools available inside Stuard workflows (triggers, actions, control flow) by free-text query. Returns exact node names + compact input shapes. Use it to pick the real node for each step before you add it with stuard_modify_workflow.',
  inputSchema: z.object({
    query: z.string().min(1).describe('What the step should do, in plain language (e.g. "send an SMS", "post to X", "search the web").'),
    category: z.string().optional().describe('Optional category filter.'),
    kind: z.string().optional().describe('Optional kind filter.'),
  }),
  execute: async (inputData, runCtx) => {
    return (search_workflow_nodes as any).execute(inputData, runCtx);
  },
});

// ── stuard_search_workflow_docs ──────────────────────────────────────────────
// The authoring manual: graph model, execution, wires/guards/loops, custom_ui
// routing, variables, modify_workflow ops + pitfalls. A fresh dedup set per call
// keeps the stateless MCP path from suppressing sections across unrelated requests.
export const stuard_search_workflow_docs = createTool({
  id: 'stuard_search_workflow_docs',
  description:
    'Search the Stuard workflow authoring manual by topic — architecture, execution model, triggers (cron/hotkey/webhook/…), wires (basic/branching/convergence/callNode), guards, loops, variables, custom_ui routing, modify_workflow ops & pitfalls, debugging. READ THIS FIRST when building or editing: you are composing the graph yourself, so these are your reference. Pass "list" to see all section ids, or a section id for that exact section.',
  inputSchema: z.object({
    query: z.string().min(1).describe('What you need to know (e.g. "custom_ui callNode", "schedule.cron trigger", "guard branching", "modify_workflow add_node", or "list").'),
    topK: z.number().int().min(1).max(3).optional().default(3).describe('Max sections to return (1–3).'),
  }),
  execute: async (inputData, runCtx) => {
    const tool = createSearchWorkflowDocsTool({ seen: new Set<string>() });
    return (tool as any).execute(inputData, runCtx);
  },
});

// ── stuard_get_node_schema ───────────────────────────────────────────────────
export const stuard_get_node_schema = createTool({
  id: 'stuard_get_node_schema',
  description:
    'Get the exact input schema (arg names, types, which are required) for a single workflow node/tool by name. Use after stuard_search_workflow_nodes when its compact signature isn\'t enough to wire the node confidently.',
  inputSchema: z.object({
    node_name: z.string().min(1).describe('Exact node/tool name (e.g. "custom_ui", "schedule.cron", "telnyx_voice_call").'),
  }),
  execute: async (inputData, runCtx) => {
    const { node_name } = inputData as { node_name: string };
    return (retrieveToolFormat as any).execute({ toolName: node_name }, runCtx);
  },
});

/**
 * Make sure a workflow id is resolvable for read/modify/deploy.
 *
 * The graph lives in cloud-ai's module-level workflowMap once created or loaded.
 * If it isn't there (e.g. created on another instance, or a pre-existing saved
 * flow the client wants to edit), pull it off the desktop into the session first.
 */
async function ensureWorkflowLoaded(workflowId: string, runCtx: any): Promise<{ ok: boolean; error?: string }> {
  const id = String(workflowId || '').trim();
  if (!id) return { ok: false, error: 'workflow_id is required.' };
  if (getWorkflowById(id)) return { ok: true };
  if (!hasClientBridge()) {
    return {
      ok: false,
      error: `Workflow "${id}" isn't loaded and the desktop app is offline, so it can't be fetched. Open Stuard and retry.`,
    };
  }
  const res: any = await (loadWorkflow as any).execute({ workflowId: id }, runCtx);
  if (!res?.ok) return { ok: false, error: res?.error || `Could not load workflow "${id}".` };
  return { ok: true };
}

// ── stuard_create_workflow ───────────────────────────────────────────────────
// Compose-and-persist: the client hands over the graph spec it designed (not a
// natural-language brief). Seeds the session + workflowMap and saves to the
// user's Automations tab in one shot, so follow-up read/modify address it by id.
export const stuard_create_workflow = createTool({
  id: 'stuard_create_workflow',
  description:
    'Create a NEW Stuard workflow from a spec YOU compose, and persist it. You are the architect: pass the graph as { id?, name, triggers[], nodes[], wires[] } — node ids, tool names, args, and wires you chose. It is saved to the user\'s Automations tab and becomes addressable by id for stuard_read_workflow / stuard_modify_workflow / stuard_deploy_workflow. You can start minimal (e.g. just the trigger) and build the rest with stuard_modify_workflow. Ground yourself first with stuard_search_workflow_docs + stuard_search_workflow_nodes. Requires the desktop app online to persist. Node shape: { id, tool, label?, args, position? }. Trigger shape: { id, type, args, label?, position? } (e.g. type "schedule.cron" with args { cron: "30 12 * * *" }). Wire shape: { from, to, guard?, loop?, callNode? }.',
  inputSchema: z.object({
    spec: z
      .object({
        id: z.string().optional().describe('Unique flow id (e.g. "flow_chinese_practice"). Auto-generated if omitted.'),
        name: z.string().optional().describe('Display name shown in Automations.'),
      })
      .loose()
      .describe('The workflow spec: { id?, name, triggers[], nodes[], wires[] }.'),
  }),
  execute: async (inputData, runCtx) => {
    const raw = inputData as { spec?: any };
    const spec = raw?.spec && typeof raw.spec === 'object' ? { ...raw.spec } : {};
    if (!spec.id || typeof spec.id !== 'string') {
      spec.id = `flow_${Math.random().toString(36).slice(2, 10)}`;
    }
    return (createWorkflowTool as any).execute({ spec }, runCtx);
  },
});

// ── stuard_read_workflow ─────────────────────────────────────────────────────
export const stuard_read_workflow = createTool({
  id: 'stuard_read_workflow',
  description:
    'Read a workflow as compact DSL, and optionally validate its topology. mode="outline" = one line per node (id = tool) + every wire — the cheap map; start here. mode="window" + focus_ids = full args for those nodes and their neighbours; read right before editing a node. mode="node" + focus_ids = those nodes with every string arg shown VERBATIM (real newlines, tagged with its edit_node_text path) — use it to read a custom_ui component / inline script / long prompt before editing it, instead of reading the .stuard file. mode="full" = the whole DSL (small flows only). validate=true also returns a topology check (cycles, orphans, dangling wires, missing tools) + a labelled schematic — run after structural edits and before deploy.',
  inputSchema: z.object({
    workflow_id: z.string().min(1).describe('The workflow id (from stuard_create_workflow or stuard_list_workflows).'),
    mode: z.enum(['outline', 'window', 'node', 'full']).optional().default('outline'),
    focus_ids: z.array(z.string()).optional().describe('Node/trigger ids to show in full (required for mode="window" and mode="node").'),
    validate: z.boolean().optional().describe('Also return a topology validation + schematic.'),
  }),
  execute: async (inputData, runCtx) => {
    const { workflow_id, mode = 'outline', focus_ids = null, validate = false } = inputData as any;
    const loaded = await ensureWorkflowLoaded(workflow_id, runCtx);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    return (readWorkflow as any).execute(
      { workflowId: workflow_id, mode, focusIds: Array.isArray(focus_ids) ? focus_ids : null, validate: !!validate },
      runCtx,
    );
  },
});

// ── stuard_modify_workflow ───────────────────────────────────────────────────
// Structured edits, auto-persisted (the route marks this path with __subagentKind
// so modify_workflow saves to disk instead of waiting for a canvas Save button).
export const stuard_modify_workflow = createTool({
  id: 'stuard_modify_workflow',
  description:
    'Apply structured edits to a workflow and persist them. You are the architect — pass the op(s), never the whole JSON. Prefer a batch "ops":[...] (applied in order; give a new node an "id" to wire to it in the same batch). Ops: add_node { tool, args, connectFrom?, id?, label? } (or a TRIGGER via { triggerType, triggerArgs }); update_node { nodeId, …one of args|path+value|label|tool }; edit_node_text { nodeId, old_string, new_string, path?, replace_all? } (best for large string args like a custom_ui component); remove_node { nodeId }; add_wire / remove_wire { from, to, guard?, loop?, loopBreak?, callNode? }; update_wire (set/clear wire props in place); set_path { path, value }; add_variable { varName, varType, varDefault }; rename { name }. See stuard_search_workflow_docs("modify_workflow") for the full reference + pitfalls.',
  inputSchema: z.object({
    workflow_id: z.string().min(1).describe('The workflow id to edit.'),
    ops: z
      .array(z.object({ op: z.string().describe('Operation name, e.g. "add_node".') }).loose())
      .optional()
      .describe('Batch of ops applied in order (preferred). Each item is { op, …params }.'),
    op: z
      .object({ op: z.string().describe('Operation name, e.g. "add_node".') })
      .loose()
      .optional()
      .describe('A single op (alternative to ops). Use ops for multi-step builds.'),
  }),
  execute: async (inputData, runCtx) => {
    const { workflow_id, ops, op } = inputData as any;
    const opsList = Array.isArray(ops) && ops.length > 0 ? ops : (op && typeof op === 'object' ? [op] : []);
    if (opsList.length === 0) {
      return { ok: false, error: 'Provide "ops" (a non-empty array) or "op" (a single { op, …params } object).' };
    }
    const loaded = await ensureWorkflowLoaded(workflow_id, runCtx);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    return (workflowModifyTool as any).execute({ workflowId: workflow_id, ops: opsList }, runCtx);
  },
});

// ── stuard_deploy_workflow ───────────────────────────────────────────────────
export const stuard_deploy_workflow = createTool({
  id: 'stuard_deploy_workflow',
  description:
    'Activate a saved workflow so its triggers actually run (e.g. a schedule.cron trigger starts firing). Pass the workflow id and target(s): ["desktop"] enables autostart on the user\'s machine, ["vm"] pushes it to their Cloud VM, ["desktop","vm"] does both. VM deploys reject desktop-only nodes (mouse/keyboard/screen/custom_ui). Set undeploy:true to stop a desktop autostart. Build + validate (stuard_read_workflow validate:true) before deploying.',
  inputSchema: z.object({
    workflow_id: z.string().min(1).describe('The workflow id to deploy.'),
    targets: z.array(z.enum(['desktop', 'vm'])).min(1).optional().default(['desktop']).describe('Deploy targets. Default ["desktop"].'),
    undeploy: z.boolean().optional().default(false).describe('Set true to stop/undeploy instead of deploy (desktop only).'),
  }),
  execute: async (inputData, runCtx) => {
    const { workflow_id, targets = ['desktop'], undeploy = false } = inputData as any;
    const loaded = await ensureWorkflowLoaded(workflow_id, runCtx);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    return (deployWorkflow as any).execute({ workflowId: workflow_id, targets, undeploy }, runCtx);
  },
});

// ── stuard_list_workflows ────────────────────────────────────────────────────
// Find existing workflows (id, name, description) so the client can pick one to
// read/modify. Wraps the Workflow Architect's search_workflows (bridge → local store).
export const stuard_list_workflows = createTool({
  id: 'stuard_list_workflows',
  description:
    "List or search the user's saved Stuard workflows. Returns id, name, and description. Use this to find a workflow_id before reading or editing one with stuard_read_workflow / stuard_modify_workflow. Requires the desktop app online.",
  inputSchema: z.object({
    query: z.string().optional().describe('Name, id, or natural-language description. Omit to list recent workflows.'),
    mode: z.enum(['semantic', 'lexical']).optional().describe('semantic = meaning match (default); lexical = exact text/name/id.'),
    limit: z.number().optional().default(10).describe('Max results (1–50).'),
  }),
  execute: async (inputData, runCtx) => {
    return (searchWorkflows as any).execute(inputData, runCtx);
  },
});

export const MCP_SERVER_TOOLS = {
  stuard_search_tools,
  stuard_execute_tool,
  stuard_ask,
  stuard_status,
  stuard_inbox,
  stuard_search_workflow_nodes,
  stuard_search_workflow_docs,
  stuard_get_node_schema,
  stuard_list_workflows,
  stuard_create_workflow,
  stuard_read_workflow,
  stuard_modify_workflow,
  stuard_deploy_workflow,
};
