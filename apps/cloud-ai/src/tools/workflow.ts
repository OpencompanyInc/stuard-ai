/**
 * WORKFLOW MODIFY TOOL - Clean Rewrite
 * 
 * A single, robust tool for modifying workflows.
 * Simple operations, flat parameters, clear errors.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { safeToolWrite } from './bridge';
import { workflowMap } from './workflow-system';
import { writeLog } from '../utils/logger';

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

// ============================================================================
// THE TOOL
// ============================================================================

// Session-scoped workflow storage - allows modify_workflow to work without passing full JSON
// The server pre-stores the workflow here before the agent runs
let _sessionWorkflow: Workflow | null = null;

export function setSessionWorkflow(wf: any): void {
  if (wf && typeof wf === 'object') {
    _sessionWorkflow = cloneWorkflow(wf);
    if (_sessionWorkflow.id) {
      workflowMap.set(_sessionWorkflow.id, _sessionWorkflow);
    }
    log('session_workflow_set', { id: _sessionWorkflow.id });
  }
}

export function getSessionWorkflow(): Workflow | null {
  return _sessionWorkflow;
}

export function clearSessionWorkflow(): void {
  _sessionWorkflow = null;
}

export const workflowModifyTool = createTool({
  id: 'modify_workflow',
  description: `Modify the current workflow. The workflow is automatically loaded from session context.

DO NOT pass the full workflow JSON - just pass the operation and parameters.

TRIGGERS ARE STEPS: use update_node/remove_node with the trigger id (e.g. "trig_0").

OPERATIONS:

ADD_NODE - Add a new step (or a trigger if triggerType is provided)
  { op: "add_node", tool: "log", args: { message: "hi" }, connectFrom: "trig_0" }
  { op: "add_node", triggerType: "keystroke", triggerArgs: { sequence: "go" } }

UPDATE_NODE - Update existing node or trigger (MUST provide changes!)
  { op: "update_node", nodeId: "step_abc", args: { message: "new" } }
  { op: "update_node", nodeId: "step_abc", path: "message", value: "new" }  // Single field
  { op: "update_node", nodeId: "trig_0", triggerArgs: { sequence: "cats" } }
  NOTE: You MUST provide args, path/value, label, or tool - otherwise it will fail!

REMOVE_NODE - Delete a node or trigger (and its wires)
  { op: "remove_node", nodeId: "step_abc" }

ADD_WIRE - Connect two elements
  { op: "add_wire", from: "trig_0", to: "step_abc" }

REMOVE_WIRE - Disconnect
  { op: "remove_wire", from: "trig_0", to: "step_abc" }

SET_PATH - Direct JSON path edit
  { op: "set_path", path: "triggers[0].args.sequence", value: "cats" }

ADD_VARIABLE - Add workflow variable
  { op: "add_variable", varName: "counter", varType: "number", varDefault: 0 }

RENAME - Change workflow name
  { op: "rename", name: "New Name" }

STUARD FILE TARGETING:
  By default, modify_workflow edits the main workflow (main.stuard).
  To modify a sub-workflow .stuard file, pass stuardFile:
  { op: "add_node", tool: "log", args: { message: "hi" }, stuardFile: "helpers/send-email.stuard" }`,

  inputSchema: z.object({
    op: z.enum([
      'add_node', 'update_node', 'remove_node',
      'add_wire', 'remove_wire',
      'set_path', 'add_variable', 'rename'
    ]).describe('Operation to perform'),

    // Target stuard file (defaults to main workflow)
    stuardFile: z.string().optional().describe('Optional: relative path to the .stuard file to modify (e.g. "helpers/send-email.stuard"). Defaults to the main workflow if not specified.'),

    // workflow is now OPTIONAL - will be loaded from session
    workflow: z.any().optional().describe('Optional: workflow JSON. If not provided, uses the current session workflow.'),
    workflowId: z.string().optional().describe('Optional: workflow ID to look up from memory'),

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
    guard: z.any().optional().describe('Wire guard condition'),

    // Path operations
    path: z.string().optional().describe('JSON path for set_path'),
    value: z.any().optional().describe('Value for set_path'),

    // Variable operations
    varName: z.string().optional().describe('Variable name'),
    varType: z.string().optional().describe('Variable type: string, number, boolean, list, json'),
    varDefault: z.any().optional().describe('Variable default value'),

    // Rename
    name: z.string().optional().describe('New workflow name for rename'),
  }).partial().required({ op: true }),  // Make all fields optional except 'op'

  outputSchema: z.object({
    ok: z.boolean(),
    workflow: z.any().optional(),
    stuardFile: z.string().optional().describe('Which .stuard file was modified (if specified)'),
    message: z.string().optional(),
    error: z.string().optional(),
    diagram: z.string().optional().describe('ASCII diagram of the workflow structure'),
  }),

  execute: async (inputData, { writer }) => {
    const ctx = inputData as any;
    const { op, workflowId, stuardFile } = ctx;
    let { workflow } = ctx;

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
      } else if (_sessionWorkflow) {
        workflow = _sessionWorkflow;
        log('workflowId_not_found_using_session', { workflowId, sessionId: _sessionWorkflow.id });
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
          if (_sessionWorkflow) {
            workflow = _sessionWorkflow;
            log('workflow_string_not_found_using_session', { wfId, sessionId: _sessionWorkflow.id });
          } else {
            return { ok: false, error: `Workflow not found: ${wfId}` };
          }
        }
      }
    }
    // PRIORITY 4: Use session workflow (pre-stored by server)
    else if (_sessionWorkflow) {
      workflow = _sessionWorkflow;
      log('using_session_workflow', { id: workflow.id });
    }
    // PRIORITY 5: No workflow available
    else {
      return { ok: false, error: 'No workflow available. The workflow should be automatically loaded from the session context.' };
    }

    const wf = cloneWorkflow(workflow);
    log('start', { op, workflowId: wf.id, stuardFile: stuardFile || undefined });

    try {
      let message = '';

      switch (op) {
        // ==================================================================
        // ADD_NODE
        // ==================================================================
        case 'add_node': {
          const { tool, args, label, connectFrom, triggerType, triggerArgs } = ctx;

          // If triggerType is provided, add a trigger using the same op (treat trigger as step)
          if (triggerType) {
            const newTrigger: WorkflowTrigger = {
              id: genId('trig'),
              type: triggerType,
              label: label || `${triggerType} Trigger`,
              args: triggerArgs || args || {},
              position: nextPosition(wf, 'trigger'),
            };
            wf.triggers.push(newTrigger);
            message = `Added trigger "${newTrigger.label}" (${newTrigger.id})`;

            if (connectFrom && elementExists(wf, connectFrom)) {
              wf.wires.push({ from: newTrigger.id, to: connectFrom });
              message += ` wired to ${connectFrom}`;
            }
            break;
          }

          if (!tool) return { ok: false, error: 'tool is required for add_node' };

          const newNode: WorkflowNode = {
            id: genId('step'),
            tool,
            label: label || tool,
            args: args || {},
            position: nextPosition(wf, 'node'),
          };

          wf.nodes.push(newNode);
          message = `Added node "${newNode.label}" (${newNode.id})`;

          if (connectFrom && elementExists(wf, connectFrom)) {
            wf.wires.push({ from: connectFrom, to: newNode.id });
            message += ` wired from ${connectFrom}`;
          }
          break;
        }

        // ==================================================================
        // UPDATE_NODE
        // ==================================================================
        case 'update_node': {
          const nodeId = ctx.nodeId || ctx.stepId;
          const { args, label, tool, triggerType, triggerArgs, path, value } = ctx;
          if (!nodeId) return { ok: false, error: 'nodeId is required for update_node' };

          const idx = nodeIndex(wf, nodeId);
          if (idx >= 0) {
            const node = wf.nodes[idx];
            let changed = false;

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
              return { ok: false, error: `update_node called for "${nodeId}" but no changes specified. Provide args, label, tool, or path/value.` };
            }

            if (!message) message = `Updated node "${node.label}"`;
            break;
          }

          // If node not found, try updating a trigger with the same id (treat trigger as step)
          const trigIdx = triggerIndex(wf, nodeId);
          if (trigIdx < 0) return { ok: false, error: `Step not found: ${nodeId}` };

          const trigger = wf.triggers[trigIdx];
          let changed = false;

          // Support path/value for triggers too
          if (path !== undefined && value !== undefined) {
            const normalizedPath = path.startsWith('args.') ? path : 
                                   (path === 'label' || path === 'type' || path === 'id') ? path : `args.${path}`;
            setPath(trigger, normalizedPath, value);
            changed = true;
            message = `Updated trigger "${trigger.label}": ${normalizedPath} = ${JSON.stringify(value)}`;
          }

          const nextArgs = triggerArgs || args;
          if (nextArgs) {
            trigger.args = { ...trigger.args, ...nextArgs };
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
            return { ok: false, error: `update_node called for trigger "${nodeId}" but no changes specified. Provide args, triggerArgs, label, triggerType, or path/value.` };
          }

          if (!message) message = `Updated trigger "${trigger.label}"`;
          break;
        }

        // ==================================================================
        // REMOVE_NODE
        // ==================================================================
        case 'remove_node': {
          const nodeId = ctx.nodeId || ctx.stepId;
          if (!nodeId) return { ok: false, error: 'nodeId is required for remove_node' };

          const idx = nodeIndex(wf, nodeId);
          if (idx >= 0) {
            const removed = wf.nodes.splice(idx, 1)[0];
            wf.wires = wf.wires.filter(w => w.from !== nodeId && w.to !== nodeId);
            message = `Removed node "${removed.label}"`;
            break;
          }

          // If node not found, try removing a trigger with the same id (treat trigger as step)
          const trigIdx = triggerIndex(wf, nodeId);
          if (trigIdx < 0) return { ok: false, error: `Step not found: ${nodeId}` };

          const removedTrigger = wf.triggers.splice(trigIdx, 1)[0];
          wf.wires = wf.wires.filter(w => w.from !== removedTrigger.id && w.to !== removedTrigger.id);
          message = `Removed trigger "${removedTrigger.label}"`;
          break;
        }

        // ==================================================================
        // ADD_WIRE
        // ==================================================================
        case 'add_wire': {
          const { from, to, guard } = ctx;
          if (!from || !to) return { ok: false, error: 'from and to are required for add_wire' };

          if (!elementExists(wf, from)) return { ok: false, error: `Source not found: ${from}` };
          if (!elementExists(wf, to)) return { ok: false, error: `Target not found: ${to}` };

          const exists = wf.wires.some(w => w.from === from && w.to === to);
          if (exists) return { ok: false, error: `Wire already exists: ${from} → ${to}` };

          const wire: WorkflowWire = { from, to };
          if (guard) wire.guard = sanitizeGuard(guard);
          wf.wires.push(wire);

          message = `Connected ${from} → ${to}`;
          break;
        }

        // ==================================================================
        // REMOVE_WIRE
        // ==================================================================
        case 'remove_wire': {
          const { from, to } = ctx;
          if (!from || !to) return { ok: false, error: 'from and to are required for remove_wire' };

          const idx = wf.wires.findIndex(w => w.from === from && w.to === to);
          if (idx < 0) return { ok: false, error: `Wire not found: ${from} → ${to}` };

          wf.wires.splice(idx, 1);
          message = `Disconnected ${from} → ${to}`;
          break;
        }

        // ==================================================================
        // SET_PATH (direct JSON edit)
        // ==================================================================
        case 'set_path': {
          const { path, value } = ctx;
          if (!path) return { ok: false, error: 'path is required for set_path' };
          if (value === undefined) return { ok: false, error: 'value is required for set_path' };

          setPath(wf, path, value);
          message = `Set ${path} = ${JSON.stringify(value)}`;
          break;
        }

        // ==================================================================
        // ADD_VARIABLE
        // ==================================================================
        case 'add_variable': {
          const { varName, varType, varDefault } = ctx;
          if (!varName) return { ok: false, error: 'varName is required for add_variable' };

          if (!wf.variables) wf.variables = [];

          const variable: WorkflowVariable = {
            name: varName,
            type: varType || 'string',
            defaultValue: varDefault,
          };
          wf.variables.push(variable);

          message = `Added variable "${varName}"`;
          break;
        }

        // ==================================================================
        // RENAME
        // ==================================================================
        case 'rename': {
          const { name } = ctx;
          if (!name) return { ok: false, error: 'name is required for rename' };

          const oldName = wf.name;
          wf.name = name;
          message = `Renamed "${oldName}" → "${name}"`;
          break;
        }

        default:
          return { ok: false, error: `Unknown operation: ${op}` };
      }

      // Store in memory
      workflowMap.set(wf.id, wf);
      _sessionWorkflow = wf;

      // Generate diagram for visual understanding
      const diagram = generateWorkflowDiagram(wf);

      const result = { ok: true as const, workflow: wf, message, diagram, ...(stuardFile ? { stuardFile } : {}) };

      log('success', { workflowId: wf.id, message, stuardFile: stuardFile || undefined });

      // Emit event for immediate UI update
      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'modify_workflow',
        status: 'completed',
        workflowId: wf.id,
        ...(stuardFile ? { stuardFile } : {}),
        result,
      });

      return result;

    } catch (err: any) {
      log('error', { error: err.message, op });
      return { ok: false, error: err.message };
    }
  },
});
