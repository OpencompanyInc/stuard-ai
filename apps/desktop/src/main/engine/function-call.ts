/**
 * call_function execution (desktop adapter).
 *
 * The executor itself — start-step resolution, function-scoped context, parallel
 * fan-out, and waitForAll convergence — lives in @stuardai/workflow-core/runtime
 * so the desktop and VM engines run identical semantics. This file only injects
 * the desktop host hooks: its per-step executor and its BrowserWindow-broadcast
 * step events.
 */
import { EngineContext, StuardSpec } from './types';
import { executeStep } from './execution';
import { emitStepEvent } from './events';
import { executeFromTrigger as coreExecuteFromTrigger } from '@stuardai/workflow-core/runtime';

/**
 * Execute a workflow chain starting from a function trigger.
 * @param spec The current workflow spec
 * @param triggerId The trigger to execute
 * @param inputs Inputs passed to the function (available as ctx.args)
 * @param parentCtx Parent context (for variable inheritance)
 * @param engineCtx The engine context
 */
export async function executeFromTrigger(
  spec: StuardSpec,
  triggerId: string,
  inputs: Record<string, any>,
  parentCtx: any,
  engineCtx: EngineContext
): Promise<{ ok: boolean; result?: any; error?: string }> {
  return coreExecuteFromTrigger(spec, triggerId, inputs, parentCtx, {
    logFn: engineCtx.logFn,
    executeStep: (sp, st, c) => executeStep(sp, st, c, engineCtx),
    emitStep: (stepId, status, opts) => emitStepEvent(spec.id, stepId, status, opts),
  });
}
