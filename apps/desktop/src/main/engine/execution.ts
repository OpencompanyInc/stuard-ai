import { execTool, getToolKind } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep, StuardEdge, LoopConfig, StreamWireConfig } from './types';
import { interpolateForTool, deepMerge, evalIfGuard } from './utils';
import { aiDecideNext } from './ai';
import { execRunSequential, execRunParallel, execLoopExecutor } from './orchestration';
import { executeFromTrigger } from './function-call';

/** Result type for decideNext - returns all active edges to take */
export interface DecideNextResult {
  edges: StuardEdge[];
  ctx: any;
  ok: boolean;
  error?: string;
};

/** Result type for executeStep - includes edges from decideNext */
export interface ExecuteStepResult {
  edges: StuardEdge[];
  ctx: any;
  ok: boolean;
  error?: string;
  // Legacy fields for backward compat (derived from edges)
  nextId?: string;
  nextIds?: string[];
  loop?: LoopConfig;
  loopBreak?: boolean;
  stream?: StreamWireConfig;
}

export async function executeStep(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext
): Promise<ExecuteStepResult> {
  try {
    // Merge any arg patches from AI routing
    const patchForThis = ctx?.__argsPatch?.[step.id];
    const toolName = step.tool || 'noop';
    const mergedArgs = interpolateForTool(deepMerge(step.args || {}, patchForThis || {}), ctx, toolName);
    const kind = getToolKind(toolName);

    let result: any;

    // Handle orchestration tools inline
    if (kind === 'orchestration') {
      if (toolName === 'run_sequential') {
        result = await execRunSequential(spec, step, mergedArgs, ctx, engineCtx);
      } else if (toolName === 'run_parallel') {
        result = await execRunParallel(mergedArgs, ctx, engineCtx);
      } else if (toolName === 'loop_executor') {
        result = await execLoopExecutor(mergedArgs, ctx, engineCtx);
      } else {
        result = { ok: false, error: `unknown_orchestration_tool: ${toolName}` };
      }
    } else if (toolName === 'call_function') {
      // Handle call_function inline since it needs access to the current spec
      const triggerId = String(mergedArgs?.triggerId || '').trim();
      const inputs = mergedArgs?.inputs || {};
      if (!triggerId) {
        result = { ok: false, error: 'missing triggerId for call_function' };
      } else {
        result = await executeFromTrigger(spec, triggerId, inputs, ctx, engineCtx);
      }
    } else if (toolName === 'noop' || !toolName) {
      result = { ok: true };
    } else {
      // Route to unified tool executor
      // Pass flowId so tools can track which workflow started them
      // (used by custom_ui for stop button, capture_media/streams for cleanup on stop)
      const toolArgs = { ...mergedArgs, flowId: spec.id };
      result = await execTool(toolName, toolArgs, engineCtx);
    }

    // Store result in context
    ctx[step.id] = result;

    // Capture structured return values
    if (toolName === 'return_value' || result?.action === 'return') {
      (ctx as any).__return = (result && typeof result === 'object' && 'value' in result) ? result.value : result;
    }

    // Track termination so the engine can stop all branches
    if (result?.terminated) {
      (ctx as any).__terminated = true;
    }

    // Handle 'end' tool - terminates the workflow
    if (toolName === 'end' || result?.terminated) {
      return { ok: true, ctx, edges: [] }; // No nextId = end of workflow
    }

    // Check for failure
    if (!result?.ok) {
      // custom_ui timeout/closed is not a failure for blocking UIs
      if (toolName === 'custom_ui' && (result?.action === 'timeout' || result?.action === 'closed')) {
        // Continue normally - but if there's no 'always' edge, may need to check guards
      } else {
        return { ok: false, error: String(result?.error || `${toolName}_failed`), ctx, edges: [] };
      }
    }

    // Decide next step
    const decideResult = await decideNext(spec, step, ctx, engineCtx);
    
    // Derive legacy fields from edges for backward compatibility
    const flowEdges = decideResult.edges.filter(e => !e.stream);
    const streamEdges = decideResult.edges.filter(e => e.stream);
    
    // Legacy: single nextId, nextIds, or loop/loopBreak from flow edges
    let nextId: string | undefined;
    let nextIds: string[] | undefined;
    let loop: LoopConfig | undefined;
    let loopBreak: boolean | undefined;
    let stream: StreamWireConfig | undefined;
    
    if (flowEdges.length === 1) {
      const edge = flowEdges[0];
      nextId = edge.to;
      loop = edge.loop;
      loopBreak = edge.loopBreak;
    } else if (flowEdges.length > 1) {
      // Check for loop edge precedence
      const loopEdge = flowEdges.find(e => e.loop?.type);
      if (loopEdge) {
        nextId = loopEdge.to;
        loop = loopEdge.loop;
      } else {
        nextIds = flowEdges.map(e => e.to);
      }
    }
    
    // Legacy: stream from first stream edge
    if (streamEdges.length > 0) {
      stream = streamEdges[0].stream;
      // If no flow edges, use stream edge as nextId for legacy compat
      if (!nextId && !nextIds) {
        nextId = streamEdges[0].to;
      }
    }
    
    return {
      ...decideResult,
      nextId,
      nextIds,
      loop,
      loopBreak,
      stream,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'step_failed'), ctx, edges: [] };
  }
}

function isCatchAllGuard(g: any): boolean {
  if (!g || g === 'always') return true;
  if (g && typeof g === 'object' && g.if === true) return true;
  return false;
}

async function decideNext(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext
): Promise<DecideNextResult> {
  const rawEdges: StuardEdge[] = Array.isArray(step.next) ? step.next : [];
  
  // Collect all active edges to return
  const activeEdges: StuardEdge[] = [];
  
  // Separate stream edges from flow edges — stream edges are ALWAYS active (parallel by nature)
  const streamEdges = rawEdges.filter(e => e.stream);
  const flowEdges = rawEdges.filter(e => !e.stream);
  
  // Always include all stream edges — they run in parallel with flow edges
  activeEdges.push(...streamEdges);
  if (streamEdges.length > 0) {
    engineCtx.logFn(`[${step.id}] ${streamEdges.length} stream edge(s) detected`);
  }

  // Separate unconditional flow edges from conditional ones
  const unconditionalFlowEdges: StuardEdge[] = [];
  const conditionalFlowEdges: StuardEdge[] = [];

  for (const edge of flowEdges) {
    if (isCatchAllGuard(edge.guard)) {
      unconditionalFlowEdges.push(edge);
    } else {
      conditionalFlowEdges.push(edge);
    }
  }

  // If there are multiple unconditional flow edges, check for loop/loopBreak relationships
  if (unconditionalFlowEdges.length > 1) {
    // Separate loop edges from loopBreak edges and regular edges
    const loopEdges = unconditionalFlowEdges.filter(e => e.loop && e.loop.type);
    const loopBreakEdges = unconditionalFlowEdges.filter(e => e.loopBreak);
    const regularEdges = unconditionalFlowEdges.filter(e => !e.loop?.type && !e.loopBreak);

    // If there's a loop edge, prioritize it - loopBreak edges execute after loop completes
    if (loopEdges.length > 0) {
      const loopEdge = loopEdges[0];
      engineCtx.logFn(`[${step.id}] Loop edge detected → ${loopEdge.to} (loopBreak edges will run after loop)`);
      activeEdges.push(loopEdge);
      return { ok: true, edges: activeEdges, ctx };
    }

    // If there are only regular edges (no loops), run them in parallel
    // But exclude loopBreak edges from parallel execution (they should only run after a loop)
    const parallelEdges = regularEdges.length > 0 ? regularEdges : unconditionalFlowEdges.filter(e => !e.loopBreak);
    if (parallelEdges.length > 1) {
      engineCtx.logFn(`[${step.id}] Parallel branches: ${parallelEdges.map(e => e.to).join(', ')}`);
      activeEdges.push(...parallelEdges);
      return { ok: true, edges: activeEdges, ctx };
    }

    // Single edge remaining
    if (parallelEdges.length === 1) {
      activeEdges.push(parallelEdges[0]);
      return { ok: true, edges: activeEdges, ctx };
    }
  }

  // Sort flow edges: specific guards first, catch-all guards (true/always) last
  // This ensures conditional branches are evaluated before fallback edges
  const sortedFlowEdges = [...flowEdges].sort((a, b) => {
    const aIsDefault = isCatchAllGuard(a.guard);
    const bIsDefault = isCatchAllGuard(b.guard);
    if (aIsDefault && !bIsDefault) return 1;  // a goes after b
    if (!aIsDefault && bIsDefault) return -1; // a goes before b
    return 0; // preserve relative order
  });

  for (const edge of sortedFlowEdges) {
    const g = edge.guard;

    // No guard or 'always' → take this edge
    if (!g || g === 'always') {
      activeEdges.push(edge);
      return { ok: true, edges: activeEdges, ctx };
    }

    // JSONLogic guard
    if (g && typeof g === 'object' && g.if) {
      try {
        // { if: true } is a catch-all, always matches
        if (g.if === true || evalIfGuard(g.if, ctx)) {
          activeEdges.push(edge);
          return { ok: true, edges: activeEdges, ctx };
        }
      } catch { }
    }

    // AI routing guard (call cloud for decision)
    if (g && typeof g === 'object' && g.ai) {
      const options = sortedFlowEdges.filter(e => e.to).map(e => ({ to: e.to, label: e.label }));
      const out = await aiDecideNext(spec, step, ctx, options, g.ai, engineCtx);

      if (!out.ok) {
        const fb = step.fallback?.to;
        if (fb) {
          engineCtx.logFn(`${step.id}: AI routing failed, using fallback`);
          activeEdges.push({ to: fb });
          return { ok: true, edges: activeEdges, ctx };
        }
        return { ok: false, error: out.error || 'ai_routing_failed', ctx, edges: [] };
      }

      if (out.argsPatch && out.next) {
        if (!ctx.__argsPatch) ctx.__argsPatch = {};
        ctx.__argsPatch[out.next] = deepMerge(ctx.__argsPatch[out.next] || {}, out.argsPatch);
      }

      // Find the matching edge to preserve its full config
      const matchedEdge = sortedFlowEdges.find(e => e.to === out.next);
      if (matchedEdge) {
        activeEdges.push(matchedEdge);
      } else {
        activeEdges.push({ to: out.next! });
      }
      return { ok: true, edges: activeEdges, ctx };
    }
  }

  // No flow edge matched — check fallback
  if (step.fallback?.to) {
    activeEdges.push({ to: step.fallback.to });
    return { ok: true, edges: activeEdges, ctx };
  }

  // Return whatever we have (may just be stream edges, or empty = end of flow)
  return { ok: true, edges: activeEdges, ctx };
}

