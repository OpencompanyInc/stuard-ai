import { execTool, getToolKind } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep, StuardEdge, LoopConfig, StreamWireConfig } from './types';
import { interpolateForTool, deepMerge, pathResolveOptions } from './utils';
import { aiDecideNext } from './ai';
import { execRunSequential, execRunParallel, execLoopExecutor } from './orchestration';
import { executeFromTrigger } from './function-call';
import { decideNext as coreDecideNext, type DecideNextResult } from '@stuardai/workflow-core/runtime';

export type { DecideNextResult };

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

    // Diagnostic: log resolved data values for custom_ui to trace template resolution
    if (toolName === 'custom_ui' && mergedArgs?.data) {
      for (const [k, v] of Object.entries(mergedArgs.data)) {
        const vs = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v)?.slice(0, 80);
        engineCtx.logFn(`[${step.id}] interpolated data.${k} = ${vs}`);
      }
    }

    const kind = getToolKind(toolName);

    let result: any;

    // Handle orchestration tools inline
    if (kind === 'orchestration') {
      if (toolName === 'run_sequential') {
        result = await execRunSequential(spec, step, mergedArgs, ctx, engineCtx);
      } else if (toolName === 'run_parallel') {
        result = await execRunParallel(spec.id, mergedArgs, ctx, engineCtx);
      } else if (toolName === 'loop_executor') {
        result = await execLoopExecutor(spec.id, mergedArgs, ctx, engineCtx);
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
        // Detect if inputs have unresolved {{caller.X}} templates (resolved to empty strings).
        // This happens when call_function is reached via a regular wire instead of a callNode wire.
        // In that case, skip gracefully — the node is designed for on-demand callNode invocation.
        const originalInputs = step.args?.inputs;
        const hasCallerTemplates = originalInputs && typeof originalInputs === 'object' &&
          Object.values(originalInputs).some((v: any) => typeof v === 'string' && v.includes('{{caller.'));
        const hasEmptyInputs = Object.keys(inputs).length > 0 &&
          Object.values(inputs).some((v: any) => v === '' || v === undefined || v === null);

        if (hasCallerTemplates && hasEmptyInputs) {
          engineCtx.logFn(`[${step.id}] ⚠️ call_function skipped — inputs have unresolved {{caller.X}} templates. ` +
            `This node should be connected via a callNode wire (callNode: true) from custom_ui, not a regular wire.`);
          result = { ok: true, skipped: true, reason: 'unresolved_caller_templates' };
        } else {
          result = await executeFromTrigger(spec, triggerId, inputs, ctx, engineCtx);
        }
      }
    } else if (toolName === 'noop' || !toolName) {
      result = { ok: true };
    } else {
      // Route to unified tool executor
      // Pass flowId so tools can track which workflow started them
      // (used by custom_ui for stop button, capture_media/streams for cleanup on stop)
      const toolArgs = { ...mergedArgs, flowId: spec.id, __workflowToolCall: true };

      // For custom_ui nodes, also pass the sibling steps so callNode can resolve
      // nodes without hitting disk. This enables the node-routing architecture
      // where the UI dispatches to standalone tool nodes in the graph.
      if (toolName === 'custom_ui' && Array.isArray(spec.steps)) {
        toolArgs.__flowSteps = spec.steps.map(s => ({ id: s.id, label: s.label, tool: s.tool, args: s.args }));
        toolArgs.__stepId = step.id; // The engine step ID, for callNode wire animations
      }

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

    // Decide next step — shared edge-selection (single-sourced with the VM
    // engine). Desktop injects its store-backed $vars resolver + AI routing.
    const decideResult = await coreDecideNext(spec, step, ctx, {
      logFn: engineCtx.logFn,
      pathOpts: pathResolveOptions,
      aiDecideNext: (sp, st, c, options, aiCfg) => aiDecideNext(sp, st, c, options, aiCfg, engineCtx),
    });

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

// isCatchAllGuard + decideNext now live in @stuardai/workflow-core/runtime
// (imported as coreDecideNext) and are shared with the VM engine. Desktop
// injects its store-backed $vars resolver (pathResolveOptions) and AI routing
// (aiDecideNext) via hooks at the call site in executeStep above.

