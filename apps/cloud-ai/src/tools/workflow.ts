import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge, safeToolWrite } from './bridge';
import { workflowMap } from './workflow-system';
import { writeLog } from '../utils/logger';

// ============================================================================
// Types matching DesignerModel from desktop/src/renderer/workflows/types.ts
// ============================================================================

interface DesignerNode {
  id: string;
  type: string;
  tool?: string;
  label: string;
  args: any;
  fallbackTo?: string;
  position: { x: number; y: number };
}

interface DesignerTrigger {
  id: string;
  type: string;
  label: string;
  args: any;
  position: { x: number; y: number };
}

interface DesignerWire {
  from: string;
  to: string;
  guard?: any;
  label?: string;
}

interface DesignerModel {
  id: string;
  name: string;
  version: string;
  description?: string;
  autostart?: boolean;
  triggers: DesignerTrigger[];
  nodes: DesignerNode[];
  wires: DesignerWire[];
  requirements?: string;
  scripts?: Record<string, string>;
  locked?: boolean;
  marketplaceSlug?: string;
}

// ============================================================================
// Utilities
// ============================================================================

function wfLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[workflow-tool] ${event}: ${JSON.stringify(data)}` : `[workflow-tool] ${event}`;
  console.log(msg);
  writeLog(`wf_tool_${event}`, data);
}

function generateId(prefix: string = 'item'): string {
  // Ensure prefix has no dots for safe template interpolation (e.g., {{step_abc.text}})
  const safePrefix = String(prefix || 'item').replace(/\./g, '_');
  return `${safePrefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Calculate next available position for a new element
function getNextPosition(workflow: DesignerModel, type: 'node' | 'trigger'): { x: number; y: number } {
  const items = type === 'node' ? workflow.nodes : workflow.triggers;
  if (!items || items.length === 0) {
    return type === 'trigger' ? { x: 80, y: 80 } : { x: 200, y: 200 };
  }
  
  // Find the rightmost and bottommost positions
  let maxX = 0, maxY = 0;
  for (const item of items) {
    if (item.position) {
      maxX = Math.max(maxX, item.position.x);
      maxY = Math.max(maxY, item.position.y);
    }
  }
  
  // Place new item to the right or below existing ones
  return { x: maxX + 180, y: maxY };
}

// Find a node or trigger by ID
function findById(workflow: DesignerModel, id: string): { type: 'node' | 'trigger'; item: any; index: number } | null {
  const nodeIdx = workflow.nodes?.findIndex(n => n.id === id);
  if (nodeIdx !== undefined && nodeIdx >= 0) {
    return { type: 'node', item: workflow.nodes[nodeIdx], index: nodeIdx };
  }
  const triggerIdx = workflow.triggers?.findIndex(t => t.id === id);
  if (triggerIdx !== undefined && triggerIdx >= 0) {
    return { type: 'trigger', item: workflow.triggers[triggerIdx], index: triggerIdx };
  }
  return null;
}

// Normalize and validate the workflow structure
function normalizeWorkflow(wf: any): DesignerModel {
  // Ensure arrays exist
  if (!Array.isArray(wf.triggers)) {
    wf.triggers = wf.triggers ? [wf.triggers] : [];
  }
  if (!Array.isArray(wf.nodes)) {
    wf.nodes = wf.nodes ? [wf.nodes] : [];
  }
  if (!Array.isArray(wf.wires)) {
    wf.wires = wf.wires ? [wf.wires] : [];
  }
  
  // Ensure all triggers have required fields
  wf.triggers = wf.triggers.map((t: any, i: number) => ({
    id: t.id || `trig_${i}`,
    type: t.type || 'manual',
    label: t.label || `Trigger ${i + 1}`,
    args: t.args || {},
    position: t.position || { x: 80, y: 80 + i * 100 },
    ...t
  }));
  
  // Ensure all nodes have required fields
  wf.nodes = wf.nodes.map((n: any, i: number) => ({
    id: n.id || generateId('step'),
    type: n.type || 'local.tool',
    tool: n.tool || 'log',
    label: n.label || n.tool || `Step ${i + 1}`,
    args: n.args || {},
    position: n.position || { x: 200 + i * 160, y: 200 },
    ...n
  }));
  
  // Ensure basic workflow fields
  if (!wf.id) wf.id = generateId('flow');
  if (!wf.name) wf.name = 'Untitled Workflow';
  if (!wf.version) wf.version = '1';
  
  return wf as DesignerModel;
}

// Resolve workflow from various input formats
async function resolveWorkflow(workflow: any, writer: any): Promise<DesignerModel | null> {
  let wfObj = workflow;
  let wfId: string | undefined;

  if (typeof workflow === 'string') {
    wfId = workflow;
    try {
      wfObj = JSON.parse(workflow);
      wfId = wfObj?.id ?? wfId;
    } catch {
      wfObj = undefined;
    }
  } else if (typeof workflow === 'number') {
    wfId = String(workflow);
    wfObj = undefined;
  }

  // Try to resolve from map or bridge
  if ((!wfObj || !wfObj.id) && wfId) {
    const fromMap = workflowMap.get(String(wfId));
    if (fromMap) {
      wfObj = fromMap;
    } else if (hasClientBridge()) {
      try {
        const fetched = await execLocalTool('show_json_workflow_code', { id: wfId }, writer, 15000, { silent: true });
        if (fetched?.ok && fetched?.workflow) {
          wfObj = fetched.workflow;
          workflowMap.set(fetched.workflow.id ?? String(wfId), fetched.workflow);
        }
      } catch (e: any) {
        console.warn('[workflow] Failed to fetch via bridge:', e?.message);
      }
    }
  }

  if (!wfObj) return null;
  
  // Assign ID if missing
  if (!wfObj.id) {
    wfObj.id = wfId || generateId('flow');
  }

  return normalizeWorkflow(JSON.parse(JSON.stringify(wfObj)));
}

// ============================================================================
// The unified workflow_modify tool with high-level operations
// ============================================================================

const workflowModifyTool = createTool({
  id: 'workflow_modify',
  description: `Modify a workflow's DesignerModel with high-level or low-level operations.

HIGH-LEVEL OPERATIONS (recommended):

• add_node: Add a new node to the workflow
  - tool: Tool name (e.g., "log", "take_screenshot", "run_python_script")
  - label: Display label for the node
  - args: Tool arguments object
  - connectFrom?: ID to auto-wire from (trigger or node)
  
• add_trigger: Add a new trigger (or use replace_trigger to swap existing)
  - type: "manual", "hotkey", "schedule", "webhook", "app_start"
  - args: Trigger-specific args (e.g., { accelerator: "Ctrl+Alt+K" } for hotkey)
  - label?: Display label

• replace_trigger: Replace an existing trigger (keeps connections)
  - triggerId: ID of trigger to replace (or index like 0)
  - type: New trigger type
  - args: New trigger args
  - label?: New label

• update_node: Update an existing node's properties
  - nodeId: ID of node to update
  - changes: Object with properties to update (label, args, tool, etc.)

• remove_node: Remove a node and all its wires
  - nodeId: ID of node to remove

• connect: Create a wire between two elements
  - from: Source ID (trigger or node)
  - to: Target ID (node)
  - guard?: Optional JSONLogic guard condition
  - label?: Optional wire label

• disconnect: Remove a wire
  - from: Source ID
  - to: Target ID

• rename: Rename the workflow
  - name: New workflow name

LOW-LEVEL OPERATIONS (for advanced edits):

• set: Set value at JSON path (e.g., path: "nodes[0].args.message")
• append: Append to array (e.g., path: "nodes")
• merge: Deep merge into object at path
• remove: Remove array item or property

EXAMPLES:

Replace manual trigger with hotkey:
{
  "workflow": <current_workflow>,
  "operation": "replace_trigger",
  "triggerId": 0,
  "type": "hotkey",
  "args": { "accelerator": "Ctrl+Alt+K" }
}

Add a new node connected to trigger:
{
  "workflow": <current_workflow>,
  "operation": "add_node",
  "tool": "take_screenshot",
  "label": "Capture Screen",
  "args": {},
  "connectFrom": "trig_0"
}

Update node arguments:
{
  "workflow": <current_workflow>,
  "operation": "update_node",
  "nodeId": "step_abc123",
  "changes": { "args": { "message": "New message" } }
}
`,
  inputSchema: z.object({
    workflow: z.any().describe('The current DesignerModel workflow JSON'),
    operation: z.enum([
      // High-level
      'add_node', 'add_trigger', 'replace_trigger', 'update_node', 'remove_node',
      'connect', 'disconnect', 'rename',
      // Low-level
      'set', 'append', 'insert', 'remove', 'merge'
    ]).describe('Operation to perform'),
    
    // High-level operation params
    tool: z.string().optional().describe('Tool name for add_node'),
    label: z.string().optional().describe('Label for node/trigger'),
    args: z.any().optional().describe('Args object for node/trigger'),
    type: z.string().optional().describe('Trigger type for add_trigger/replace_trigger'),
    nodeId: z.string().optional().describe('Node ID for update_node/remove_node'),
    triggerId: z.union([z.string(), z.number()]).optional().describe('Trigger ID or index for replace_trigger'),
    changes: z.any().optional().describe('Changes object for update_node'),
    connectFrom: z.string().optional().describe('Auto-connect from this ID when adding node'),
    from: z.string().optional().describe('Source ID for connect/disconnect'),
    to: z.string().optional().describe('Target ID for connect/disconnect'),
    guard: z.any().optional().describe('Guard condition for wires'),
    name: z.string().optional().describe('New name for rename operation'),
    
    // Low-level operation params
    path: z.string().optional().describe('JSON path for low-level ops'),
    value: z.any().optional().describe('Value for set/append/merge'),
    index: z.number().optional().describe('Array index for insert/remove')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    workflow: z.any().optional(),
    changes: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, writer }) => {
    const ctx = context as any;
    const { operation } = ctx;

    // Resolve and normalize workflow
    const wf = await resolveWorkflow(ctx.workflow, writer);
    if (!wf) {
      return { ok: false, error: 'Valid DesignerModel workflow JSON is required' };
    }

    wfLog('workflow_modify_start', { operation, workflowId: wf.id });

    try {
      let changes = '';

      switch (operation) {
        // =====================================================================
        // HIGH-LEVEL OPERATIONS
        // =====================================================================
        
        case 'add_node': {
          const { tool, label, args, connectFrom } = ctx;
          if (!tool) return { ok: false, error: 'tool is required for add_node' };
          
          const newNode: DesignerNode = {
            id: generateId('step'),
            type: 'local.tool',
            tool,
            label: label || tool,
            args: args || {},
            position: getNextPosition(wf, 'node')
          };
          
          wf.nodes.push(newNode);
          changes = `Added node "${newNode.label}" (${newNode.id})`;
          
          // Auto-connect if requested
          if (connectFrom) {
            const sourceExists = findById(wf, connectFrom);
            if (sourceExists) {
              wf.wires.push({ from: connectFrom, to: newNode.id });
              changes += ` and connected from ${connectFrom}`;
            }
          }
          break;
        }
        
        case 'add_trigger': {
          const { type, label, args } = ctx;
          if (!type) return { ok: false, error: 'type is required for add_trigger' };
          
          const newTrigger: DesignerTrigger = {
            id: generateId('trig'),
            type,
            label: label || `${type.charAt(0).toUpperCase() + type.slice(1)} Trigger`,
            args: args || {},
            position: getNextPosition(wf, 'trigger')
          };
          
          wf.triggers.push(newTrigger);
          changes = `Added ${type} trigger "${newTrigger.label}" (${newTrigger.id})`;
          break;
        }
        
        case 'replace_trigger': {
          const { triggerId, type, label, args } = ctx;
          if (type === undefined) return { ok: false, error: 'type is required for replace_trigger' };
          
          // Find trigger by ID or index
          let triggerIdx = -1;
          if (typeof triggerId === 'number') {
            triggerIdx = triggerId;
          } else if (triggerId) {
            triggerIdx = wf.triggers.findIndex(t => t.id === triggerId);
          } else {
            triggerIdx = 0; // Default to first trigger
          }
          
          if (triggerIdx < 0 || triggerIdx >= wf.triggers.length) {
            return { ok: false, error: `Trigger not found: ${triggerId}` };
          }
          
          const oldTrigger = wf.triggers[triggerIdx];
          const newTrigger: DesignerTrigger = {
            id: oldTrigger.id, // Keep same ID to preserve wires
            type,
            label: label || `${type.charAt(0).toUpperCase() + type.slice(1)} Trigger`,
            args: args || {},
            position: oldTrigger.position // Keep position
          };
          
          wf.triggers[triggerIdx] = newTrigger;
          changes = `Changed trigger "${oldTrigger.label}" to ${type}`;
          break;
        }
        
        case 'update_node': {
          const { nodeId, changes: nodeChanges } = ctx;
          if (!nodeId) return { ok: false, error: 'nodeId is required for update_node' };
          if (!nodeChanges) return { ok: false, error: 'changes object is required for update_node' };
          
          const found = findById(wf, nodeId);
          if (!found || found.type !== 'node') {
            return { ok: false, error: `Node not found: ${nodeId}` };
          }
          
          // Deep merge the changes
          const node = wf.nodes[found.index];
          for (const key of Object.keys(nodeChanges)) {
            if (key === 'args' && node.args && typeof nodeChanges.args === 'object') {
              node.args = { ...node.args, ...nodeChanges.args };
            } else {
              (node as any)[key] = nodeChanges[key];
            }
          }
          
          changes = `Updated node "${node.label}"`;
          break;
        }
        
        case 'remove_node': {
          const { nodeId } = ctx;
          if (!nodeId) return { ok: false, error: 'nodeId is required for remove_node' };
          
          const found = findById(wf, nodeId);
          if (!found || found.type !== 'node') {
            return { ok: false, error: `Node not found: ${nodeId}` };
          }

          const nodeLabel = wf.nodes[found.index].label;
          
          // Remove the node
          wf.nodes.splice(found.index, 1);
          
          // Remove all wires connected to this node
          const wiresBefore = wf.wires.length;
          wf.wires = wf.wires.filter(w => w.from !== nodeId && w.to !== nodeId);
          const wiresRemoved = wiresBefore - wf.wires.length;
          
          changes = `Removed node "${nodeLabel}"`;
          break;
        }
        
        case 'connect': {
          const { from, to, guard, label } = ctx;
          if (!from || !to) return { ok: false, error: 'from and to are required for connect' };
          
          // Verify both endpoints exist
          const fromExists = findById(wf, from);
          const toExists = findById(wf, to);
          if (!fromExists) return { ok: false, error: `Source not found: ${from}` };
          if (!toExists) return { ok: false, error: `Target not found: ${to}` };
          
          // Check for duplicate
          const exists = wf.wires.some(w => w.from === from && w.to === to);
          if (exists) return { ok: false, error: `Wire already exists from ${from} to ${to}` };
          
          const wire: DesignerWire = { from, to };
          if (guard) wire.guard = guard;
          if (label) wire.label = label;
          
          wf.wires.push(wire);
          changes = `Connected ${from} → ${to}`;
          break;
        }
        
        case 'disconnect': {
          const { from, to } = ctx;
          if (!from || !to) return { ok: false, error: 'from and to are required for disconnect' };
          
          const idx = wf.wires.findIndex(w => w.from === from && w.to === to);
          if (idx < 0) return { ok: false, error: `Wire not found from ${from} to ${to}` };
          
          wf.wires.splice(idx, 1);
          changes = `Disconnected ${from} → ${to}`;
          break;
        }
        
        case 'rename': {
          const { name } = ctx;
          if (!name) return { ok: false, error: 'name is required for rename' };
          
          const oldName = wf.name;
          wf.name = name;
          changes = `Renamed workflow from "${oldName}" to "${name}"`;
          break;
        }
        
        // =====================================================================
        // LOW-LEVEL OPERATIONS
        // =====================================================================
        
        case 'set': {
          const { path, value } = ctx;
          if (!path) return { ok: false, error: 'path is required for set' };
          if (value === undefined) return { ok: false, error: 'value is required for set' };
          
          const pathParts = parseJsonPath(path);
          if (!pathParts) return { ok: false, error: `Invalid path: ${path}` };
          
          setJsonValue(wf, pathParts, value);
          changes = `Set ${path}`;
          break;
        }
        
        case 'append': {
          const { path, value } = ctx;
          if (!path) return { ok: false, error: 'path is required for append' };
          if (value === undefined) return { ok: false, error: 'value is required for append' };
          
          const pathParts = parseJsonPath(path);
          if (!pathParts) return { ok: false, error: `Invalid path: ${path}` };
          
          const arr = getJsonValue(wf, pathParts);
          if (!Array.isArray(arr)) return { ok: false, error: `${path} is not an array` };
          
          arr.push(value);
          changes = `Appended to ${path}`;
          break;
        }
        
        case 'insert': {
          const { path, value, index } = ctx;
          if (!path) return { ok: false, error: 'path is required for insert' };
          if (value === undefined) return { ok: false, error: 'value is required for insert' };
          if (index === undefined) return { ok: false, error: 'index is required for insert' };
          
          const pathParts = parseJsonPath(path);
          if (!pathParts) return { ok: false, error: `Invalid path: ${path}` };
          
          const arr = getJsonValue(wf, pathParts);
          if (!Array.isArray(arr)) return { ok: false, error: `${path} is not an array` };
          
          arr.splice(index, 0, value);
          changes = `Inserted at ${path}[${index}]`;
          break;
        }
        
        case 'remove': {
          const { path, index } = ctx;
          if (!path) return { ok: false, error: 'path is required for remove' };
          
          const pathParts = parseJsonPath(path);
          if (!pathParts) return { ok: false, error: `Invalid path: ${path}` };
          
          const target = getJsonValue(wf, pathParts);
          if (Array.isArray(target)) {
            if (index === undefined) return { ok: false, error: 'index is required for array remove' };
            target.splice(index, 1);
            changes = `Removed ${path}[${index}]`;
          } else {
            const parentParts = pathParts.slice(0, -1);
            const prop = pathParts[pathParts.length - 1];
            const parent = parentParts.length > 0 ? getJsonValue(wf, parentParts) : wf;
            if (parent && typeof parent === 'object' && prop in parent) {
              delete parent[prop];
              changes = `Deleted ${path}`;
            } else {
              return { ok: false, error: `Property not found: ${path}` };
            }
          }
          break;
        }
        
        case 'merge': {
          const { path, value } = ctx;
          if (!path) return { ok: false, error: 'path is required for merge' };
          if (!value || typeof value !== 'object') return { ok: false, error: 'object value is required for merge' };
          
          const pathParts = parseJsonPath(path);
          if (!pathParts) return { ok: false, error: `Invalid path: ${path}` };
          
          const target = getJsonValue(wf, pathParts);
          if (!target || typeof target !== 'object') return { ok: false, error: `${path} is not an object` };
          
          deepMerge(target, value);
          changes = `Merged into ${path}`;
          break;
        }
        
        default:
          return { ok: false, error: `Unknown operation: ${operation}` };
      }

      // Final normalization pass
      const finalWorkflow = normalizeWorkflow(wf);
      
      // Store in memory
      workflowMap.set(finalWorkflow.id, finalWorkflow);

      // Build the result object
      const result = { ok: true as const, workflow: finalWorkflow, changes };

      console.log('[workflow_modify] SUCCESS - emitting result immediately:', {
        workflowId: finalWorkflow.id,
        changes,
        nodes: finalWorkflow.nodes?.length,
        triggers: finalWorkflow.triggers?.length,
        wires: finalWorkflow.wires?.length
      });

      wfLog('workflow_modify_done', { id: finalWorkflow.id, changes });

      // CRITICAL: Include result in the tool_event so client can apply immediately
      // Without this, the workflow only updates after the full response completes
      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'workflow_modify',
        status: 'completed',
        workflowId: finalWorkflow.id,
        result, // <-- Include result for immediate application
      });

      return result;

    } catch (error: any) {
      wfLog('workflow_modify_error', { error: error.message, operation });
      return { ok: false, error: error.message };
    }
  },
});

// Helper functions for JSON path operations
function parseJsonPath(path: string): string[] | null {
  // Simple JSON path parser: handles dot notation and array indices
  // Examples: "nodes[0]", "name", "nodes[0].args.message", "triggers[1].position.x"
  const parts: string[] = [];
  let current = '';
  let inBrackets = false;

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === '.') {
      if (!inBrackets) {
        if (current) parts.push(current);
        current = '';
      } else {
        current += char;
      }
    } else if (char === '[') {
      if (!inBrackets && current) {
        parts.push(current);
        current = '';
      }
      inBrackets = true;
      current += char;
    } else if (char === ']') {
      current += char;
      inBrackets = false;
    } else {
      current += char;
    }
  }

  if (current) parts.push(current);

  return parts.length > 0 ? parts : null;
}

function getJsonValue(obj: any, pathParts: string[]): any {
  let current = obj;

  for (const part of pathParts) {
    if (part.includes('[') && part.includes(']')) {
      // Array access like "nodes[0]"
      const match = part.match(/^(.+)\[(\d+)\]$/);
      if (!match) return undefined;
      const [, prop, indexStr] = match;
      const index = parseInt(indexStr);

      if (prop) {
        current = current?.[prop];
      }
      if (!Array.isArray(current) || index >= current.length) return undefined;
      current = current[index];
    } else {
      // Property access
      current = current?.[part];
    }
  }

  return current;
}

function setJsonValue(obj: any, pathParts: string[], value: any): void {
  let current = obj;

  // Navigate to the parent of the final target
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];

    if (part.startsWith('[') && part.endsWith(']')) {
      // Pure array index like "[0]" (from path like "triggers[0]" split into ["triggers", "[0]"])
      const indexMatch = part.match(/^\[(\d+)\]$/);
      if (!indexMatch) throw new Error(`Invalid array index: ${part}`);
      const index = parseInt(indexMatch[1]);
      
      if (!Array.isArray(current)) throw new Error(`Expected array for index access`);
      while (current.length <= index) current.push(null);
      if (!current[index] || typeof current[index] !== 'object') {
        current[index] = {};
      }
      current = current[index];
    } else if (part.includes('[') && part.includes(']')) {
      // Combined prop + index like "nodes[0]"
      const match = part.match(/^(.+)\[(\d+)\]$/);
      if (!match) throw new Error(`Invalid array access: ${part}`);
      const [, prop, indexStr] = match;
      const index = parseInt(indexStr);

      if (prop) {
        if (!current[prop]) current[prop] = [];
        current = current[prop];
      }
      if (!Array.isArray(current)) throw new Error(`${prop} is not an array`);
      while (current.length <= index) current.push(null);
      if (!current[index] || typeof current[index] !== 'object') {
        current[index] = {};
      }
      current = current[index];
    } else {
      // Property access - create nested object if needed
      if (!current[part] || typeof current[part] !== 'object') {
        // Check if next part is an array index - if so, create array instead of object
        const nextPart = pathParts[i + 1];
        if (nextPart && (nextPart.startsWith('[') || nextPart.includes('['))) {
          current[part] = [];
        } else {
          current[part] = {};
        }
      }
      current = current[part];
    }
  }

  // Set the final value
  const lastPart = pathParts[pathParts.length - 1];
  if (lastPart.startsWith('[') && lastPart.endsWith(']')) {
    // Pure array index like "[0]"
    const indexMatch = lastPart.match(/^\[(\d+)\]$/);
    if (!indexMatch) throw new Error(`Invalid array index: ${lastPart}`);
    const index = parseInt(indexMatch[1]);
    
    if (!Array.isArray(current)) throw new Error(`Expected array for final index assignment`);
    while (current.length <= index) current.push(null);
    current[index] = value;
  } else if (lastPart.includes('[') && lastPart.includes(']')) {
    // Combined prop + index like "nodes[0]"
    const match = lastPart.match(/^(.+)\[(\d+)\]$/);
    if (!match) throw new Error(`Invalid array access: ${lastPart}`);
    const [, prop, indexStr] = match;
    const index = parseInt(indexStr);

    if (!current[prop]) current[prop] = [];
    if (!Array.isArray(current[prop])) throw new Error(`${prop} is not an array`);
    while (current[prop].length <= index) current[prop].push(null);
    current[prop][index] = value;
  } else {
    // Simple property assignment
    current[lastPart] = value;
  }
}

function deepMerge(target: any, source: any): void {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

// Re-export tools for external use
export { workflowModifyTool };
