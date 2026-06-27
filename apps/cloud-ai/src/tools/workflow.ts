/**
 * WORKFLOW MODIFY TOOL - Clean Rewrite
 *
 * A single, robust tool for modifying workflows.
 * Simple operations, flat parameters, clear errors.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { safeToolWrite, getBridgeState, setBridgeState, execLocalTool, hasClientBridge, getBridgeSecrets } from './bridge';
import { validateNodeTools, formatNodeIssuesSummary } from './workflow-node-validation';
import { workflowMap } from './workflow-system';
import { writeLog } from '../utils/logger';
import {
  analyzeWorkflowTopology,
  getFlowContextById,
  formatWorkflowSchematic,
  type WorkflowElementFlowContext,
} from '@stuardai/workflow-core/topology';
import { geminiSafeJsonValue } from './zod-utils';

// ============================================================================
// Types
// ============================================================================

interface Position { x: number; y: number }

interface WorkflowNode {
  id: string;
  tool: string;
  label: string;
  args: Record<string, any>;
  position: Position;
  type?: string;
  fallbackTo?: string;
  waitForAll?: boolean;
}

interface WorkflowTrigger {
  id: string;
  type: string;
  label: string;
  args: Record<string, any>;
  position: Position;
}

interface LoopConfig {
  type: 'forEach' | 'repeat' | 'while';
  items?: string;
  itemVar?: string;
  indexVar?: string;
  count?: number;
  conditionText?: string;
  maxIterations?: number;
  delayMs?: number;
}

interface WorkflowWire {
  from: string;
  to: string;
  guard?: any;
  label?: string;
  loop?: LoopConfig;
  loopBreak?: boolean;
}

interface WorkflowVariable {
  name: string;
  type: string;
  defaultValue?: any;
  persistState?: boolean;
}

interface Workflow {
  id: string;
  name: string;
  version: string;
  triggers: WorkflowTrigger[];
  nodes: WorkflowNode[];
  wires: WorkflowWire[];
  variables?: WorkflowVariable[];
  autostart?: boolean;
  [key: string]: any;
}

// ============================================================================
// Helpers
// ============================================================================

function log(event: string, data?: any) {
  console.log(`[modify_workflow] ${event}`, data ? JSON.stringify(data) : '');
  writeLog('modify_workflow_' + event, data);
}

function genId(prefix = 'step'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sanitize a guard object to fix common LLM serialization issues.
 * LLMs sometimes double-quote JSONLogic operators, producing keys like
 * '"=="' (4 chars with embedded quotes) instead of '==' (2 chars).
 * This recursively strips leading/trailing quote characters from object keys
 * that look like they should be JSONLogic operators or "var".
 */
function sanitizeGuard(guard: any): any {
  if (!guard || typeof guard !== 'object') return guard;
  if (guard === 'always') return guard;
  if (Array.isArray(guard)) return guard.map(sanitizeGuard);

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(guard)) {
    // Strip leading/trailing " from keys (e.g. '"=="' → '==', '"var"' → 'var')
    const stripped = key.replace(/^"+|"+$/g, '');
    const cleanKey = stripped || key; // fallback to original if stripping emptied it
    cleaned[cleanKey] = sanitizeGuard(value);
  }
  return cleaned;
}

// ============================================================================
// Diagrammatic Representation Generator
// ============================================================================

/**
 * Generate an ASCII diagram of the workflow structure.
 * Shows triggers, nodes, wires, loops, guards, and parallel branches.
 */
function generateWorkflowDiagram(wf: Workflow): string {
  const lines: string[] = [];
  const triggers = wf.triggers || [];
  const nodes = wf.nodes || [];
  const wires = wf.wires || [];
  const variables = wf.variables || [];

  // Build adjacency map: nodeId -> outgoing wires
  const outgoing = new Map<string, WorkflowWire[]>();
  const incoming = new Map<string, string[]>();

  for (const wire of wires) {
    if (!outgoing.has(wire.from)) outgoing.set(wire.from, []);
    outgoing.get(wire.from)!.push(wire);

    if (!incoming.has(wire.to)) incoming.set(wire.to, []);
    incoming.get(wire.to)!.push(wire.from);
  }

  // Header
  lines.push(`╔══════════════════════════════════════════════════════════════════════╗`);
  lines.push(`║  WORKFLOW: ${wf.name || 'Untitled'}`.padEnd(74) + `║`);
  lines.push(`║  ID: ${wf.id}`.padEnd(74) + `║`);
  lines.push(`╠══════════════════════════════════════════════════════════════════════╣`);

  // Variables summary
  if (variables.length > 0) {
    lines.push(`║  VARIABLES: ${variables.map(v => `${v.name}:${v.type}`).join(', ')}`.padEnd(74) + `║`);
    lines.push(`╠══════════════════════════════════════════════════════════════════════╣`);
  }

  // Flow diagram
  lines.push(`║  FLOW DIAGRAM:`.padEnd(74) + `║`);
  lines.push(`║`.padEnd(74) + `║`);

  // Process each trigger and its chain
  for (const trigger of triggers) {
    const triggerLabel = `[${trigger.type.toUpperCase()}]`;
    const triggerStr = `  ◆ ${trigger.id} ${triggerLabel}`;

    // Check for inputParams
    const inputParams = (trigger as any).inputParams;
    if (inputParams && Array.isArray(inputParams) && inputParams.length > 0) {
      const paramNames = inputParams.map((p: any) => p.name).join(', ');
      lines.push(`║${triggerStr} (inputs: ${paramNames})`.padEnd(74) + `║`);
    } else {
      lines.push(`║${triggerStr}`.padEnd(74) + `║`);
    }

    // Get outgoing wires from this trigger
    const triggerWires = outgoing.get(trigger.id) || [];

    if (triggerWires.length === 0) {
      lines.push(`║     └── (no connections)`.padEnd(74) + `║`);
    } else if (triggerWires.length === 1) {
      const wire = triggerWires[0];
      const wireLabel = formatWireLabel(wire);
      lines.push(`║     │`.padEnd(74) + `║`);
      lines.push(`║     ▼ ${wireLabel}`.padEnd(74) + `║`);
      renderNodeChain(wire.to, '     ', new Set());
    } else {
      // Multiple outgoing wires (parallel or conditional)
      lines.push(`║     │`.padEnd(74) + `║`);
      lines.push(`║     ├──┬── PARALLEL/CONDITIONAL BRANCHES ──┐`.padEnd(74) + `║`);
      for (let i = 0; i < triggerWires.length; i++) {
        const wire = triggerWires[i];
        const wireLabel = formatWireLabel(wire);
        const prefix = i === triggerWires.length - 1 ? '     │  └' : '     │  ├';
        lines.push(`║${prefix}── ${wireLabel} → ${wire.to}`.padEnd(74) + `║`);
      }
      lines.push(`║     │`.padEnd(74) + `║`);
    }
    lines.push(`║`.padEnd(74) + `║`);
  }

  // Render node details
  lines.push(`╠══════════════════════════════════════════════════════════════════════╣`);
  lines.push(`║  NODE DETAILS:`.padEnd(74) + `║`);

  for (const node of nodes) {
    const nodeWires = outgoing.get(node.id) || [];
    const incomingCount = incoming.get(node.id)?.length || 0;

    let nodeIcon = '○';
    if (node.waitForAll) nodeIcon = '◎'; // Convergence point
    if (node.fallbackTo) nodeIcon = '◇'; // Has fallback

    const nodeHeader = `  ${nodeIcon} ${node.id}: ${node.tool || 'noop'}`;
    lines.push(`║${nodeHeader}`.padEnd(74) + `║`);

    // Show label if different from tool
    if (node.label && node.label !== node.tool) {
      lines.push(`║      label: "${node.label}"`.padEnd(74) + `║`);
    }

    // Show key args (abbreviated)
    if (node.args && Object.keys(node.args).length > 0) {
      const argKeys = Object.keys(node.args).slice(0, 3);
      const argsStr = argKeys.map(k => `${k}: ${abbrev(node.args[k])}`).join(', ');
      lines.push(`║      args: { ${argsStr} }`.padEnd(74) + `║`);
    }

    // Show incoming count for convergence points
    if (incomingCount > 1) {
      const converge = node.waitForAll ? ' [WAITS FOR ALL]' : ' [FIRST WINS]';
      lines.push(`║      ← ${incomingCount} incoming branches${converge}`.padEnd(74) + `║`);
    }

    // Show outgoing wires
    if (nodeWires.length > 0) {
      for (const wire of nodeWires) {
        const wireLabel = formatWireLabel(wire);
        lines.push(`║      → ${wire.to} ${wireLabel}`.padEnd(74) + `║`);
      }
    } else {
      lines.push(`║      → (END)`.padEnd(74) + `║`);
    }
  }

  lines.push(`╚══════════════════════════════════════════════════════════════════════╝`);

  // Helper function to format wire labels
  function formatWireLabel(wire: WorkflowWire): string {
    const parts: string[] = [];

    if (wire.loop) {
      if (wire.loop.type === 'forEach') {
        parts.push(`🔄forEach(${wire.loop.items || 'items'})`);
      } else if (wire.loop.type === 'repeat') {
        parts.push(`🔄repeat(${wire.loop.count || '?'}x)`);
      } else if (wire.loop.type === 'while') {
        parts.push(`🔄while(${wire.loop.conditionText || 'cond'})`);
      }
    }

    if (wire.loopBreak) {
      parts.push(`⏹️loopBreak`);
    }

    if (wire.guard) {
      if (typeof wire.guard === 'object' && wire.guard.if) {
        const guardStr = typeof wire.guard.if === 'string'
          ? wire.guard.if
          : JSON.stringify(wire.guard.if).slice(0, 20);
        parts.push(`[if: ${guardStr}]`);
      } else if (typeof wire.guard === 'object' && wire.guard.ai) {
        parts.push(`[AI: ${abbrev(wire.guard.ai.instruction || 'route')}]`);
      }
    }

    if (wire.label) {
      parts.push(`"${wire.label}"`);
    }

    return parts.join(' ');
  }

  // Helper to abbreviate long values
  function abbrev(val: any, maxLen = 15): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'string') {
      return val.length > maxLen ? val.slice(0, maxLen) + '...' : val;
    }
    if (typeof val === 'object') {
      const str = JSON.stringify(val);
      return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
    }
    return String(val);
  }

  // Helper to render node chain (for simple linear flows)
  function renderNodeChain(nodeId: string, indent: string, visited: Set<string>) {
    if (visited.has(nodeId)) {
      lines.push(`║${indent}⟲ (back to ${nodeId})`.padEnd(74) + `║`);
      return;
    }
    visited.add(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const nodeIcon = node.waitForAll ? '◎' : '○';
    lines.push(`║${indent}${nodeIcon} ${node.id} [${node.tool || 'noop'}]`.padEnd(74) + `║`);

    const nodeWires = outgoing.get(nodeId) || [];
    if (nodeWires.length === 0) {
      lines.push(`║${indent}   └── (END)`.padEnd(74) + `║`);
    } else if (nodeWires.length === 1) {
      const wire = nodeWires[0];
      const wireLabel = formatWireLabel(wire);
      if (wireLabel) {
        lines.push(`║${indent}   │ ${wireLabel}`.padEnd(74) + `║`);
      }
      lines.push(`║${indent}   ▼`.padEnd(74) + `║`);
      renderNodeChain(wire.to, indent + '   ', visited);
    } else {
      // Multiple branches
      lines.push(`║${indent}   ├──┬── BRANCHES ──┐`.padEnd(74) + `║`);
      for (let i = 0; i < nodeWires.length; i++) {
        const wire = nodeWires[i];
        const wireLabel = formatWireLabel(wire);
        const prefix = i === nodeWires.length - 1 ? '   │  └' : '   │  ├';
        lines.push(`║${indent}${prefix}── ${wireLabel} → ${wire.to}`.padEnd(74) + `║`);
      }
    }
  }

  return lines.join('\n');
}

function cloneWorkflow(wf: any): Workflow {
  const copy = JSON.parse(JSON.stringify(wf));
  // Ensure arrays exist
  if (!Array.isArray(copy.triggers)) copy.triggers = [];
  if (!Array.isArray(copy.nodes)) copy.nodes = [];
  if (!Array.isArray(copy.wires)) copy.wires = [];
  if (!copy.id) copy.id = genId('flow');
  if (!copy.name) copy.name = 'Untitled';
  if (!copy.version) copy.version = '1';
  return copy as Workflow;
}

function nextPosition(wf: Workflow, type: 'node' | 'trigger'): Position {
  const items = type === 'node' ? wf.nodes : wf.triggers;
  if (!items?.length) return type === 'trigger' ? { x: 80, y: 120 } : { x: 300, y: 120 };
  const maxX = Math.max(...items.map(i => i.position?.x || 0));
  return { x: maxX + 280, y: items[0]?.position?.y || 120 };
}

function nodeIndex(wf: Workflow, id: string): number {
  return wf.nodes.findIndex(n => n.id === id);
}

function triggerIndex(wf: Workflow, id: string | number): number {
  if (typeof id === 'number') return id >= 0 && id < wf.triggers.length ? id : -1;
  return wf.triggers.findIndex(t => t.id === id);
}

function elementExists(wf: Workflow, id: string): boolean {
  return nodeIndex(wf, id) >= 0 || triggerIndex(wf, id) >= 0;
}

// Simple dot-path getter: "triggers[0].args.sequence" -> value
function getPath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const p of parts) {
    if (current == null) return undefined;
    current = current[p];
  }
  return current;
}

// Find every dot-path under `obj` whose string value CONTAINS `needle`.
// Used by edit_node_text to auto-locate the single string field to edit when
// the caller doesn't pass an explicit path. Returns one entry per matching
// FIELD (not per occurrence), e.g. ["args.component"] or ["args.message", "args.title"].
function findStringPaths(obj: any, prefix: string, needle: string): string[] {
  const out: string[] = [];
  const walk = (val: any, path: string) => {
    if (typeof val === 'string') {
      if (val.includes(needle)) out.push(path);
    } else if (Array.isArray(val)) {
      val.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (val && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) walk(v, `${path}.${k}`);
    }
  };
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) walk(v, `${prefix}.${k}`);
  }
  return out;
}

// Trigger root-level fields. Anything else passed via args/triggerArgs or
// a bare path (e.g. path: "inputParams") gets routed under trigger.args by
// default, so we explicitly hoist these to the trigger root to avoid them
// showing up as custom args properties in the inspector.
const TRIGGER_ROOT_FIELDS = new Set(['id', 'type', 'label', 'position', 'inputParams']);

function hoistTriggerRootFields(
  trigger: any,
  bag: Record<string, any> | undefined | null,
): Record<string, any> | null {
  if (!bag || typeof bag !== 'object') return null;
  const remaining: Record<string, any> = {};
  let hoisted = false;
  for (const [k, v] of Object.entries(bag)) {
    if (TRIGGER_ROOT_FIELDS.has(k)) {
      trigger[k] = v;
      hoisted = true;
    } else {
      remaining[k] = v;
    }
  }
  return hoisted ? remaining : null;
}

// Simple dot-path setter: "triggers[0].args.sequence" = value
function setPath(obj: any, path: string, value: any): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (current[p] == null) {
      // Create array if next part is numeric, else object
      current[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    current = current[p];
  }
  current[parts[parts.length - 1]] = value;
}

function addTouchedId(touchedIds: Set<string>, id?: string | null): void {
  if (typeof id === 'string' && id.trim()) {
    touchedIds.add(id);
  }
}

function addWireEndpoints(touchedIds: Set<string>, wire: any): void {
  if (!wire || typeof wire !== 'object') return;
  addTouchedId(touchedIds, typeof wire.from === 'string' ? wire.from : undefined);
  addTouchedId(touchedIds, typeof wire.to === 'string' ? wire.to : undefined);
}

function addTouchedIdsFromPath(
  touchedIds: Set<string>,
  path: string,
  beforeWorkflow: Workflow,
  afterWorkflow: Workflow,
): void {
  if (!path) return;

  const nodeMatch = path.match(/^nodes\[(\d+)\]/);
  if (nodeMatch) {
    const index = Number(nodeMatch[1]);
    addTouchedId(touchedIds, afterWorkflow.nodes[index]?.id || beforeWorkflow.nodes[index]?.id);
    return;
  }

  const triggerMatch = path.match(/^triggers\[(\d+)\]/);
  if (triggerMatch) {
    const index = Number(triggerMatch[1]);
    addTouchedId(touchedIds, afterWorkflow.triggers[index]?.id || beforeWorkflow.triggers[index]?.id);
    return;
  }

  const wireMatch = path.match(/^wires\[(\d+)\]/);
  if (wireMatch) {
    const index = Number(wireMatch[1]);
    addWireEndpoints(touchedIds, beforeWorkflow.wires[index]);
    addWireEndpoints(touchedIds, afterWorkflow.wires[index]);
    return;
  }

  if (path === 'wires' || path.startsWith('wires.')) {
    for (const wire of beforeWorkflow.wires) addWireEndpoints(touchedIds, wire);
    for (const wire of afterWorkflow.wires) addWireEndpoints(touchedIds, wire);
    return;
  }

  if (path === 'nodes' || path.startsWith('nodes.')) {
    for (const node of beforeWorkflow.nodes) addTouchedId(touchedIds, node.id);
    for (const node of afterWorkflow.nodes) addTouchedId(touchedIds, node.id);
    return;
  }

  if (path === 'triggers' || path.startsWith('triggers.')) {
    for (const trigger of beforeWorkflow.triggers) addTouchedId(touchedIds, trigger.id);
    for (const trigger of afterWorkflow.triggers) addTouchedId(touchedIds, trigger.id);
  }
}

function buildRemovedContext(id: string, beforeContext: WorkflowElementFlowContext | null): WorkflowElementFlowContext {
  if (beforeContext) {
    return {
      ...beforeContext,
      exists: false,
      removed: true,
    };
  }

  return {
    id,
    kind: id.startsWith('trig_') ? 'trigger' : 'node',
    exists: false,
    removed: true,
    predecessorIds: [],
    successorIds: [],
    incomingWires: [],
    outgoingWires: [],
    startAdjacent: false,
    terminal: true,
    waitForAll: false,
  };
}

function buildAffectedFlowReport(
  beforeWorkflow: Workflow,
  afterWorkflow: Workflow,
  touchedIds: Set<string>,
): { touchedIds: string[]; contexts: WorkflowElementFlowContext[] } {
  const beforeAnalysis = analyzeWorkflowTopology(beforeWorkflow);
  const afterAnalysis = analyzeWorkflowTopology(afterWorkflow);
  const orderedIds = Array.from(touchedIds);

  const contexts = orderedIds.map((id) => {
    const afterContext = getFlowContextById(afterAnalysis, id);
    if (afterContext) return afterContext;

    const beforeContext = getFlowContextById(beforeAnalysis, id);
    return buildRemovedContext(id, beforeContext);
  });

  return {
    touchedIds: orderedIds,
    contexts,
  };
}

// ============================================================================
// Session-scoped workflow storage
// ============================================================================

// Allows modify_workflow to work without passing full JSON.
// Uses AsyncLocalStorage (via bridge state) for per-request isolation to prevent
// cross-tab bleeding when concurrent requests share the same server process.
// Module-level fallback is kept for non-request contexts (tests, direct calls).
const _BRIDGE_KEY = '__sessionWorkflow';
let _sessionWorkflowFallback: Workflow | null = null;

export function setSessionWorkflow(wf: any): void {
  if (wf && typeof wf === 'object') {
    const cloned = cloneWorkflow(wf);
    // Per-request isolation via AsyncLocalStorage
    setBridgeState(_BRIDGE_KEY, cloned);
    // Module-level fallback for non-request contexts
    _sessionWorkflowFallback = cloned;
    if (cloned.id) {
      workflowMap.set(cloned.id, cloned);
    }
    log('session_workflow_set', { id: cloned.id });
  }
}

export function getSessionWorkflow(): Workflow | null {
  // Prefer ALS (per-request isolation) to prevent cross-tab bleeding
  const alsWorkflow = getBridgeState<Workflow>(_BRIDGE_KEY);
  if (alsWorkflow) return alsWorkflow;
  // Fallback to module-level for non-request contexts
  return _sessionWorkflowFallback;
}

export function clearSessionWorkflow(): void {
  setBridgeState(_BRIDGE_KEY, null);
  _sessionWorkflowFallback = null;
}

/**
 * Resolve a workflow by id from the shared module-level map.
 *
 * Why this exists: workflow-agent tools run inside their OWN withClientBridge
 * (a fresh `state` Map — see agents/workflow-agent/index.ts), so a tool's
 * `setBridgeState(_BRIDGE_KEY, wf)` write lands in a throwaway store and never
 * reaches the request-level ALS that the stream relay reads. The relay's
 * `getSessionWorkflow()` therefore returns the PRE-edit workflow that
 * prepare-chat-request stored, which would clobber the canvas with stale data.
 * The tool always also `workflowMap.set(wf.id, wf)`, so keying off the workflow
 * id gives the freshly-modified copy while staying isolated per workflow (no
 * cross-tab bleeding the way the bare module fallback would risk).
 */
export function getWorkflowById(id: string): Workflow | null {
  if (!id || typeof id !== 'string') return null;
  const fromMap = workflowMap.get(id);
  return fromMap && typeof fromMap === 'object' ? (fromMap as Workflow) : null;
}

// ============================================================================
// Sub-workflow (.stuard) file targeting
// ============================================================================
//
// To make `stuardFile` targeting real (instead of silently editing the main
// canvas workflow), inspect_workflow/modify_workflow resolve a relative path
// like "helpers/send-email.stuard" to a concrete file in the studio's on-disk
// workspace. The server records the workspace root for the active flow from the
// incoming chat context (prepare-chat-request.ts), keyed by flow id so
// concurrent studio sessions stay isolated.

const _workspacePathByFlow = new Map<string, string>();

export function setWorkflowWorkspacePath(flowId: string, workspacePath: string): void {
  if (typeof flowId === 'string' && flowId && typeof workspacePath === 'string' && workspacePath) {
    _workspacePathByFlow.set(flowId, workspacePath);
    log('workspace_path_set', { flowId, workspacePath });
  }
}

export function getWorkflowWorkspacePath(flowId?: string | null): string | undefined {
  // Exact match only — a session always registers its own flow id, and the
  // error-path contract requires an unregistered flow to resolve to nothing.
  if (flowId && _workspacePathByFlow.has(flowId)) return _workspacePathByFlow.get(flowId);
  return undefined;
}

function joinWorkspacePath(root: string, rel: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanRel = rel.replace(/^[\\/]+/, '');
  // Preserve the workspace root's separator style (POSIX vs Windows).
  const sep = cleanRoot.includes('\\') && !cleanRoot.includes('/') ? '\\' : '/';
  return `${cleanRoot}${sep}${cleanRel}`;
}

/**
 * Load a sub-workflow `.stuard` file from the active flow's workspace over the
 * client bridge. A `.stuard` file's contents are the workflow model JSON
 * directly. Returns the parsed workflow plus the resolved paths, or a
 * model-facing error string. Reads via workspace_read_file (workspace-relative);
 * the absolute path is returned for the matching write-back via write_file.
 */
export async function loadSubWorkflowFile(
  stuardFile: string,
  mainId: string | undefined | null,
  writer: any,
): Promise<{ workflow: Workflow; absPath: string; relPath: string } | { error: string }> {
  const rel = typeof stuardFile === 'string' ? stuardFile.trim() : '';
  if (!rel) return { error: 'stuardFile path is empty' };
  if (!hasClientBridge()) {
    return { error: 'No connection to the desktop app — cannot read sub-workflow files from the workspace.' };
  }
  const workspaceRoot = getWorkflowWorkspacePath(mainId);
  if (!workspaceRoot) {
    return {
      error: `Workspace path unknown for this session — open the workflow in the studio so its workspace folder is known, then retry. (stuardFile: ${rel})`,
    };
  }
  // stuardFile must be a relative path inside the workflow workspace — reject
  // absolute paths and any ".." traversal that would escape it.
  const segments = rel.split(/[/\\]/).filter(Boolean);
  const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(rel);
  if (isAbsolute || segments.includes('..')) {
    return { error: `stuardFile must be a relative path inside the workflow workspace (got "${rel}").` };
  }
  const normalizedRel = rel.endsWith('.stuard') ? rel : `${rel}.stuard`;
  const absPath = joinWorkspacePath(workspaceRoot, normalizedRel);
  try {
    const res = await execLocalTool(
      'workspace_read_file',
      { path: normalizedRel },
      writer as any,
      10_000,
      { silent: true, noFallback: true },
    );
    if (!res?.ok || typeof res.content !== 'string') {
      return { error: `Could not read sub-workflow file "${normalizedRel}": ${res?.error || 'file not found'}` };
    }
    let parsed: any;
    try {
      parsed = JSON.parse(res.content);
    } catch (e: any) {
      return { error: `Sub-workflow file "${normalizedRel}" is not valid workflow JSON: ${e?.message || 'parse error'}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `Sub-workflow file "${normalizedRel}" is not valid workflow JSON: expected a workflow object.` };
    }
    const workflow = cloneWorkflow(parsed);
    log('sub_workflow_loaded', { stuardFile: normalizedRel, id: workflow.id, nodes: workflow.nodes?.length });
    return { workflow, absPath, relPath: normalizedRel };
  } catch (e: any) {
    return { error: `Could not read sub-workflow file "${normalizedRel}": ${e?.message || 'read failed'}` };
  }
}

/**
 * Write a modified sub-workflow back to its `.stuard` file over the bridge.
 * Returns an error string on failure, or null on success.
 */
export async function saveSubWorkflowFile(absPath: string, wf: Workflow, writer: any): Promise<string | null> {
  try {
    const res = await execLocalTool(
      'write_file',
      {
        path: absPath,
        content: JSON.stringify(wf, null, 2),
        description: 'Save sub-workflow (.stuard) file edited by the workflow agent',
      },
      writer as any,
      10_000,
      { silent: true, noFallback: true },
    );
    if (!res?.ok) return res?.error || 'write_file returned not-ok';
    return null;
  } catch (e: any) {
    return e?.message || 'write_file threw';
  }
}

// ============================================================================
// applyOp — apply a SINGLE operation to a workflow in place.
//
// Shared by both the single-op and batch (`ops: [...]`) code paths. Mutates
// `wf` and records touched element ids. Throws Error on a validation failure
// (caller decides whether that aborts the whole call or is recorded as one
// failed entry in a batch). Returns a human-readable message on success.
// ============================================================================

function applyOp(
  wf: Workflow,
  ctx: any,
  touchedIds: Set<string>,
  beforeWorkflow: Workflow,
): string {
  const op = ctx.op;

  switch (op) {
    // ==================================================================
    // ADD_NODE
    // ==================================================================
    case 'add_node': {
      const { tool, args, label, connectFrom, triggerType, triggerArgs } = ctx;
      // Optional client-specified id. Lets a batch reference a freshly-added
      // node in a later op (e.g. add_wire from it) without knowing the
      // auto-generated id. Ignored if it collides with an existing element.
      const wantId = typeof ctx.id === 'string' && ctx.id.trim() ? ctx.id.trim() : '';

      // If triggerType is provided, add a trigger using the same op (treat trigger as step)
      if (triggerType) {
        const newTrigger: WorkflowTrigger = {
          id: wantId && !elementExists(wf, wantId) ? wantId : genId('trig'),
          type: triggerType,
          label: label || `${triggerType} Trigger`,
          args: {},
          position: nextPosition(wf, 'trigger'),
        };
        // Hoist trigger root fields (e.g. inputParams) out of the args
        // bag so they don't end up as custom args properties.
        const argsBag: Record<string, any> = { ...(triggerArgs || args || {}) };
        const remaining = hoistTriggerRootFields(newTrigger, argsBag);
        newTrigger.args = remaining ?? argsBag;
        wf.triggers.push(newTrigger);
        addTouchedId(touchedIds, newTrigger.id);
        let message = `Added trigger "${newTrigger.label}" (${newTrigger.id})`;

        if (connectFrom && elementExists(wf, connectFrom)) {
          wf.wires.push({ from: newTrigger.id, to: connectFrom });
          addTouchedId(touchedIds, connectFrom);
          message += ` wired to ${connectFrom}`;
        }
        return message;
      }

      if (!tool) throw new Error('tool is required for add_node');

      const newNode: WorkflowNode = {
        id: wantId && !elementExists(wf, wantId) ? wantId : genId('step'),
        tool,
        label: label || tool,
        args: args || {},
        position: nextPosition(wf, 'node'),
      };

      wf.nodes.push(newNode);
      addTouchedId(touchedIds, newNode.id);
      let message = `Added node "${newNode.label}" (${newNode.id})`;

      if (connectFrom && elementExists(wf, connectFrom)) {
        wf.wires.push({ from: connectFrom, to: newNode.id });
        addTouchedId(touchedIds, connectFrom);
        message += ` wired from ${connectFrom}`;
      }
      return message;
    }

    // ==================================================================
    // UPDATE_NODE
    // ==================================================================
    case 'update_node': {
      const nodeId = ctx.nodeId || ctx.stepId;
      const { args, label, tool, triggerType, triggerArgs, path, value } = ctx;
      if (!nodeId) throw new Error('nodeId is required for update_node');
      addTouchedId(touchedIds, nodeId);

      const idx = nodeIndex(wf, nodeId);
      if (idx >= 0) {
        const node = wf.nodes[idx];
        let changed = false;
        let message = '';

        // Support path/value for single-field updates (e.g., path: "args.message", value: "Hello")
        if (path !== undefined && value !== undefined) {
          // path can be "args.message" or just "message" (assumes args)
          const normalizedPath = path.startsWith('args.') ? path :
                                 (path === 'label' || path === 'tool' || path === 'id') ? path : `args.${path}`;
          setPath(node, normalizedPath, value);
          changed = true;
          message = `Updated node "${node.label}": ${normalizedPath} = ${JSON.stringify(value)}`;
        }

        if (args) {
          node.args = { ...node.args, ...args };
          changed = true;
        }
        if (label) {
          node.label = label;
          changed = true;
        }
        if (tool) {
          node.tool = tool;
          changed = true;
        }

        if (!changed) {
          throw new Error(`update_node called for "${nodeId}" but no changes specified. Provide args, label, tool, or path/value.`);
        }

        return message || `Updated node "${node.label}"`;
      }

      // If node not found, try updating a trigger with the same id (treat trigger as step)
      const trigIdx = triggerIndex(wf, nodeId);
      if (trigIdx < 0) throw new Error(`Step not found: ${nodeId}`);

      const trigger = wf.triggers[trigIdx];
      let changed = false;
      let message = '';

      // Support path/value for triggers too. Trigger root fields
      // (label, type, id, position, inputParams) stay at the root;
      // anything else gets nested under args.
      if (path !== undefined && value !== undefined) {
        const head = path.split('.')[0]?.split('[')[0] || '';
        const normalizedPath = path.startsWith('args.') ? path :
                               TRIGGER_ROOT_FIELDS.has(head) ? path : `args.${path}`;
        setPath(trigger, normalizedPath, value);
        changed = true;
        message = `Updated trigger "${trigger.label}": ${normalizedPath} = ${JSON.stringify(value)}`;
      }

      const nextArgs = triggerArgs || args;
      if (nextArgs) {
        // Hoist any root-level trigger fields (e.g. inputParams) that
        // were passed in via args/triggerArgs so they don't pollute
        // trigger.args as custom properties.
        const argsBag: Record<string, any> = { ...nextArgs };
        const remaining = hoistTriggerRootFields(trigger, argsBag);
        trigger.args = { ...trigger.args, ...(remaining ?? argsBag) };
        changed = true;
      }
      if (label) {
        trigger.label = label;
        changed = true;
      }
      const nextType = triggerType || (tool ? String(tool) : undefined);
      if (nextType) {
        trigger.type = nextType;
        changed = true;
      }

      if (!changed) {
        throw new Error(`update_node called for trigger "${nodeId}" but no changes specified. Provide args, triggerArgs, label, triggerType, or path/value.`);
      }

      return message || `Updated trigger "${trigger.label}"`;
    }

    // ==================================================================
    // EDIT_NODE_TEXT — surgical find/replace inside a string arg.
    // The cheap way to edit LARGE text fields (custom_ui component, inline
    // scripts, long prompts) without re-sending the whole string.
    // ==================================================================
    case 'edit_node_text': {
      const nodeId = ctx.nodeId || ctx.stepId;
      const oldString = ctx.old_string;
      const newString = typeof ctx.new_string === 'string' ? ctx.new_string : '';
      const replaceAll = ctx.replace_all === true;
      if (!nodeId) throw new Error('nodeId is required for edit_node_text');
      if (typeof oldString !== 'string' || oldString.length === 0) {
        throw new Error('old_string is required for edit_node_text');
      }
      addTouchedId(touchedIds, nodeId);

      const isNode = nodeIndex(wf, nodeId) >= 0;
      const element: any = isNode
        ? wf.nodes[nodeIndex(wf, nodeId)]
        : (triggerIndex(wf, nodeId) >= 0 ? wf.triggers[triggerIndex(wf, nodeId)] : null);
      if (!element) throw new Error(`Step not found: ${nodeId}`);

      // Resolve which string field to edit.
      let targetPath = typeof ctx.path === 'string' && ctx.path.trim() ? ctx.path.trim() : '';
      if (targetPath) {
        // Same normalization as update_node: bare paths live under args.
        const head = targetPath.split('.')[0]?.split('[')[0] || '';
        const rootFields = isNode ? new Set(['label', 'tool', 'id']) : TRIGGER_ROOT_FIELDS;
        if (!targetPath.startsWith('args.') && !rootFields.has(head)) {
          targetPath = `args.${targetPath}`;
        }
      } else {
        // No path → auto-locate the unique string field containing old_string.
        const matches = findStringPaths(element.args, 'args', oldString);
        if (matches.length === 0) {
          throw new Error(
            `old_string not found in any string field of "${nodeId}". Check the exact text (whitespace/escapes must match) or pass path explicitly.`,
          );
        }
        if (matches.length > 1) {
          throw new Error(
            `old_string found in multiple fields of "${nodeId}": ${matches.join(', ')}. Pass path to disambiguate.`,
          );
        }
        targetPath = matches[0];
      }

      const current = getPath(element, targetPath);
      if (typeof current !== 'string') {
        throw new Error(
          `${targetPath} of "${nodeId}" is not a string (got ${current === undefined ? 'undefined' : typeof current}).`,
        );
      }
      const count = current.split(oldString).length - 1;
      if (count === 0) {
        throw new Error(`old_string not found in ${targetPath} of "${nodeId}". The text must match exactly.`);
      }
      if (count > 1 && !replaceAll) {
        throw new Error(
          `old_string appears ${count} times in ${targetPath} of "${nodeId}". Provide a longer unique string or set replace_all: true.`,
        );
      }
      const updated = replaceAll
        ? current.split(oldString).join(newString)
        : current.replace(oldString, newString);
      setPath(element, targetPath, updated);
      const replacements = replaceAll ? count : 1;
      return `Edited ${targetPath} of "${nodeId}" (${replacements} replacement${replacements === 1 ? '' : 's'}, ${current.length} → ${updated.length} chars)`;
    }

    // ==================================================================
    // REMOVE_NODE
    // ==================================================================
    case 'remove_node': {
      const nodeId = ctx.nodeId || ctx.stepId;
      if (!nodeId) throw new Error('nodeId is required for remove_node');
      addTouchedId(touchedIds, nodeId);
      for (const wire of wf.wires) {
        if (wire.from === nodeId || wire.to === nodeId) {
          addTouchedId(touchedIds, wire.from);
          addTouchedId(touchedIds, wire.to);
        }
      }

      const idx = nodeIndex(wf, nodeId);
      if (idx >= 0) {
        const removed = wf.nodes.splice(idx, 1)[0];
        wf.wires = wf.wires.filter(w => w.from !== nodeId && w.to !== nodeId);
        return `Removed node "${removed.label}"`;
      }

      // If node not found, try removing a trigger with the same id (treat trigger as step)
      const trigIdx = triggerIndex(wf, nodeId);
      if (trigIdx < 0) throw new Error(`Step not found: ${nodeId}`);

      const removedTrigger = wf.triggers.splice(trigIdx, 1)[0];
      wf.wires = wf.wires.filter(w => w.from !== removedTrigger.id && w.to !== removedTrigger.id);
      return `Removed trigger "${removedTrigger.label}"`;
    }

    // ==================================================================
    // ADD_WIRE
    // ==================================================================
    case 'add_wire': {
      const { from, to, guard, loop, loopBreak, loopFanoutMode, stream } = ctx;
      if (!from || !to) throw new Error('from and to are required for add_wire');
      addTouchedId(touchedIds, from);
      addTouchedId(touchedIds, to);

      if (!elementExists(wf, from)) throw new Error(`Source not found: ${from}`);
      if (!elementExists(wf, to)) throw new Error(`Target not found: ${to}`);

      const exists = wf.wires.some(w => w.from === from && w.to === to);
      if (exists) throw new Error(`Wire already exists: ${from} → ${to}. Use op "update_wire" to change its guard/loop/loopBreak.`);

      const wire: WorkflowWire = { from, to };
      if (guard) wire.guard = sanitizeGuard(guard);
      if (loop) wire.loop = loop;
      if (loopBreak) wire.loopBreak = true;
      if (loopFanoutMode) (wire as any).loopFanoutMode = loopFanoutMode;
      if (stream) (wire as any).stream = stream;
      wf.wires.push(wire);

      const extras = [loop ? `loop:${loop.type || '?'}` : null, loopBreak ? 'loopBreak' : null, guard ? 'guard' : null].filter(Boolean);
      return `Connected ${from} → ${to}${extras.length ? ` (${extras.join(', ')})` : ''}`;
    }

    // ==================================================================
    // UPDATE_WIRE — set/clear wire properties (guard, loop, loopBreak,
    // fanout, stream, label) on an existing wire IN PLACE. Upserts the
    // wire if it doesn't exist yet (endpoints must be real). This is the
    // reliable structured path for loops/guards — undefined leaves a prop
    // untouched, null clears it.
    // ==================================================================
    case 'update_wire': {
      const { from, to, guard, loop, loopBreak, loopFanoutMode, stream, label } = ctx;
      if (!from || !to) throw new Error('from and to are required for update_wire');
      addTouchedId(touchedIds, from);
      addTouchedId(touchedIds, to);

      let wire = wf.wires.find(w => w.from === from && w.to === to);
      if (!wire) {
        if (!elementExists(wf, from)) throw new Error(`Source not found: ${from}`);
        if (!elementExists(wf, to)) throw new Error(`Target not found: ${to}`);
        wire = { from, to };
        wf.wires.push(wire);
      }

      const changed: string[] = [];
      if (guard !== undefined) { if (guard === null) delete (wire as any).guard; else wire.guard = sanitizeGuard(guard); changed.push('guard'); }
      if (loop !== undefined) { if (loop === null) delete (wire as any).loop; else wire.loop = loop; changed.push('loop'); }
      if (loopBreak !== undefined) { if (loopBreak) wire.loopBreak = true; else delete (wire as any).loopBreak; changed.push('loopBreak'); }
      if (loopFanoutMode !== undefined) { if (loopFanoutMode === null) delete (wire as any).loopFanoutMode; else (wire as any).loopFanoutMode = loopFanoutMode; changed.push('fanout'); }
      if (stream !== undefined) { if (stream === null) delete (wire as any).stream; else (wire as any).stream = stream; changed.push('stream'); }
      if (label !== undefined) { if (label === null || label === '') delete (wire as any).label; else (wire as any).label = label; changed.push('label'); }

      if (changed.length === 0) throw new Error('update_wire needs at least one of: guard, loop, loopBreak, loopFanoutMode, stream, label');
      return `Updated wire ${from} → ${to} (${changed.join(', ')})`;
    }

    // ==================================================================
    // REMOVE_WIRE
    // ==================================================================
    case 'remove_wire': {
      const { from, to } = ctx;
      if (!from || !to) throw new Error('from and to are required for remove_wire');
      addTouchedId(touchedIds, from);
      addTouchedId(touchedIds, to);

      const idx = wf.wires.findIndex(w => w.from === from && w.to === to);
      if (idx < 0) throw new Error(`Wire not found: ${from} → ${to}`);

      wf.wires.splice(idx, 1);
      return `Disconnected ${from} → ${to}`;
    }

    // ==================================================================
    // SET_PATH (direct JSON edit)
    // ==================================================================
    case 'set_path': {
      const { path, value } = ctx;
      if (!path) throw new Error('path is required for set_path');
      if (value === undefined) throw new Error('value is required for set_path');

      // Agents sometimes hand us a JSON-stringified array/object instead
      // of the real value (e.g. value: '[{...}]'). Auto-parse so the
      // session workflow holds the structured form, which the renderer
      // and persistence layers expect.
      let coercedValue = value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && (trimmed[0] === '[' || trimmed[0] === '{')) {
          try { coercedValue = JSON.parse(trimmed); } catch { /* leave as string */ }
        }
      }

      setPath(wf, path, coercedValue);
      addTouchedIdsFromPath(touchedIds, path, beforeWorkflow, wf);
      return `Set ${path} = ${JSON.stringify(coercedValue)}`;
    }

    // ==================================================================
    // ADD_VARIABLE
    // ==================================================================
    case 'add_variable': {
      const { varName, varType, varDefault } = ctx;
      if (!varName) throw new Error('varName is required for add_variable');

      if (!wf.variables) wf.variables = [];

      const variable: WorkflowVariable = {
        name: varName,
        type: varType || 'string',
        defaultValue: varDefault,
      };
      wf.variables.push(variable);

      return `Added variable "${varName}"`;
    }

    // ==================================================================
    // RENAME
    // ==================================================================
    case 'rename': {
      const { name } = ctx;
      if (!name) throw new Error('name is required for rename');

      const oldName = wf.name;
      wf.name = name;
      return `Renamed "${oldName}" → "${name}"`;
    }

    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

// ============================================================================
// THE TOOL
// ============================================================================

// Per-op field shape, reused for both the single-op (flat, top-level) form
// and each entry of the batch `ops` array.
const OP_ENUM = z.enum([
  'add_node', 'update_node', 'edit_node_text', 'remove_node',
  'add_wire', 'update_wire', 'remove_wire',
  'set_path', 'add_variable', 'rename',
]);

const opItemShape = {
  op: OP_ENUM.describe('Operation to perform'),

  // add_node: optional client-specified id so you can reference this element
  // (e.g. in a later add_wire) within the SAME batch call.
  id: z.string().optional().describe('Optional id for add_node/trigger. Set it when you need to wire to this element later in the same batch. Must be unique; ignored if it collides with an existing id.'),

  // Node operations
  tool: z.string().optional().describe('Tool name for add_node'),
  args: z.record(z.string(), z.any()).optional().describe('Tool args for add_node/update_node'),
  label: z.string().optional().describe('Label for node/trigger'),
  nodeId: z.string().optional().describe('Step/Node ID for update/remove (triggers use trig_*)'),
  stepId: z.string().optional().describe('Alias for nodeId'),
  connectFrom: z.string().optional().describe('Auto-wire from this ID'),

  // Trigger operations
  triggerType: z.string().optional().describe('Trigger type (used when adding/updating a trigger step)'),
  triggerArgs: z.record(z.string(), z.any()).optional().describe('Trigger args (used when updating a trigger step)'),

  // Wire operations
  from: z.string().optional().describe('Wire source ID'),
  to: z.string().optional().describe('Wire target ID'),
  // NB: these were z.any() — a bare z.any() emits a type-less property that
  // Gemini rejects on the OpenRouter→Google path. geminiSafeJsonValue() accepts
  // the same JSON shapes (object guard/loop/stream configs, "always" string,
  // arbitrary set_path values) while staying Gemini-safe. .nullable() preserves
  // "pass null to clear". See zod-utils / gemini-schema-safety.test.ts.
  guard: geminiSafeJsonValue().nullable().optional().describe('Wire guard: { if: <jsonlogic|"expr"> } or "always". null clears (see WIRE PROPERTIES in the reference).'),
  loop: geminiSafeJsonValue().nullable().optional().describe('Wire loop: forEach/repeat/while config. null clears (full shapes in the reference).'),
  loopBreak: z.boolean().optional().describe('true on a wire OUT of a loop body = continue past the loop (plain wires re-enter). Usually with a guard.'),
  loopFanoutMode: geminiSafeJsonValue().nullable().optional().describe('forEach fan-out (parallel) mode; null clears.'),
  stream: geminiSafeJsonValue().nullable().optional().describe('Wire stream config (streaming source nodes); null clears.'),

  // Path operations
  path: z.string().optional().describe('JSON path for set_path; for edit_node_text, the string field inside the node (e.g. "args.component" — optional when old_string is unique across the node)'),
  value: geminiSafeJsonValue().nullable().optional().describe('Value for set_path'),

  // edit_node_text operations (find/replace inside a string arg)
  old_string: z.string().optional().describe('edit_node_text: exact text to find in the node\'s string field. Must match exactly (whitespace/escapes included).'),
  new_string: z.string().optional().describe('edit_node_text: replacement text (empty string deletes old_string)'),
  replace_all: z.boolean().optional().describe('edit_node_text: replace every occurrence (default false — fails if old_string is not unique)'),

  // Variable operations
  varName: z.string().optional().describe('Variable name'),
  varType: z.string().optional().describe('Variable type: string, number, boolean, list, json'),
  varDefault: geminiSafeJsonValue().nullable().optional().describe('Variable default value'),

  // Rename
  name: z.string().optional().describe('New workflow name for rename'),
};

export const workflowModifyTool = createTool({
  id: 'modify_workflow',
  description: `Modify the current workflow (auto-loaded — do NOT pass the full workflow JSON, just the op(s)). Triggers ARE steps (use their trig_* id). Full examples + pitfalls are in the inlined WORKFLOW REFERENCE.

BATCH (preferred, cheaper): pass "ops":[...] to apply many changes in ONE call — they run in order, later ops see earlier ones; give a new node an "id" to wire to it in the same batch. A failed op is reported in "results" without aborting the rest. Single-op (top-level "op") is for one-offs.

OPS (? = optional):
• add_node { tool, args, connectFrom?, id?, label? } — or a TRIGGER via { triggerType, triggerArgs }.
• update_node { nodeId, …changes } — needs one of args | path+value | label | tool.
• edit_node_text { nodeId, old_string, new_string, path?, replace_all? } — find/replace inside a LARGE string arg; PREFER over update_node for custom_ui/scripts/long prompts.
• remove_node { nodeId } · add_wire / remove_wire { from, to, guard?, loop?, loopBreak? }.
• update_wire — set/clear wire props IN PLACE (reliable for loops/guards; null clears). guard { if:… }; loop { type:"forEach"|"repeat"|"while", … }; loopBreak true to continue past a loop.
• set_path { path, value } · add_variable { varName, varType, varDefault } · rename { name }.

stuardFile targets a sub-workflow FILE in the workspace (loaded, ops applied, saved back; main canvas untouched). Studio only.`,

  inputSchema: z.object({
    // Single-op (flat) form: same fields as a batch op, but description-free so the
    // ~22 field docs aren't sent twice (the ops[] items below carry them, and every
    // op is documented in this tool's description). Saves prefix tokens every turn.
    ...(Object.fromEntries(
      Object.entries(opItemShape).map(([k, v]) => [k, (v as any).describe('')]),
    ) as typeof opItemShape),

    // op is optional at the top level — supply EITHER a single op (flat fields)
    // OR an ops[] batch.
    op: OP_ENUM.optional().describe('Single operation to perform (omit when using "ops").'),

    // Batch: apply many operations in one call.
    ops: z.array(z.object(opItemShape).partial().required({ op: true }))
      .optional()
      .describe('Batch of operations to apply in order in ONE call. Preferred for multi-step builds/edits.'),

    // Target stuard file (defaults to main workflow)
    stuardFile: z.string().optional().describe('Optional: relative path to the .stuard file to modify (e.g. "helpers/send-email.stuard"). Defaults to the main workflow if not specified.'),

    // workflow is OPTIONAL - will be loaded from session. z.object({}).loose()
    // (not z.any()) so it isn't a type-less property Gemini rejects on the
    // OpenRouter→Google path (see zod-utils / gemini-schema-safety.test.ts).
    workflow: z.object({}).loose().optional().describe('Optional: workflow JSON. If not provided, uses the current session workflow.'),
    workflowId: z.string().optional().describe('Optional: workflow ID to look up from memory'),
  }).partial(),  // all fields optional; op/ops requirement enforced in execute

  outputSchema: z.object({
    ok: z.boolean(),
    stuardFile: z.string().optional().describe('Which .stuard file was modified (if specified)'),
    message: z.string().optional(),
    error: z.string().optional(),
    results: z.any().optional().describe('Per-op {op, ok, message|error} array (batch mode)'),
    diagram: z.string().optional().describe('ASCII diagram of the workflow structure'),
    affectedFlow: z.any().optional().describe('Topology context for touched nodes/triggers after the mutation'),
    workflow: z.any().optional().describe('The full modified workflow object (UI channel; included in the return only when no writer is present)'),
  }).passthrough(),

  execute: async (inputData, { writer }) => {
    const ctx = inputData as any;
    const { op, workflowId, stuardFile } = ctx;
    let { workflow } = ctx;

    // stuardFile → operate on a sub-workflow FILE from the workspace instead of
    // the session workflow. (This used to be accepted but IGNORED — ops silently
    // applied to the MAIN workflow and could corrupt it.) Load it now so the
    // resolution below uses the sub-file as the working workflow.
    let subFile: { absPath: string; relPath: string } | null = null;
    if (typeof stuardFile === 'string' && stuardFile.trim()) {
      const mainIdHint =
        (workflow && typeof workflow === 'object' && !Array.isArray(workflow) && workflow.id) ? String(workflow.id)
          : (typeof workflowId === 'string' && workflowId) ? workflowId
            : getSessionWorkflow()?.id;
      const loaded = await loadSubWorkflowFile(stuardFile.trim(), mainIdHint, writer);
      if ('error' in loaded) return { ok: false, error: loaded.error };
      workflow = loaded.workflow;
      subFile = { absPath: loaded.absPath, relPath: loaded.relPath };
      log('sub_workflow_target', { stuardFile: loaded.relPath, id: workflow?.id });
    }

    // PRIORITY 1: If workflow object is provided directly, use it
    if (workflow && typeof workflow === 'object' && !Array.isArray(workflow)) {
      log('using_provided_workflow', { id: workflow.id });
    }
    // PRIORITY 2: If workflowId is provided, look it up
    else if (typeof workflowId === 'string' && workflowId) {
      const fromMap = workflowMap.get(workflowId);
      if (fromMap) {
        workflow = fromMap;
        log('resolved_from_workflowId', { workflowId });
      } else if (getSessionWorkflow()) {
        workflow = getSessionWorkflow();
        log('workflowId_not_found_using_session', { workflowId, sessionId: workflow?.id });
      } else {
        return { ok: false, error: `Workflow not found by ID: ${workflowId}` };
      }
    }
    // PRIORITY 3: If workflow is a string (ID or JSON), try to resolve
    else if (typeof workflow === 'string') {
      const wfId = workflow;
      const fromMap = workflowMap.get(wfId);
      if (fromMap) {
        workflow = fromMap;
        log('resolved_from_map', { wfId });
      } else {
        try {
          workflow = JSON.parse(wfId);
        } catch {
          if (getSessionWorkflow()) {
            workflow = getSessionWorkflow();
            log('workflow_string_not_found_using_session', { wfId, sessionId: workflow?.id });
          } else {
            return { ok: false, error: `Workflow not found: ${wfId}` };
          }
        }
      }
    }
    // PRIORITY 4: Use session workflow (pre-stored by server)
    else if (getSessionWorkflow()) {
      workflow = getSessionWorkflow();
      log('using_session_workflow', { id: workflow?.id });
    }
    // PRIORITY 5: No workflow available
    else {
      return { ok: false, error: 'No workflow available. The workflow should be automatically loaded from the session context.' };
    }

    const wf = cloneWorkflow(workflow);
    const beforeWorkflow = cloneWorkflow(wf);
    const touchedIds = new Set<string>();

    // Resolve the operation list: explicit ops[] batch, or a single top-level op.
    const rawOps: any[] = Array.isArray(ctx.ops) && ctx.ops.length > 0 ? ctx.ops : (op ? [ctx] : []);
    const isBatch = Array.isArray(ctx.ops) && ctx.ops.length > 0;

    if (rawOps.length === 0) {
      return { ok: false, error: 'Provide either "op" (single change) or a non-empty "ops" array (batch).' };
    }

    log('start', {
      op: isBatch ? `batch[${rawOps.length}]` : op,
      workflowId: wf.id,
      stuardFile: stuardFile || undefined,
    });

    try {
      // Apply each op in order against the single cloned workflow. Best-effort:
      // a failed op is recorded but does not abort the rest of the batch.
      const opResults: { op: string; ok: boolean; message?: string; error?: string }[] = [];
      for (let i = 0; i < rawOps.length; i++) {
        const opCtx = rawOps[i] || {};
        try {
          const m = applyOp(wf, opCtx, touchedIds, beforeWorkflow);
          opResults.push({ op: String(opCtx.op || 'unknown'), ok: true, message: m });
        } catch (e: any) {
          opResults.push({ op: String(opCtx.op || 'unknown'), ok: false, error: e?.message || 'operation failed' });
        }
      }

      const okCount = opResults.filter(r => r.ok).length;
      const failCount = opResults.length - okCount;

      // Nothing succeeded → don't touch the session; hand the errors back so the
      // model can correct and retry. Matches the old single-op fail behavior.
      if (okCount === 0) {
        const err = isBatch
          ? `All ${opResults.length} operations failed: ${opResults.map((r, i) => `[${i}] ${r.op}: ${r.error}`).join('; ')}`
          : (opResults[0]?.error || 'Operation failed');
        log('error', { error: err, batch: isBatch });
        return { ok: false, error: err, results: isBatch ? opResults : undefined };
      }

      // Build the summary message.
      let message: string;
      if (isBatch) {
        const header = failCount > 0
          ? `Applied ${okCount}/${opResults.length} operations (${failCount} failed):`
          : `Applied ${okCount} operations:`;
        message = header + '\n' + opResults
          .map((r, i) => `  [${i}] ${r.ok ? '✓' : '✗'} ${r.op}: ${r.ok ? r.message : r.error}`)
          .join('\n');
      } else {
        message = opResults[0].message || 'Done';
      }

      if (subFile) {
        // Sub-workflow: write the file back on the desktop. The main session
        // workflow / workflowMap stay untouched — the canvas shows the MAIN
        // workflow and must not be clobbered by sub-file edits.
        const saveError = await saveSubWorkflowFile(subFile.absPath, wf, writer);
        if (saveError) {
          return {
            ok: false,
            error: `Edits applied in memory but saving "${subFile.relPath}" failed: ${saveError}`,
            results: isBatch ? opResults : undefined,
          };
        }
      } else {
        // Store in memory (per-request via ALS + global map)
        workflowMap.set(wf.id, wf);
        setBridgeState(_BRIDGE_KEY, wf);
        _sessionWorkflowFallback = wf;
      }

      // Auto-persist when running as a subagent — there's no UI "Save" button,
      // so modifications would otherwise vanish after the run. Studio mode
      // keeps the existing behavior (dirty state + manual save) because the
      // user is editing live on the canvas and may want to revert before
      // committing.
      let persisted = false;
      let persistError: string | undefined;
      const secrets = getBridgeSecrets();
      const inSubagent = !!secrets && typeof (secrets as any).__subagentKind === 'string';
      if (inSubagent && !stuardFile && hasClientBridge()) {
        try {
          const importRes = await execLocalTool(
            'import_workflow',
            { definition: wf },
            writer as any,
            15000,
            { silent: true, noFallback: true },
          );
          persisted = !!importRes?.ok;
          if (!persisted) persistError = importRes?.error || 'import_workflow returned not-ok';
        } catch (e: any) {
          persistError = e?.message || 'import_workflow threw';
          log('modify_persist_failed', { id: wf.id, error: persistError });
        }
      }

      const affectedFlow = buildAffectedFlowReport(beforeWorkflow, wf, touchedIds);

      // Node-tool sanity check — flags hallucinated tool names, orchestrator-
      // only tools dropped into nodes, and empty/missing tool fields.
      const nodeIssues = validateNodeTools(wf);
      const issuesSummary = formatNodeIssuesSummary(nodeIssues);
      const finalMessage = issuesSummary ? `${message}${issuesSummary}` : message;

      // The padded ASCII box diagram goes to the UI channel only. The MODEL gets
      // the compact schematic, and only when topology actually changed — arg-only
      // edits (update_node / edit_node_text) are fully described by message +
      // affectedFlow, and re-sending the whole structure on every edit was a major
      // per-call token cost on large workflows.
      const diagram = generateWorkflowDiagram(wf);
      const structuralChange = rawOps.some((o: any) => {
        const opName = String(o?.op || '');
        if (opName === 'add_node' || opName === 'remove_node' || opName === 'add_wire' || opName === 'update_wire' || opName === 'remove_wire') return true;
        if (opName === 'set_path') return /^(nodes|wires|triggers)\b/.test(String(o?.path || ''));
        return false;
      });
      const modelDiagram = structuralChange ? formatWorkflowSchematic(wf) : undefined;

      // The UI live-update channel needs the FULL workflow to repaint the canvas.
      // The MODEL does not — echoing the whole workflow JSON into the model's
      // tool-result on every edit was the dominant token cost (it gets re-sent
      // with the full history on every subsequent turn → ~quadratic growth).
      // So: full payload goes out over the tool_event writer; the returned
      // result (which lands in the model's history) carries only the diagram +
      // affected-flow + per-op results. When there is no writer (headless /
      // direct calls / tests) we include the workflow as a fallback so non-UI
      // callers still receive it.
      const hasWriter = !!(writer && typeof (writer as any).write === 'function');

      const uiResult = {
        ok: true as const,
        workflowId: wf.id,
        message: finalMessage,
        diagram,
        affectedFlow,
        workflow: wf,
        results: isBatch ? opResults : undefined,
        nodeIssues: nodeIssues.length > 0 ? nodeIssues : undefined,
        persisted: inSubagent ? persisted : undefined,
        persistError: inSubagent ? persistError : undefined,
        ...(stuardFile ? { stuardFile } : {}),
      };

      const modelResult = {
        ok: true as const,
        // Carry the id (tiny string, safe for model history) so the stream
        // relay can re-attach the FRESH workflow by id for the UI even though
        // the model-facing result intentionally omits the full workflow JSON.
        workflowId: wf.id,
        message: finalMessage,
        ...(modelDiagram ? { diagram: modelDiagram } : {}),
        affectedFlow,
        results: isBatch ? opResults : undefined,
        nodeIssues: nodeIssues.length > 0 ? nodeIssues : undefined,
        persisted: inSubagent ? persisted : undefined,
        persistError: inSubagent ? persistError : undefined,
        ...(stuardFile ? { stuardFile } : {}),
        ...(hasWriter ? {} : { workflow: wf }),
      };

      log('success', { workflowId: wf.id, okCount, failCount, persisted, stuardFile: stuardFile || undefined });

      // Emit event for immediate UI update — carries the full workflow so the
      // canvas can repaint even though the model-facing return omits it.
      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'modify_workflow',
        status: 'completed',
        workflowId: wf.id,
        ...(stuardFile ? { stuardFile } : {}),
        result: uiResult,
      });

      return modelResult;

    } catch (err: any) {
      log('error', { error: err.message, op: isBatch ? 'batch' : op });
      return { ok: false, error: err.message };
    }
  },
});
