import { execTool, getToolKind } from '../tool-router';
import { EngineContext, StuardSpec, StuardStep, StuardEdge, LoopConfig, StreamWireConfig } from './types';
import { pathResolveOptions } from './utils';
import { aiDecideNext } from './ai';
import { execRunSequential, execRunParallel, execLoopExecutor } from './orchestration';
import { executeFromTrigger } from './function-call';
import { executeStep as coreExecuteStep, type DecideNextResult } from '@stuardai/workflow-core/runtime';

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

// Desktop tool dispatch — owns orchestration (run_sequential/run_parallel/
// loop_executor), call_function (needs the current spec), custom_ui (sibling
// flowSteps injection), noop, and execTool routing. Injected into the shared
// executeStep skeleton; args are already interpolated by the skeleton.
async function desktopDispatchTool(
  spec: StuardSpec,
  step: StuardStep,
  mergedArgs: any,
  ctx: any,
  toolName: string,
  engineCtx: EngineContext,
): Promise<any> {
  // Diagnostic: log resolved data values for custom_ui to trace template resolution
  if (toolName === 'custom_ui' && mergedArgs?.data) {
    for (const [k, v] of Object.entries(mergedArgs.data)) {
      const vs = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v)?.slice(0, 80);
      engineCtx.logFn(`[${step.id}] interpolated data.${k} = ${vs}`);
    }
  }

  const kind = getToolKind(toolName);

  // Handle orchestration tools inline
  if (kind === 'orchestration') {
    if (toolName === 'run_sequential') return execRunSequential(spec, step, mergedArgs, ctx, engineCtx);
    if (toolName === 'run_parallel') return execRunParallel(spec.id, mergedArgs, ctx, engineCtx);
    if (toolName === 'loop_executor') return execLoopExecutor(spec.id, mergedArgs, ctx, engineCtx);
    return { ok: false, error: `unknown_orchestration_tool: ${toolName}` };
  }

  if (toolName === 'call_function') {
    // Handle call_function inline since it needs access to the current spec
    const triggerId = String(mergedArgs?.triggerId || '').trim();
    const inputs = mergedArgs?.inputs || {};
    if (!triggerId) return { ok: false, error: 'missing triggerId for call_function' };
    // Detect inputs with unresolved {{caller.X}} templates (→ empty strings) — happens
    // when call_function is reached via a regular wire instead of a callNode wire.
    const originalInputs = step.args?.inputs;
    const hasCallerTemplates = originalInputs && typeof originalInputs === 'object' &&
      Object.values(originalInputs).some((v: any) => typeof v === 'string' && v.includes('{{caller.'));
    const hasEmptyInputs = Object.keys(inputs).length > 0 &&
      Object.values(inputs).some((v: any) => v === '' || v === undefined || v === null);
    if (hasCallerTemplates && hasEmptyInputs) {
      engineCtx.logFn(`[${step.id}] ⚠️ call_function skipped — inputs have unresolved {{caller.X}} templates. ` +
        `This node should be connected via a callNode wire (callNode: true) from custom_ui, not a regular wire.`);
      return { ok: true, skipped: true, reason: 'unresolved_caller_templates' };
    }
    return executeFromTrigger(spec, triggerId, inputs, ctx, engineCtx);
  }

  if (toolName === 'noop' || !toolName) return { ok: true };

  // Route to unified tool executor. flowId lets tools track the owning workflow
  // (custom_ui stop button, capture_media/stream cleanup on stop).
  const toolArgs: any = { ...mergedArgs, flowId: spec.id, __workflowToolCall: true };
  // custom_ui: pass sibling steps so callNode can resolve nodes without disk I/O.
  if (toolName === 'custom_ui' && Array.isArray(spec.steps)) {
    toolArgs.__flowSteps = spec.steps.map(s => ({ id: s.id, label: s.label, tool: s.tool, args: s.args }));
    toolArgs.__stepId = step.id;
  }
  return execTool(toolName, toolArgs, engineCtx);
}

// Per-step executor — skeleton shared with the VM engine via
// @stuardai/workflow-core (interpolation, terminate/return handling, decideNext,
// legacy-field derivation). Desktop injects its tool dispatch, $vars resolver,
// and AI routing.
export async function executeStep(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext
): Promise<ExecuteStepResult> {
  return coreExecuteStep(spec, step, ctx, {
    logFn: engineCtx.logFn,
    pathOpts: pathResolveOptions,
    dispatchTool: (sp, st, args, c, toolName) => desktopDispatchTool(sp, st, args, c, toolName, engineCtx),
    aiDecideNext: (sp, st, c, options, aiCfg) => aiDecideNext(sp, st, c, options, aiCfg, engineCtx),
  });
}
