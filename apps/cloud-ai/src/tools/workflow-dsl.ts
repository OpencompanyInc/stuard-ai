/**
 * DSL READ/EDIT TOOLS — the token-lean path for inspecting and editing workflows.
 *
 * The agent's old loop (inspect overview → inspect N nodes → search → modify →
 * inspect again) re-sends the fat prefix and whole-flow payloads over ~10-15
 * turns, costing 300K-1.5M tokens for one edit. These two tools collapse that to
 * outline → read_window → edit:
 *   • read_workflow  — returns a dense DSL projection (outline | window | full).
 *     A window is FLAT ~90 tokens regardless of flow size.
 *   • edit_workflow  — anchored find/replace (or full-content) over that DSL.
 *
 * RELIABILITY: the JSON DesignerModel stays the source of truth. edit_workflow
 * parses the edited DSL and MERGES by identity onto the current model, so
 * positions, icons and rare fields survive — the canvas/drag-and-drop never
 * loses data. (See packages/workflow-core/src/dsl.ts.)
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { serializeWorkflow, applyDslEdit, applyDslContent } from '@stuardai/workflow-core/dsl';
import { analyzeWorkflowTopology, formatWorkflowSchematic } from '@stuardai/workflow-core/topology';
import { getSessionWorkflow, setSessionWorkflow, getWorkflowById, loadSubWorkflowFile } from './workflow';
import { workflowMap } from './workflow-system';
import { safeToolWrite, getBridgeSecrets, hasClientBridge, execLocalTool } from './bridge';
import { validateNodeTools, formatNodeIssuesSummary } from './workflow-node-validation';
import { writeLog } from '../utils/logger';

function dslLog(event: string, data?: any) {
  console.log(`[workflow-dsl] ${event}`, data ? JSON.stringify(data) : '');
  writeLog('workflow_dsl_' + event, data);
}

/** Resolve the workflow being edited: explicit id → session → lone map entry. */
function resolveWorkflow(workflowId?: string | null): any | null {
  if (typeof workflowId === 'string' && workflowId) {
    const byId = getWorkflowById(workflowId);
    if (byId) return byId;
  }
  const session = getSessionWorkflow();
  if (session) return session;
  if (workflowMap.size === 1) return Array.from(workflowMap.values())[0];
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// read_workflow
// ════════════════════════════════════════════════════════════════════════════
export const readWorkflow = createTool({
  id: 'read_workflow',
  description:
    'Read the workflow as a compact DSL, and optionally validate it. The single read/inspect tool.\n' +
    '  mode="outline" → one line per node (id = tool) + all wires. The cheap MAP; start here.\n' +
    '  mode="window"  → full args for focusIds + 1-hop neighbours + incident wires. ~Flat cost on any size; read right before editing a node.\n' +
    '  mode="full"    → the entire DSL (small flows / full rewrite only).\n' +
    '  validate=true  → also return a topology check (cycles, orphans, dangling wires, missing tools) + labelled schematic. Use after structural edits or before deploy.\n' +
    '  stuardFile     → read a sub-workflow .stuard FILE from the workspace instead of the main flow.\n' +
    'DSL: `id = tool {json-args} @label "x"`, wires `from -> to @guard {..} @loop {..}`. Data flows via {{stepId.field}}. Long string args show as `…(Nc)…` — edit with modify_workflow edit_node_text.',
  inputSchema: z.object({
    mode: z.enum(['outline', 'window', 'full']),
    focusIds: z.array(z.string()).nullable().describe('Node/trigger ids shown in full (required for mode="window").'),
    validate: z.boolean().nullable().optional().describe('Also return topology validation + schematic.'),
    stuardFile: z.string().nullable().optional().describe('Sub-workflow .stuard file to read instead of the main flow.'),
    workflowId: z.string().nullable().describe('Explicit workflow id; defaults to the session workflow.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    dsl: z.string().optional(),
    counts: z.any().optional(),
    validation: z.any().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const raw = inputData as any;
    const mode = raw?.mode || 'outline';
    const focusIds = Array.isArray(raw?.focusIds) ? raw.focusIds.filter((s: any) => typeof s === 'string' && s) : [];
    const workflowId = typeof raw?.workflowId === 'string' && raw.workflowId ? raw.workflowId : null;
    const stuardFile = typeof raw?.stuardFile === 'string' && raw.stuardFile.trim() ? raw.stuardFile.trim() : null;
    const validate = raw?.validate === true;
    dslLog('read', { mode, focusIds, workflowId, stuardFile, validate });

    // Sub-workflow file read: load the .stuard from the workspace instead of the
    // session/canvas flow (the capability inspect_workflow used to own).
    let wf: any;
    if (stuardFile) {
      const mainId = getSessionWorkflow()?.id;
      const loaded = await loadSubWorkflowFile(stuardFile, mainId, writer);
      if ('error' in loaded) return { ok: false, error: loaded.error };
      wf = loaded.workflow;
    } else {
      wf = resolveWorkflow(workflowId);
    }
    if (!wf) return { ok: false, error: 'No workflow is loaded in this session.' };
    if (mode === 'window' && focusIds.length === 0) {
      return { ok: false, error: 'mode="window" needs focusIds (the node ids you want to see in detail). Use mode="outline" first to find them.' };
    }

    const dsl = serializeWorkflow(wf, {
      mode,
      focusIds,
      abbreviateOver: mode === 'window' ? 800 : (mode === 'full' ? 1200 : undefined),
    });

    // Topology validation folded in from the former inspect_workflow.
    let validation: any;
    let summary: string | undefined;
    if (validate) {
      const analysis = analyzeWorkflowTopology(wf);
      validation = analysis.validation;
      summary = formatWorkflowSchematic(wf, { validationIssues: analysis.validation.issues });
    }

    return {
      ok: true,
      dsl,
      counts: { nodes: wf.nodes?.length || 0, wires: wf.wires?.length || 0, triggers: wf.triggers?.length || 0 },
      ...(validation ? { validation, summary } : {}),
    };
  },
});

// ════════════════════════════════════════════════════════════════════════════
// edit_workflow
// ════════════════════════════════════════════════════════════════════════════
export const editWorkflow = createTool({
  id: 'edit_workflow',
  description:
    'Edit the workflow by find/replace over its DSL (token-lean — prefer this over modify_workflow for most edits). Read a window first so your anchor matches exactly.\n' +
    '  • Anchored edit: old_string (exact text from the DSL) + new_string. old_string must be unique unless replace_all.\n' +
    '    – change an arg:   old_string `"channel":"#digest"`  new_string `"channel":"#news"`\n' +
    '    – add a node+wire: anchor on a wire line and expand it, e.g. old `a -> b` new `a -> send\\n  send = gmail_send {"to":"x"}\\n  send -> b`\n' +
    '    – remove a feature: delete its annotation, e.g. old ` @guard {"if":"x>1"}` new ``\n' +
    '  • Full rewrite: pass content = a complete DSL document (for generating a new flow).\n' +
    'Node/trigger positions, icons and unseen fields are preserved automatically. To edit a long string arg shown as `…(Nc)…`, use modify_workflow edit_node_text instead.',
  inputSchema: z.object({
    old_string: z.string().nullable().describe('Exact DSL text to find. Anchored-edit mode.'),
    new_string: z.string().nullable().describe('Replacement text (empty deletes). Used with old_string.'),
    content: z.string().nullable().describe('A complete new DSL document. Full-rewrite mode (ignores old_string/new_string).'),
    replace_all: z.boolean().nullable().describe('Replace every occurrence of old_string (default false — fails if not unique).'),
    workflowId: z.string().nullable().describe('Optional explicit workflow id; defaults to the session workflow.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflowId: z.string().optional(),
    message: z.string().optional(),
    changed: z.array(z.string()).optional(),
    window: z.string().optional(),
    nodeIssues: z.any().optional(),
    error: z.string().optional(),
    workflow: z.any().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const raw = inputData as any;
    const oldString = typeof raw?.old_string === 'string' ? raw.old_string : '';
    const newString = typeof raw?.new_string === 'string' ? raw.new_string : '';
    const content = typeof raw?.content === 'string' && raw.content.trim() ? raw.content : '';
    const replaceAll = raw?.replace_all === true;
    const workflowId = typeof raw?.workflowId === 'string' && raw.workflowId ? raw.workflowId : null;
    dslLog('edit', { mode: content ? 'content' : 'anchored', replaceAll, workflowId, oldLen: oldString.length });

    const base = resolveWorkflow(workflowId);
    if (!base) return { ok: false, error: 'No workflow is loaded in this session.' };

    const res = content
      ? applyDslContent(base, content)
      : (oldString ? applyDslEdit(base, oldString, newString, replaceAll)
        : { ok: false as const, error: 'Provide either old_string (anchored edit) or content (full rewrite).' });

    if (!res.ok || !res.model) return { ok: false, error: res.error || 'Edit failed.' };

    const model = res.model;
    const changed = res.changedIds || [];

    // Commit: store the fresh model so the canvas repaints by id (attachWorkflowForClient).
    setSessionWorkflow(model);

    // Sanity-check tools (flags hallucinated / invalid node tools).
    const nodeIssues = validateNodeTools(model);
    const issuesSummary = formatNodeIssuesSummary(nodeIssues);
    const message = `Edited workflow (${changed.length} element${changed.length === 1 ? '' : 's'} changed: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? '…' : ''})${issuesSummary}`;

    // A small DSL window of what changed — flat token cost, lets the model verify
    // its edit without re-reading the whole flow.
    const window = changed.length
      ? serializeWorkflow(model, { mode: 'window', focusIds: changed, abbreviateOver: 800 })
      : undefined;

    // UI channel: hand the canvas the FULL model so it repaints (positions intact).
    const hasWriter = !!(writer && typeof (writer as any).write === 'function');
    await safeToolWrite(writer as any, {
      type: 'tool_event',
      tool: 'edit_workflow',
      status: 'completed',
      workflowId: model.id,
      result: { ok: true, workflowId: model.id, message, workflow: model },
    });

    // Subagent runs have no "Save" button — persist immediately (parity with modify_workflow).
    const secrets = getBridgeSecrets();
    const inSubagent = !!secrets && typeof (secrets as any).__subagentKind === 'string';
    if (inSubagent && hasClientBridge()) {
      try {
        await execLocalTool('import_workflow', { definition: model }, writer as any, 15000, { silent: true, noFallback: true });
      } catch (e: any) {
        dslLog('subagent_persist_failed', { id: model.id, error: e?.message });
      }
    }

    dslLog('edit_done', { workflowId: model.id, changed });
    return {
      ok: true,
      workflowId: model.id,
      message,
      changed,
      window,
      nodeIssues: nodeIssues.length > 0 ? nodeIssues : undefined,
      // Headless/no-writer callers still get the workflow; UI path gets it via attach.
      ...(hasWriter ? {} : { workflow: model }),
    };
  },
});
