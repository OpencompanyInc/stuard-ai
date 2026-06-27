/**
 * Shared edge-selection ("decideNext") for the workflow engines.
 *
 * Pure graph logic — given a completed step and its outgoing edges, decide which
 * edges fire next. Executes no tools. The only platform hooks are logging, the
 * `$vars` resolver for guard evaluation, and AI routing (which dispatches an LLM
 * call differently per host). Canonicalized on the desktop engine's semantics:
 *
 *  - stream edges always fire (parallel by nature)
 *  - among unconditional ("always") edges: loop edges take precedence, else
 *    regular edges run in parallel; loopBreak edges only fire after a loop
 *  - AI-routed edges are exclusive (the model picks one target)
 *  - otherwise: conditional edges are first-match-wins, and unconditional edges
 *    additionally fire unconditionally (parallel side-effects)
 *  - falls back to step.fallback.to when nothing matched
 */

import type { PathResolveOptions } from './helpers';
import { evalIfGuard, deepMerge } from './helpers';
import type { StuardSpec, StuardStep, StuardEdge } from './types';

export interface AiRouteResult {
  ok: boolean;
  next?: string;
  argsPatch?: any;
  error?: string;
}

export interface DecideNextHooks {
  logFn: (msg: string) => void;
  /** Threaded into guard evaluation so `$vars` resolves per host. */
  pathOpts?: PathResolveOptions;
  /** Host-specific AI routing (LLM picks the next target). */
  aiDecideNext: (
    spec: StuardSpec,
    step: StuardStep,
    ctx: any,
    options: Array<{ to: string; label?: string }>,
    aiCfg: any,
  ) => Promise<AiRouteResult>;
}

export interface DecideNextResult {
  edges: StuardEdge[];
  ctx: any;
  ok: boolean;
  error?: string;
}

export function isCatchAllGuard(g: any): boolean {
  if (!g || g === 'always') return true;
  if (g && typeof g === 'object' && g.if === true) return true;
  return false;
}

export async function decideNext(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  hooks: DecideNextHooks,
): Promise<DecideNextResult> {
  const log = hooks.logFn;
  const pathOpts = hooks.pathOpts;
  const rawEdges: StuardEdge[] = Array.isArray(step.next) ? step.next : [];

  const activeEdges: StuardEdge[] = [];

  // Stream edges are ALWAYS active — they run in parallel with flow edges.
  const streamEdges = rawEdges.filter(e => e.stream);
  const flowEdges = rawEdges.filter(e => !e.stream);
  activeEdges.push(...streamEdges);
  if (streamEdges.length > 0) {
    log(`[${step.id}] ${streamEdges.length} stream edge(s) detected`);
  }

  const unconditionalFlowEdges: StuardEdge[] = [];
  const conditionalFlowEdges: StuardEdge[] = [];
  for (const edge of flowEdges) {
    if (isCatchAllGuard(edge.guard)) unconditionalFlowEdges.push(edge);
    else conditionalFlowEdges.push(edge);
  }

  // Multiple unconditional edges → loop/loopBreak/parallel relationships.
  if (unconditionalFlowEdges.length > 1) {
    const loopEdges = unconditionalFlowEdges.filter(e => e.loop && e.loop.type);
    const regularEdges = unconditionalFlowEdges.filter(e => !e.loop?.type && !e.loopBreak);

    if (loopEdges.length > 0) {
      const loopEdge = loopEdges[0];
      log(`[${step.id}] Loop edge detected → ${loopEdge.to} (loopBreak edges will run after loop)`);
      activeEdges.push(loopEdge);
      return { ok: true, edges: activeEdges, ctx };
    }

    const parallelEdges = regularEdges.length > 0
      ? regularEdges
      : unconditionalFlowEdges.filter(e => !e.loopBreak);
    if (parallelEdges.length > 1) {
      log(`[${step.id}] Parallel branches: ${parallelEdges.map(e => e.to).join(', ')}`);
      activeEdges.push(...parallelEdges);
      return { ok: true, edges: activeEdges, ctx };
    }
    if (parallelEdges.length === 1) {
      activeEdges.push(parallelEdges[0]);
      return { ok: true, edges: activeEdges, ctx };
    }
  }

  const hasAiRouting = conditionalFlowEdges.some(
    e => e.guard && typeof e.guard === 'object' && e.guard.ai,
  );

  if (hasAiRouting) {
    // AI routing: exclusive first-match — the model picks the single target.
    const sortedFlowEdges = [...flowEdges].sort((a, b) => {
      const aIsDefault = isCatchAllGuard(a.guard);
      const bIsDefault = isCatchAllGuard(b.guard);
      if (aIsDefault && !bIsDefault) return 1;
      if (!aIsDefault && bIsDefault) return -1;
      return 0;
    });

    for (const edge of sortedFlowEdges) {
      const g = edge.guard;
      if (!g || g === 'always') {
        activeEdges.push(edge);
        return { ok: true, edges: activeEdges, ctx };
      }
      if (g && typeof g === 'object' && g.if) {
        try {
          if (g.if === true || evalIfGuard(g.if, ctx, pathOpts)) {
            activeEdges.push(edge);
            return { ok: true, edges: activeEdges, ctx };
          }
        } catch { /* guard error → skip */ }
      }
      if (g && typeof g === 'object' && g.ai) {
        const options = sortedFlowEdges.filter(e => e.to).map(e => ({ to: e.to, label: e.label }));
        const out = await hooks.aiDecideNext(spec, step, ctx, options, g.ai);
        if (!out.ok) {
          const fb = step.fallback?.to;
          if (fb) {
            log(`${step.id}: AI routing failed, using fallback`);
            activeEdges.push({ to: fb });
            return { ok: true, edges: activeEdges, ctx };
          }
          return { ok: false, error: out.error || 'ai_routing_failed', ctx, edges: [] };
        }
        if (out.argsPatch && out.next) {
          if (!ctx.__argsPatch) ctx.__argsPatch = {};
          ctx.__argsPatch[out.next] = deepMerge(ctx.__argsPatch[out.next] || {}, out.argsPatch);
        }
        const matchedEdge = sortedFlowEdges.find(e => e.to === out.next);
        activeEdges.push(matchedEdge || { to: out.next! });
        return { ok: true, edges: activeEdges, ctx };
      }
    }
  } else {
    // Standard: conditional first-match-wins; unconditional always fire.
    for (const edge of conditionalFlowEdges) {
      const g = edge.guard;
      if (g && typeof g === 'object' && g.if) {
        try {
          if (g.if === true || evalIfGuard(g.if, ctx, pathOpts)) {
            activeEdges.push(edge);
            break;
          }
        } catch { /* guard error → skip */ }
      }
    }
    for (const edge of unconditionalFlowEdges) {
      if (!activeEdges.some(e => e.to === edge.to)) {
        activeEdges.push(edge);
      }
    }
  }

  if (activeEdges.length === 0 && step.fallback?.to) {
    activeEdges.push({ to: step.fallback.to });
    return { ok: true, edges: activeEdges, ctx };
  }

  return { ok: true, edges: activeEdges, ctx };
}
