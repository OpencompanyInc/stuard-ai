/**
 * Compiler - Converts between DesignerModel and StuardSpec
 * 
 * The DesignerModel is the visual representation (nodes, wires, positions)
 * The StuardSpec is the runtime format (steps with next[] arrays)
 * 
 * This compiler enables real-time preview as users drag and connect nodes.
 */

import type { DesignerModel, DesignerNode, DesignerTrigger, DesignerWire, StuardSpec } from './types';
import { guardToString } from './guards';
import { getShortcutForTool } from './shortcuts';
import { validateWorkflowGraph, type WorkflowValidationIssue } from './topology';

// ============================================================================
// DesignerModel → StuardSpec (Compile)
// ============================================================================

export function compileDesignerModel(model: DesignerModel): StuardSpec {
  const { id, name, version, autostart, requirements, scripts } = model;
  const triggers = model.triggers || [];
  const nodes = model.nodes || [];
  const wires = model.wires || [];

  // Build wire lookup: from_id → [{ to, guard, label, loop, loopBreak, loopFanoutMode, stream }]
  const wiresByFrom = new Map<string, Array<{ to: string; guard: any; label?: string; loop?: any; loopBreak?: boolean; loopFanoutMode?: 'wait' | 'parallel'; stream?: any }>>();
  for (const wire of wires) {
    const fromId = wire.from;
    if (!wiresByFrom.has(fromId)) {
      wiresByFrom.set(fromId, []);
    }
    wiresByFrom.get(fromId)!.push({
      to: wire.to,
      guard: wire.guard || 'always',
      label: wire.label,
      loop: (wire as any).loop,
      loopBreak: (wire as any).loopBreak,
      loopFanoutMode: (wire as any).loopFanoutMode,
      stream: (wire as any).stream,
    });
  }

  // Convert nodes to steps
  const steps = nodes.map(node => {
    const outgoing = wiresByFrom.get(node.id) || [];
    const next = outgoing.length > 0 ? outgoing.map(w => ({
      to: w.to,
      guard: w.guard,
      ...(w.label ? { label: w.label } : {}),
      ...(w.loop ? { loop: w.loop } : {}),
      ...(w.loopBreak ? { loopBreak: true } : {}),
      ...(w.loopFanoutMode ? { loopFanoutMode: w.loopFanoutMode } : {}),
      ...(w.stream ? { stream: w.stream } : {}),
    })) : undefined;

    return {
      id: node.id,
      tool: node.tool || 'noop',
      args: node.args || {},
      ...(next ? { next } : {}),
      ...(node.fallbackTo ? { fallback: { to: node.fallbackTo } } : {}),
      ...(node.waitForAll ? { waitForAll: true } : {}),
    };
  });

  // Convert triggers
  const triggerSpecs = triggers.map(t => ({
    type: t.type,
    args: t.args || {},
  }));

  // Determine start step (first node with no incoming wires)
  const inbound = new Set(wires.map(w => w.to));
  const startNode = nodes.find(n => !inbound.has(n.id)) || nodes[0];

  return {
    id,
    name,
    version,
    autostart: autostart || false,
    triggers: triggerSpecs.length > 0 ? triggerSpecs : [{ type: 'manual', args: {} }],
    steps,
    ...(startNode ? { start: startNode.id } : {}),
    ...(requirements ? { requirements } : {}),
    ...(scripts && Object.keys(scripts).length > 0 ? { scripts } : {}),
  };
}

// ============================================================================
// StuardSpec → DesignerModel (Decompile)
// ============================================================================

export function decompileToDesignerModel(spec: StuardSpec): DesignerModel {
  const { id, name, version, autostart, triggers, steps, requirements, scripts } = spec;

  // Convert steps to nodes with auto-layout
  const nodes: DesignerNode[] = (steps || []).map((step, i) => ({
    id: step.id,
    type: 'local.tool',
    tool: step.tool,
    label: step.id,
    args: step.args || {},
    fallbackTo: step.fallback?.to,
    waitForAll: step.waitForAll,
    position: calculateNodePosition(i, (steps || []).length),
  }));

  // Extract wires from step.next arrays
  const wires: DesignerWire[] = [];
  for (const step of (steps || [])) {
    if (step.next) {
      for (const edge of step.next) {
        wires.push({
          from: step.id,
          to: edge.to,
          guard: edge.guard,
          label: edge.label,
          loop: (edge as any).loop,
          loopBreak: (edge as any).loopBreak,
          loopFanoutMode: (edge as any).loopFanoutMode,
          stream: (edge as any).stream,
        });
      }
    }
  }

  // Convert triggers
  const designerTriggers: DesignerTrigger[] = (triggers || []).map((t, i) => ({
    id: `trigger_${i}`,
    type: t.type,
    label: t.type,
    args: t.args || {},
    position: { x: 20, y: 20 + i * 70 },
  }));

  return {
    id,
    name: name || 'Workflow',
    version: version || '1',
    autostart,
    triggers: designerTriggers,
    nodes,
    wires,
    requirements,
    scripts,
  };
}

function calculateNodePosition(index: number, total: number): { x: number; y: number } {
  // Layout nodes in a grid pattern
  const cols = Math.min(4, Math.ceil(Math.sqrt(total)));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 180 + col * 200,
    y: 60 + row * 120,
  };
}

// ============================================================================
// Generate Code Preview (for live display)
// ============================================================================

export interface CodePreview {
  /** Fluent builder code */
  builder: string;
  /** Raw JSON spec */
  json: string;
  /** Simplified YAML-like format */
  simple: string;
}

export function generateCodePreview(model: DesignerModel): CodePreview {
  // Ensure model has required arrays (defensive)
  const safeModel: DesignerModel = {
    ...model,
    nodes: model.nodes || [],
    wires: model.wires || [],
    triggers: model.triggers || [],
    name: model.name || 'Workflow',
    version: model.version || '1',
    id: model.id || 'workflow',
  };
  
  const spec = compileDesignerModel(safeModel);
  
  return {
    builder: generateBuilderCode(safeModel),
    json: JSON.stringify(spec, null, 2),
    simple: generateSimpleFormat(safeModel),
  };
}

function generateBuilderCode(model: DesignerModel): string {
  const lines: string[] = [];
  
  lines.push(`Stuard.workflow("${model.name}")`);
  
  if (model.version !== '1') {
    lines.push(`  .version("${model.version}")`);
  }
  
  if (model.autostart) {
    lines.push(`  .autostart()`);
  }

  // Triggers
  for (const trigger of model.triggers) {
    const type = trigger.type;
    if (type === 'manual') {
      lines.push(`  .manual()`);
    } else if (type === 'app_start') {
      lines.push(`  .onAppStart()`);
    } else if (type === 'hotkey' && trigger.args?.accelerator) {
      lines.push(`  .onHotkey("${trigger.args.accelerator}")`);
    } else if (type === 'schedule.cron' && trigger.args?.cron) {
      lines.push(`  .onSchedule("${trigger.args.cron}")`);
    } else if (type === 'webhook' || type === 'webhook.local' || type === 'webhook.cloud') {
      const wMode = type === 'webhook.local' ? 'local' : type === 'webhook.cloud' ? 'cloud' : (trigger.args?.mode || 'cloud');
      lines.push(`  .onWebhook(${wMode === 'cloud' ? 'true' : ''})`);
    } else if (type === 'gmail.new_email') {
      lines.push(`  .onGmailNewEmail(${JSON.stringify(trigger.args || {})})`);
    } else if (type === 'drive.new_file') {
      lines.push(`  .onDriveNewFile(${JSON.stringify(trigger.args || {})})`);
    } else if (type === 'fs.watch' && trigger.args?.path) {
      lines.push(`  .onFileChange("${trigger.args.path}"${trigger.args.pattern ? `, "${trigger.args.pattern}"` : ''})`);
    } else {
      lines.push(`  .trigger("${type}", ${JSON.stringify(trigger.args)})`);
    }
  }

  // Build execution order from wires
  const executionOrder = buildExecutionOrder(model.nodes, model.wires);
  
  // Steps
  for (const node of executionOrder) {
    const shortcut = getShortcutForTool(node.tool || 'noop');
    const toolName = shortcut || node.tool || 'noop';
    const hasArgs = node.args && Object.keys(node.args).length > 0;
    
    if (hasArgs) {
      const argsStr = formatArgsForCode(node.args);
      lines.push(`  .step("${toolName}", ${argsStr})`);
    } else {
      lines.push(`  .step("${toolName}")`);
    }
  }

  lines.push(`  .build()`);
  
  return lines.join('\n');
}

function generateSimpleFormat(model: DesignerModel): string {
  const lines: string[] = [];
  
  lines.push(`name: ${model.name}`);
  if (model.version !== '1') {
    lines.push(`version: ${model.version}`);
  }
  
  // Triggers (simplified)
  if (model.triggers.length > 0) {
    const trigger = model.triggers[0];
    if (trigger.type === 'hotkey' && trigger.args?.accelerator) {
      lines.push(`trigger: hotkey ${trigger.args.accelerator}`);
    } else if (trigger.type === 'schedule.cron' && trigger.args?.cron) {
      lines.push(`trigger: schedule "${trigger.args.cron}"`);
    } else if (trigger.type === 'webhook' || trigger.type === 'webhook.local' || trigger.type === 'webhook.cloud') {
      lines.push(`trigger: webhook ${trigger.args?.mode || (trigger.type === 'webhook.local' ? 'local' : 'cloud')}`);
    } else if (trigger.type === 'gmail.new_email') {
      lines.push(`trigger: gmail.new_email`);
    } else if (trigger.type === 'drive.new_file') {
      lines.push(`trigger: drive.new_file`);
    } else if (trigger.type === 'app_start') {
      lines.push(`trigger: app_start`);
    } else if (trigger.type === 'manual') {
      lines.push(`trigger: manual`);
    } else {
      lines.push(`trigger: ${trigger.type}`);
    }
  }
  
  lines.push('');
  lines.push('steps:');
  
  // Build execution order
  const executionOrder = buildExecutionOrder(model.nodes, model.wires);
  const wiresByFrom = new Map<string, DesignerWire[]>();
  for (const wire of model.wires) {
    if (!wiresByFrom.has(wire.from)) wiresByFrom.set(wire.from, []);
    wiresByFrom.get(wire.from)!.push(wire);
  }
  
  for (const node of executionOrder) {
    const shortcut = getShortcutForTool(node.tool || 'noop');
    const toolName = shortcut || node.tool || 'noop';
    const outgoing = wiresByFrom.get(node.id) || [];
    
    // Format step
    let stepLine = `  - ${toolName}`;
    if (node.args && Object.keys(node.args).length > 0) {
      const argsStr = formatArgsSimple(node.args);
      if (argsStr.length < 40) {
        stepLine += ` ${argsStr}`;
      } else {
        stepLine += `:\n      ${argsStr}`;
      }
    }
    
    // Add guard/routing info
    if (outgoing.length > 1) {
      stepLine += ` → [${outgoing.map(w => {
        const guardStr = guardToString(w.guard);
        return guardStr !== 'always' ? `${guardStr}:${w.to}` : w.to;
      }).join(', ')}]`;
    } else if (outgoing.length === 1 && outgoing[0].guard && outgoing[0].guard !== 'always') {
      stepLine += ` → ${guardToString(outgoing[0].guard)}:${outgoing[0].to}`;
    }
    
    lines.push(stepLine);
  }
  
  return lines.join('\n');
}

function formatArgsForCode(args: Record<string, any>): string {
  const entries = Object.entries(args).filter(([_, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '{}';
  
  const parts = entries.map(([k, v]) => {
    if (typeof v === 'string') return `${k}: "${v}"`;
    if (typeof v === 'object') return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${v}`;
  });
  
  return `{ ${parts.join(', ')} }`;
}

function formatArgsSimple(args: Record<string, any>): string {
  const entries = Object.entries(args).filter(([_, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  
  if (entries.length === 1) {
    const [k, v] = entries[0];
    if (k === 'message' || k === 'text' || k === 'command' || k === 'path') {
      return typeof v === 'string' ? `"${v}"` : String(v);
    }
  }
  
  return entries.map(([k, v]) => {
    if (typeof v === 'string') return `${k}="${v}"`;
    return `${k}=${JSON.stringify(v)}`;
  }).join(' ');
}

function buildExecutionOrder(nodes: DesignerNode[], wires: DesignerWire[]): DesignerNode[] {
  if (nodes.length === 0) return [];
  
  // Find nodes with no incoming wires (start nodes)
  const inbound = new Set(wires.map(w => w.to));
  const startNodes = nodes.filter(n => !inbound.has(n.id));
  
  // BFS to determine order
  const visited = new Set<string>();
  const order: DesignerNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  
  // Build adjacency list
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
    
    // Add children to queue
    const children = outgoing.get(node.id) || [];
    for (const childId of children) {
      const child = nodeMap.get(childId);
      if (child && !visited.has(childId)) {
        queue.push(child);
      }
    }
  }
  
  // Add any disconnected nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      order.push(node);
    }
  }
  
  return order;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError extends WorkflowValidationIssue {}

function designerModelToWorkflowGraph(model: DesignerModel) {
  return {
    id: model.id,
    name: model.name,
    version: model.version,
    triggers: (model.triggers || []).map((trigger) => ({
      id: trigger.id,
      type: trigger.type,
      label: trigger.label,
      args: trigger.args || {},
      inputParams: trigger.inputParams || [],
    })),
    nodes: (model.nodes || []).map((node) => ({
      id: node.id,
      tool: node.tool || '',
      label: node.label,
      args: node.args || {},
      fallbackTo: node.fallbackTo,
      waitForAll: node.waitForAll,
    })),
    wires: (model.wires || []).map((wire, index) => ({
      index,
      from: wire.from,
      to: wire.to,
      guard: wire.guard,
      label: wire.label,
      loop: wire.loop,
      loopBreak: wire.loopBreak,
      loopFanoutMode: wire.loopFanoutMode,
      stream: wire.stream,
      callNode: wire.callNode,
    })),
    variables: model.variables || [],
  };
}

export function validateDesignerModel(model: DesignerModel): ValidationError[] {
  return validateWorkflowGraph(designerModelToWorkflowGraph(model));
}

// ============================================================================
// Helpers for UI
// ============================================================================

/**
 * Get a summary of the workflow for display
 */
export function getWorkflowSummary(model: DesignerModel): string {
  const parts: string[] = [];
  
  parts.push(`${model.nodes.length} step${model.nodes.length !== 1 ? 's' : ''}`);
  
  if (model.triggers.length > 0) {
    const triggerTypes = [...new Set(model.triggers.map(t => t.type))];
    parts.push(triggerTypes.join(', '));
  }
  
  return parts.join(' • ');
}

/**
 * Auto-generate a unique node ID
 */
export function generateNodeId(nodes: DesignerNode[], baseName: string = 'step'): string {
  const existingIds = new Set(nodes.map(n => n.id));
  let counter = nodes.length;
  let id = `${baseName}_${counter}`;
  while (existingIds.has(id)) {
    counter++;
    id = `${baseName}_${counter}`;
  }
  return id;
}

/**
 * Calculate a good position for a new node
 */
export function calculateNewNodePosition(nodes: DesignerNode[], referenceNodeId?: string): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 180, y: 60 };
  }
  
  // If reference node provided, place below/right of it
  if (referenceNodeId) {
    const ref = nodes.find(n => n.id === referenceNodeId);
    if (ref) {
      return { x: ref.position.x + 200, y: ref.position.y };
    }
  }
  
  // Otherwise place to the right of the last node
  const lastNode = nodes[nodes.length - 1];
  return { x: lastNode.position.x + 200, y: lastNode.position.y };
}
