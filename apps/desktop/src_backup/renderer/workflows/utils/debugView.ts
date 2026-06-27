/**
 * Debug view generator for workflow visualization
 */
import type { DesignerModel } from "../types";
import type { ValidationError } from "../builder/compiler";

export function generateDebugView(model: DesignerModel, errors: ValidationError[]): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════');
  lines.push(`  WORKFLOW DEBUG: ${model.name || model.id}`);
  lines.push('═══════════════════════════════════════');
  lines.push('');
  
  // Errors Section
  if (errors.length > 0) {
    lines.push('┌─ ERRORS & WARNINGS ─────────────────');
    for (const e of errors) {
      const icon = e.type === 'error' ? '❌' : '⚠️';
      lines.push(`│ ${icon} ${e.message}`);
      if (e.nodeId) lines.push(`│    └─ Node: ${e.nodeId}`);
    }
    lines.push('└─────────────────────────────────────');
    lines.push('');
  } else {
    lines.push('✅ No validation errors');
    lines.push('');
  }
  
  // Structure Section
  lines.push('┌─ STRUCTURE ──────────────────────────');
  lines.push(`│ ID: ${model.id}`);
  lines.push(`│ Version: ${model.version || '1'}`);
  lines.push(`│ Triggers: ${model.triggers?.length || 0}`);
  lines.push(`│ Steps: ${model.nodes?.length || 0}`);
  lines.push(`│ Wires: ${model.wires?.length || 0}`);
  lines.push('└─────────────────────────────────────');
  lines.push('');
  
  // Triggers Detail
  if (model.triggers?.length > 0) {
    lines.push('┌─ TRIGGERS ───────────────────────────');
    for (const t of model.triggers) {
      lines.push(`│ [${t.id}] ${t.type}`);
      if (t.label && t.label !== t.type) lines.push(`│    label: "${t.label}"`);
      const argKeys = Object.keys(t.args || {});
      if (argKeys.length > 0) {
        for (const k of argKeys) {
          const v = t.args[k];
          const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          lines.push(`│    ${k}: ${vStr.length > 40 ? vStr.slice(0, 40) + '...' : vStr}`);
        }
      }
    }
    lines.push('└─────────────────────────────────────');
    lines.push('');
  }
  
  // Steps Detail
  if (model.nodes?.length > 0) {
    lines.push('┌─ STEPS ──────────────────────────────');
    for (const n of model.nodes) {
      const tool = n.tool || n.type;
      lines.push(`│ [${n.id}] ${tool}`);
      if (n.label && n.label !== tool) lines.push(`│    label: "${n.label}"`);
      const argKeys = Object.keys(n.args || {});
      if (argKeys.length > 0) {
        for (const k of argKeys) {
          const v = n.args[k];
          const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
          lines.push(`│    ${k}: ${vStr.length > 40 ? vStr.slice(0, 40) + '...' : vStr}`);
        }
      }
      // Find outgoing wires
      const outWires = model.wires?.filter(w => w.from === n.id) || [];
      if (outWires.length > 0) {
        lines.push(`│    → ${outWires.map(w => w.to + (w.guard && w.guard !== 'always' ? ` [${w.guard}]` : '')).join(', ')}`);
      }
    }
    lines.push('└─────────────────────────────────────');
    lines.push('');
  }
  
  // Execution Flow
  lines.push('┌─ EXECUTION FLOW ─────────────────────');
  const visited = new Set<string>();
  const triggerIds = model.triggers?.map(t => t.id) || [];
  
  function traceFlow(nodeId: string, depth: number): void {
    if (visited.has(nodeId)) {
      lines.push(`│ ${'  '.repeat(depth)}↻ (cycle to ${nodeId})`);
      return;
    }
    visited.add(nodeId);
    
    const node = model.nodes?.find(n => n.id === nodeId);
    const trigger = model.triggers?.find(t => t.id === nodeId);
    const label = node?.label || node?.tool || trigger?.label || trigger?.type || nodeId;
    
    lines.push(`│ ${'  '.repeat(depth)}${depth === 0 ? '▶' : '→'} ${label} [${nodeId}]`);
    
    const outWires = model.wires?.filter(w => w.from === nodeId) || [];
    for (const w of outWires) {
      traceFlow(w.to, depth + 1);
    }
  }
  
  for (const tId of triggerIds) {
    traceFlow(tId, 0);
  }
  
  // Check for orphan nodes
  const allReferenced = new Set([
    ...triggerIds,
    ...(model.wires?.flatMap(w => [w.from, w.to]) || [])
  ]);
  const orphans = model.nodes?.filter(n => !allReferenced.has(n.id)) || [];
  if (orphans.length > 0) {
    lines.push('│');
    lines.push('│ ⚠️ ORPHAN NODES (not connected):');
    for (const o of orphans) {
      lines.push(`│   • ${o.label || o.tool} [${o.id}]`);
    }
  }
  
  lines.push('└─────────────────────────────────────');
  
  return lines.join('\n');
}
