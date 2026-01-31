import { execTool, getToolKind } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep, LoopConfig } from './types';
import { interpolateForTool, deepMerge, evalIfGuard } from './utils';
import { aiDecideNext } from './ai';
import { execRunSequential, execRunParallel, execLoopExecutor } from './orchestration';
import { executeFromTrigger } from './function-call';

export async function executeStep(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext
): Promise<{ nextId?: string; nextIds?: string[]; loop?: LoopConfig; loopBreak?: boolean; ctx: any; ok: boolean; error?: string }> {
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
      // Pass flowId to custom_ui so stop button can work
      const toolArgs = toolName === 'custom_ui'
        ? { ...mergedArgs, flowId: spec.id }
        : mergedArgs;
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
      return { ok: true, ctx }; // No nextId = end of workflow
    }

    // Check for failure
    if (!result?.ok) {
      // custom_ui timeout/closed is not a failure for blocking UIs
      if (toolName === 'custom_ui' && (result?.action === 'timeout' || result?.action === 'closed')) {
        // Continue normally - but if there's no 'always' edge, may need to check guards
      } else {
        return { ok: false, error: String(result?.error || `${toolName}_failed`), ctx };
      }
    }

    // Decide next step
    return decideNext(spec, step, ctx, engineCtx);
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'step_failed'), ctx };
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
): Promise<{ nextId?: string; nextIds?: string[]; loop?: LoopConfig; loopBreak?: boolean; ctx: any; ok: boolean; error?: string }> {
  const rawEdges = Array.isArray(step.next) ? step.next : [];

  // Separate unconditional edges (always/no guard) from conditional ones
  const unconditionalEdges: Array<{ to: string }> = [];
  const conditionalEdges: Array<any> = [];

  for (const edge of rawEdges) {
    if (isCatchAllGuard(edge.guard)) {
      unconditionalEdges.push(edge);
    } else {
      conditionalEdges.push(edge);
    }
  }

  // If there are multiple unconditional edges, run them in parallel
  if (unconditionalEdges.length > 1) {
    const nextIds = unconditionalEdges.map(e => e.to).filter(Boolean);
    engineCtx.logFn(`[${step.id}] Parallel branches: ${nextIds.join(', ')}`);
    return { ok: true, nextIds, ctx };
  }

  // Sort edges: specific guards first, catch-all guards (true/always) last
  // This ensures conditional branches are evaluated before fallback edges
  const edges = [...rawEdges].sort((a, b) => {
    const aIsDefault = isCatchAllGuard(a.guard);
    const bIsDefault = isCatchAllGuard(b.guard);
    if (aIsDefault && !bIsDefault) return 1;  // a goes after b
    if (!aIsDefault && bIsDefault) return -1; // a goes before b
    return 0; // preserve relative order
  });

  for (const edge of edges) {
    const g = edge.guard;

    // No guard or 'always' → take this edge
    if (!g || g === 'always') {
      return { ok: true, nextId: edge.to, loop: edge.loop, loopBreak: edge.loopBreak, ctx };
    }

    // JSONLogic guard
    if (g && typeof g === 'object' && g.if) {
      try {
        // { if: true } is a catch-all, always matches
        if (g.if === true || evalIfGuard(g.if, ctx)) {
          return { ok: true, nextId: edge.to, loop: edge.loop, loopBreak: edge.loopBreak, ctx };
        }
      } catch { }
    }

    // AI routing guard (call cloud for decision)
    if (g && typeof g === 'object' && g.ai) {
      const options = edges.filter(e => e.to).map(e => ({ to: e.to, label: e.label }));
      const out = await aiDecideNext(spec, step, ctx, options, g.ai, engineCtx);

      if (!out.ok) {
        const fb = step.fallback?.to;
        if (fb) {
          engineCtx.logFn(`${step.id}: AI routing failed, using fallback`);
          return { ok: true, nextId: fb, ctx };
        }
        return { ok: false, error: out.error || 'ai_routing_failed', ctx };
      }

      if (out.argsPatch && out.next) {
        if (!ctx.__argsPatch) ctx.__argsPatch = {};
        ctx.__argsPatch[out.next] = deepMerge(ctx.__argsPatch[out.next] || {}, out.argsPatch);
      }

      // Find the matching edge to get its loop config
      const matchedEdge = edges.find(e => e.to === out.next);
      return { ok: true, nextId: out.next, loop: matchedEdge?.loop, loopBreak: matchedEdge?.loopBreak, ctx };
    }
  }

  // No edge matched
  if (step.fallback?.to) {
    return { ok: true, nextId: step.fallback.to, ctx };
  }

  return { ok: true, ctx }; // End of flow
}
