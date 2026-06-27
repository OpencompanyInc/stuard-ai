/**
 * Shared DesignerModel → StuardSpec converter.
 *
 * Pure compile-time transform from the workflow builder's node/wire model into
 * the executable StuardSpec consumed by both engines. No tool execution, no
 * platform coupling. Canonicalized on the desktop engine's converter.
 *
 * Platform options:
 *  - `triggerId`: compile starting from a specific trigger (call_function).
 *  - `normalizeKind`: when provided (the VM passes its mapper), each step is
 *    annotated with `kind` + `designerType` for routing. Desktop omits it and
 *    routes purely by tool name, so its output is unchanged.
 *  - `autostart`: override the spec's autostart flag (the VM forces false).
 */

import type { StuardSpec, StuardStep, StuardEdge, StuardStepKind } from './types';

export interface DesignerToSpecOptions {
  triggerId?: string;
  normalizeKind?: (value: any) => StuardStepKind | undefined;
  autostart?: boolean;
}

export function sanitizeGuard(guard: any): any {
  if (!guard || typeof guard !== 'object') return guard;
  if (guard === 'always') return guard;
  if (Array.isArray(guard)) return guard.map(sanitizeGuard);

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(guard)) {
    // Fix LLM double-quoting of operator keys (e.g. '"=="' → '==').
    const stripped = key.replace(/^"+|"+$/g, '');
    cleaned[stripped || key] = sanitizeGuard(value);
  }
  return cleaned;
}

export function designerModelToStuardSpec(m: any, opts: DesignerToSpecOptions = {}): StuardSpec {
  const { triggerId, normalizeKind } = opts;
  const id = String(m?.id || '').trim() || 'stuard_' + Math.random().toString(36).slice(2, 8);
  const name = String(m?.name || 'My Stuard');
  const version = String(m?.version || '1');
  const autostart = opts.autostart !== undefined ? opts.autostart : !!m?.autostart;
  const nodes = Array.isArray(m?.nodes) ? m.nodes : [];
  const wires = Array.isArray(m?.wires) ? m.wires : [];
  const triggersIn = Array.isArray(m?.triggers) ? m.triggers : [];

  const steps: StuardStep[] = nodes.map((n: any) => {
    const fromId = String(n?.id || '');
    // Filter out callNode wires — they're on-demand dispatches from custom_ui,
    // not part of the normal execution flow.
    const outs = wires.filter((w: any) => String(w?.from || '') === fromId && !(w as any)?.callNode);
    const next: StuardEdge[] = outs.map((w: any) => {
      const to = String(w?.to || '');
      const gRaw = (w as any)?.guard;
      const g = (gRaw && typeof gRaw === 'object') ? sanitizeGuard(gRaw) : gRaw;
      let guard: any = 'always';
      if (g && typeof g === 'object') {
        if (g.if) {
          guard = { if: g.if };
        } else if (g.ai) {
          guard = { ai: g.ai };
        } else {
          // Raw JSONLogic (not wrapped in .if). Treat empty / {"===":[true,true]} as always.
          const isEmpty = !g || Object.keys(g).length === 0;
          const isAlwaysTrue = isEmpty || (g['==='] && Array.isArray(g['===']) &&
            g['==='][0] === true && g['==='][1] === true);
          guard = isAlwaysTrue ? 'always' : { if: g };
        }
      }
      const edge: any = { to, guard };
      if ((w as any)?.label) edge.label = String((w as any).label);
      const loop = (w as any)?.loop;
      if (loop && typeof loop === 'object' && loop.type) {
        edge.loop = {
          type: loop.type,
          items: loop.items,
          itemVar: loop.itemVar || 'item',
          indexVar: loop.indexVar || 'index',
          count: loop.count,
          conditionText: loop.conditionText,
          maxIterations: loop.maxIterations || 100,
          delayMs: loop.delayMs || 0,
        };
      }
      if ((w as any)?.loopBreak) edge.loopBreak = true;
      const loopFanoutMode = (w as any)?.loopFanoutMode;
      if (loopFanoutMode === 'wait' || loopFanoutMode === 'parallel') {
        edge.loopFanoutMode = loopFanoutMode;
      }
      const stream = (w as any)?.stream;
      if (stream && typeof stream === 'object') {
        edge.stream = {
          sourceField: stream.sourceField || 'streamId',
          mode: stream.mode || 'reactive',
          ...(stream.bufferSize ? { bufferSize: stream.bufferSize } : {}),
        };
      }
      return edge;
    });

    const step: any = { id: fromId, tool: String(n?.tool || 'noop'), args: n?.args || {}, next };
    // Optional routing annotation (VM): map the designer node type → step kind.
    if (normalizeKind) {
      const designerType = String(n?.type || '').trim();
      const normalizedKind = normalizeKind(designerType || n?.kind);
      if (normalizedKind) step.kind = normalizedKind;
      if (designerType) step.designerType = designerType;
    }
    if (n?.label) step.label = String(n.label);
    if (n?.waitForAll === true) step.waitForAll = true;
    if (n && typeof n.fallbackTo === 'string' && n.fallbackTo.trim()) {
      step.fallback = { to: n.fallbackTo.trim() };
    }
    return step;
  });

  // Find start node: the node trigger wires point to, else first node with no inbound wire.
  const triggerIdsSet = new Set(triggersIn.map((t: any) => String(t?.id || '')).filter(Boolean));
  let startNodeId: string | undefined;

  const makeParallelStart = (targets: string[]): string => {
    const syntheticStartId = '_trigger_parallel_start';
    steps.unshift({
      id: syntheticStartId,
      tool: 'noop',
      args: {},
      next: targets.map(t => ({ to: t, guard: 'always' as any })),
    });
    return syntheticStartId;
  };

  if (triggerId) {
    const triggerWires = wires.filter((w: any) => String(w?.from || '') === triggerId);
    const targets: string[] = Array.from(new Set(triggerWires.map((w: any) => String(w?.to || '')).filter(Boolean))) as string[];
    if (targets.length > 1) startNodeId = makeParallelStart(targets);
    else if (targets.length === 1) startNodeId = targets[0];
  }

  if (!startNodeId) {
    const triggerTargets = wires
      .filter((w: any) => triggerIdsSet.has(String(w?.from || '')) || String(w?.from || '').startsWith('trig_'))
      .map((w: any) => String(w?.to || '')).filter(Boolean);
    const unique: string[] = Array.from(new Set(triggerTargets)) as string[];
    if (unique.length > 1) startNodeId = makeParallelStart(unique);
    else if (unique.length === 1) startNodeId = unique[0];
  }

  if (!startNodeId) {
    const nodeWires = wires.filter((w: any) => !triggerIdsSet.has(String(w?.from || '')) && !String(w?.from || '').startsWith('trig_'));
    const inbound = new Set<string>(nodeWires.map((w: any) => String(w?.to || '')).filter(Boolean));
    const startNode = nodes.find((n: any) => !inbound.has(String(n?.id || ''))) || nodes[0];
    startNodeId = startNode ? String(startNode.id) : undefined;
  }

  const triggers = triggersIn.map((t: any) => {
    const tid = String(t?.id || '');
    const triggerWires = wires.filter((w: any) => String(w?.from || '') === tid);
    const triggerStarts = triggerWires.map((w: any) => String(w?.to || '')).filter(Boolean);
    return {
      id: tid,
      type: String(t?.type || ''),
      args: t?.args || {},
      inputParams: Array.isArray(t?.inputParams) ? t.inputParams
        : Array.isArray(t?.args?.inputParams) ? t.args.inputParams : undefined,
      start: triggerStarts[0],
      startNodes: triggerStarts.length > 1 ? triggerStarts : undefined,
    };
  });

  const spec: any = { id, name, version, autostart, triggers, steps, start: startNodeId };

  // Preserve workflow-as-function output schema when present.
  if (Array.isArray(m?.outputSchema) && m.outputSchema.length > 0) {
    spec.outputSchema = m.outputSchema;
  }

  return spec as StuardSpec;
}
