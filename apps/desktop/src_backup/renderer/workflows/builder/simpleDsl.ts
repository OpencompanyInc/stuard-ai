/**
 * Simple Workflow DSL v2
 * 
 * A human-readable format that handles both simple and complex workflows.
 * Complex args (objects/arrays) are shown as inline JSON.
 * 
 * Simple Example:
 * ```
 * workflow "My Automation"
 * trigger: hotkey "Ctrl+Alt+S"
 * 
 * steps:
 *   - screenshot
 *   - analyze prompt="What's on screen?"
 *   - log "Done!"
 * ```
 * 
 * Complex Example (custom_ui):
 * ```
 * workflow "UI Demo"
 * trigger: manual
 * 
 * steps:
 *   - custom_ui:
 *       id: "my-ui"
 *       window: { width: 300, height: 200 }
 *       layout: { type: "div", children: [...] }
 * ```
 */

import type { DesignerModel, DesignerNode, DesignerTrigger, DesignerWire } from '../types';

// ============================================================================
// Tool Aliases
// ============================================================================

const TOOL_ALIASES: Record<string, string> = {
  'screenshot': 'take_screenshot',
  'click': 'click_at_coordinates',
  'type': 'type_text',
  'analyze': 'analyze_current_screen',
  'run': 'run_command',
  'log': 'log',
  'wait': 'wait',
  'focus': 'focus_window',
  'read': 'read_file',
  'write': 'write_file',
};

const REVERSE_TOOL_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_ALIASES).map(([k, v]) => [v, k])
);

const TRIGGER_ALIASES: Record<string, string> = {
  'webhook': 'webhook.local',
  'hotkey': 'hotkey',
  'schedule': 'schedule.cron',
  'file': 'fs.watch',
  'manual': 'manual',
};

const REVERSE_TRIGGER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(TRIGGER_ALIASES).map(([k, v]) => [v, k])
);

// ============================================================================
// Helpers
// ============================================================================

function isSimpleValue(val: any): boolean {
  return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean';
}

function hasComplexArgs(args: Record<string, any>): boolean {
  return Object.values(args).some(v => !isSimpleValue(v));
}

function formatValue(val: any): string {
  if (typeof val === 'string') {
    // Escape quotes
    const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  // Complex value - use compact JSON
  return JSON.stringify(val);
}

function indent(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return str.split('\n').map(line => pad + line).join('\n');
}

// ============================================================================
// Generate DSL from DesignerModel
// ============================================================================

export function generateSimpleDsl(model: DesignerModel): string {
  const lines: string[] = [];
  
  // Header
  lines.push(`workflow "${model.name || 'Untitled'}"`);
  
  // Triggers
  if (model.triggers.length > 0) {
    lines.push('');
    for (const t of model.triggers) {
      const alias = REVERSE_TRIGGER_ALIASES[t.type] || t.type;
      let triggerLine = `trigger: ${alias}`;
      
      if (t.type === 'hotkey' && t.args?.accelerator) {
        triggerLine += ` "${t.args.accelerator}"`;
      } else if (t.type === 'schedule.cron' && t.args?.cron) {
        triggerLine += ` "${t.args.cron}"`;
      } else if (t.type === 'fs.watch' && t.args?.path) {
        triggerLine += ` "${t.args.path}"`;
      }
      
      if (t.label && t.label !== alias && t.label !== t.type) {
        triggerLine += ` as "${t.label}"`;
      }
      
      lines.push(triggerLine);
    }
  }
  
  // Steps
  if (model.nodes.length > 0) {
    lines.push('');
    lines.push('steps:');
    
    const order = getExecutionOrder(model.nodes, model.wires);
    
    for (const node of order) {
      const stepLines = formatStep(node);
      lines.push(stepLines);
    }
  }
  
  // Wires summary (for non-linear flows)
  const nonLinearWires = findNonLinearWires(model);
  if (nonLinearWires.length > 0) {
    lines.push('');
    lines.push('# Non-linear connections:');
    for (const w of nonLinearWires) {
      lines.push(`# ${w.from} -> ${w.to}${w.guard && w.guard !== 'always' ? ` [${w.guard}]` : ''}`);
    }
  }
  
  return lines.join('\n');
}

function formatStep(node: DesignerNode): string {
  const tool = node.tool || 'noop';
  const alias = REVERSE_TOOL_ALIASES[tool] || tool;
  const args = node.args || {};
  const argKeys = Object.keys(args).filter(k => args[k] !== undefined && args[k] !== '');
  
  // Label comment
  const labelComment = node.label && node.label !== tool && node.label !== alias 
    ? `  # ${node.label}` 
    : '';
  
  // No args
  if (argKeys.length === 0) {
    return `  - ${alias}${labelComment}`;
  }
  
  // Check if any arg is complex
  if (hasComplexArgs(args)) {
    // Use YAML-like block format
    const lines = [`  - ${alias}:${labelComment}`];
    for (const key of argKeys) {
      const val = args[key];
      if (isSimpleValue(val)) {
        lines.push(`      ${key}: ${formatValue(val)}`);
      } else {
        // Format JSON nicely with proper indentation
        const jsonStr = JSON.stringify(val, null, 2);
        if (jsonStr.length < 60 && !jsonStr.includes('\n')) {
          // Compact inline
          lines.push(`      ${key}: ${jsonStr}`);
        } else {
          // Multi-line with proper indent
          lines.push(`      ${key}: |`);
          lines.push(indent(jsonStr, 8));
        }
      }
    }
    return lines.join('\n');
  }
  
  // Simple args - inline format
  // Single simple arg shortcut
  if (argKeys.length === 1) {
    const key = argKeys[0];
    const val = args[key];
    if (['message', 'text', 'prompt', 'path', 'cmd'].includes(key) && typeof val === 'string') {
      return `  - ${alias} ${formatValue(val)}${labelComment}`;
    }
  }
  
  // Multiple simple args
  const argParts = argKeys.map(k => `${k}=${formatValue(args[k])}`).join(' ');
  return `  - ${alias} ${argParts}${labelComment}`;
}

function getExecutionOrder(nodes: DesignerNode[], wires: DesignerWire[]): DesignerNode[] {
  if (nodes.length === 0) return [];
  
  const inbound = new Set(wires.map(w => w.to));
  const startNodes = nodes.filter(n => !inbound.has(n.id));
  
  const visited = new Set<string>();
  const order: DesignerNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  
  const outgoing = new Map<string, string[]>();
  for (const wire of wires) {
    if (!outgoing.has(wire.from)) outgoing.set(wire.from, []);
    outgoing.get(wire.from)!.push(wire.to);
  }
  
  const queue = startNodes.length > 0 ? [...startNodes] : [nodes[0]];
  
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    order.push(node);
    
    for (const childId of outgoing.get(node.id) || []) {
      const child = nodeMap.get(childId);
      if (child && !visited.has(childId)) queue.push(child);
    }
  }
  
  // Add any disconnected nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) order.push(node);
  }
  
  return order;
}

function findNonLinearWires(model: DesignerModel): DesignerWire[] {
  // Find wires that skip nodes or branch
  const outCount = new Map<string, number>();
  for (const w of model.wires) {
    outCount.set(w.from, (outCount.get(w.from) || 0) + 1);
  }
  
  return model.wires.filter(w => {
    // Branching (multiple outputs from same node)
    if ((outCount.get(w.from) || 0) > 1) return true;
    // Guarded wire
    if (w.guard && w.guard !== 'always') return true;
    return false;
  });
}

// ============================================================================
// Generate Quick One-liner Format
// ============================================================================

export function generateQuickFormat(model: DesignerModel): string {
  const parts: string[] = [];
  
  // Name + trigger
  let header = `workflow "${model.name}"`;
  if (model.triggers.length > 0) {
    const t = model.triggers[0];
    const alias = REVERSE_TRIGGER_ALIASES[t.type] || t.type;
    if (t.type === 'hotkey' && t.args?.accelerator) {
      header += ` on ${alias} "${t.args.accelerator}"`;
    } else if (t.type !== 'webhook.local' && t.type !== 'manual') {
      header += ` on ${alias}`;
    }
  }
  parts.push(header);
  
  // Steps as chain (only for simple workflows)
  if (model.nodes.length > 0 && model.nodes.length <= 5) {
    const order = getExecutionOrder(model.nodes, model.wires);
    const hasComplex = order.some(n => hasComplexArgs(n.args || {}));
    
    if (!hasComplex) {
      const stepParts = order.map(node => {
        const tool = node.tool || 'noop';
        const alias = REVERSE_TOOL_ALIASES[tool] || tool;
        const args = node.args || {};
        const keys = Object.keys(args).filter(k => args[k]);
        
        if (keys.length === 0) return alias;
        if (keys.length === 1) {
          const v = args[keys[0]];
          if (typeof v === 'string') return `${alias} "${v}"`;
          return `${alias} ${v}`;
        }
        return alias;
      });
      
      parts.push(stepParts.join(' -> '));
      return parts.join('\n');
    }
  }
  
  // Fallback: indicate complexity
  parts.push(`# ${model.nodes.length} steps (use Simple DSL for full view)`);
  return parts.join('\n');
}

// ============================================================================
// Parse Simple DSL to DesignerModel
// ============================================================================

export function parseSimpleDsl(dsl: string): DesignerModel {
  const lines = dsl.split('\n');
  
  let name = 'Workflow';
  const triggers: DesignerTrigger[] = [];
  const nodes: DesignerNode[] = [];
  const wires: DesignerWire[] = [];
  
  let i = 0;
  let currentStep: { tool: string; args: Record<string, any>; label?: string } | null = null;
  let multilineKey: string | null = null;
  let multilineBuffer: string[] = [];
  let multilineIndent = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      i++;
      continue;
    }
    
    // Handle multiline value
    if (multilineKey && currentStep) {
      const lineIndent = line.search(/\S/);
      if (lineIndent > multilineIndent) {
        multilineBuffer.push(line.slice(multilineIndent + 2));
        i++;
        continue;
      } else {
        // End of multiline
        try {
          currentStep.args[multilineKey] = JSON.parse(multilineBuffer.join('\n'));
        } catch {
          currentStep.args[multilineKey] = multilineBuffer.join('\n');
        }
        multilineKey = null;
        multilineBuffer = [];
      }
    }
    
    // Workflow name
    const workflowMatch = trimmed.match(/^workflow\s+["'](.+?)["']/i);
    if (workflowMatch) {
      name = workflowMatch[1];
      
      // Inline trigger
      const inlineTrigger = trimmed.match(/on\s+(\w+)(?:\s+["'](.+?)["'])?/i);
      if (inlineTrigger) {
        triggers.push(createTrigger(inlineTrigger[1], inlineTrigger[2], triggers.length));
      }
      i++;
      continue;
    }
    
    // Trigger
    const triggerMatch = trimmed.match(/^trigger:\s*(\w+)(?:\s+["'](.+?)["'])?/i);
    if (triggerMatch) {
      triggers.push(createTrigger(triggerMatch[1], triggerMatch[2], triggers.length));
      i++;
      continue;
    }
    
    // Steps section
    if (trimmed === 'steps:') {
      i++;
      continue;
    }
    
    // Step line
    const stepMatch = trimmed.match(/^-\s*(\w+)(?::?\s*(.*))?$/);
    if (stepMatch) {
      // Save previous step
      if (currentStep) {
        nodes.push(createNode(currentStep, nodes.length));
      }
      
      const tool = stepMatch[1];
      const rest = stepMatch[2]?.trim() || '';
      
      currentStep = {
        tool: TOOL_ALIASES[tool] || tool,
        args: {},
      };
      
      // Parse inline args
      if (rest && !rest.endsWith(':')) {
        parseInlineArgs(rest, currentStep);
      }
      
      i++;
      continue;
    }
    
    // Arg line (under a step)
    if (currentStep && line.match(/^\s+\w+:/)) {
      const argMatch = trimmed.match(/^(\w+):\s*(.*)$/);
      if (argMatch) {
        const key = argMatch[1];
        const val = argMatch[2];
        
        if (val === '|') {
          // Start multiline
          multilineKey = key;
          multilineBuffer = [];
          multilineIndent = line.search(/\S/);
        } else if (val) {
          // Inline value
          try {
            currentStep.args[key] = JSON.parse(val);
          } catch {
            // Try unquoted string
            const unquoted = val.replace(/^["'](.*)["']$/, '$1');
            currentStep.args[key] = unquoted;
          }
        }
      }
      i++;
      continue;
    }
    
    // One-liner format: tool -> tool -> tool
    if (trimmed.includes(' -> ')) {
      const parts = trimmed.split(' -> ').map(p => p.trim());
      for (const part of parts) {
        const match = part.match(/^(\w+)(?:\s+["'](.+?)["'])?$/);
        if (match) {
          const tool = TOOL_ALIASES[match[1]] || match[1];
          const arg = match[2];
          const step = { tool, args: {} as Record<string, any> };
          if (arg) {
            const defaultKey = getDefaultArgKey(tool);
            step.args[defaultKey] = arg;
          }
          nodes.push(createNode(step, nodes.length));
        }
      }
      i++;
      continue;
    }
    
    i++;
  }
  
  // Save last step
  if (currentStep) {
    nodes.push(createNode(currentStep, nodes.length));
  }
  
  // Default trigger if none
  if (triggers.length === 0) {
    triggers.push(createTrigger('manual', undefined, 0));
  }
  
  // Create wires
  // Trigger -> first node
  if (nodes.length > 0) {
    for (const t of triggers) {
      wires.push({ from: t.id, to: nodes[0].id });
    }
  }
  
  // Chain nodes
  for (let j = 0; j < nodes.length - 1; j++) {
    wires.push({ from: nodes[j].id, to: nodes[j + 1].id });
  }
  
  return {
    id: name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, ''),
    name,
    version: '1',
    triggers,
    nodes,
    wires,
  };
}

function createTrigger(type: string, value: string | undefined, index: number): DesignerTrigger {
  const normalizedType = TRIGGER_ALIASES[type.toLowerCase()] || type;
  const args: Record<string, any> = {};
  
  if (normalizedType === 'hotkey' && value) args.accelerator = value;
  if (normalizedType === 'schedule.cron' && value) args.cron = value;
  if (normalizedType === 'fs.watch' && value) args.path = value;
  
  return {
    id: `trigger_${index}`,
    type: normalizedType,
    label: type,
    args,
    position: { x: 60, y: 60 + index * 80 },
  };
}

function createNode(step: { tool: string; args: Record<string, any>; label?: string }, index: number): DesignerNode {
  return {
    id: `step_${index}`,
    type: 'local.tool',
    tool: step.tool,
    label: step.label || step.tool,
    args: step.args,
    position: { x: 280 + (index % 4) * 180, y: 60 + Math.floor(index / 4) * 100 },
  };
}

function parseInlineArgs(rest: string, step: { tool: string; args: Record<string, any>; label?: string }): void {
  // Check for simple quoted value
  const simpleQuoted = rest.match(/^["'](.+?)["']$/);
  if (simpleQuoted) {
    const key = getDefaultArgKey(step.tool);
    step.args[key] = simpleQuoted[1];
    return;
  }
  
  // Check for label: # label
  const labelMatch = rest.match(/#\s*(.+)$/);
  if (labelMatch) {
    step.label = labelMatch[1].trim();
    rest = rest.replace(/#\s*.+$/, '').trim();
  }
  
  // Parse key=value pairs
  const kvPattern = /(\w+)=(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let match;
  while ((match = kvPattern.exec(rest)) !== null) {
    const key = match[1];
    const val = match[2] || match[3] || match[4];
    try {
      step.args[key] = JSON.parse(val);
    } catch {
      step.args[key] = val;
    }
  }
}

function getDefaultArgKey(tool: string): string {
  if (['log'].includes(tool)) return 'message';
  if (['type_text'].includes(tool)) return 'text';
  if (['analyze_current_screen', 'analyze_image', 'analyze_media'].includes(tool)) return 'prompt';
  if (['read_file', 'write_file'].includes(tool)) return 'path';
  if (['run_command'].includes(tool)) return 'cmd';
  if (['wait'].includes(tool)) return 'ms';
  if (['focus_window'].includes(tool)) return 'title';
  return 'value';
}
