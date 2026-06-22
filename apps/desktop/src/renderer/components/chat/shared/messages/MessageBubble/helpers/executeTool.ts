import type { ToolCall } from '../../../../../../hooks/useAgent';

/**
 * `execute_tool` is a meta-wrapper. The model calls it with
 * `{ tool_name, args }`, the backend runs the real tool, and it returns the
 * envelope `{ success, tool, result, error }`.
 *
 * For display we never want the generic "Execute Tool" wrapper to surface —
 * the real tool should drive the whole chain-of-thought step: its name (and so
 * its action label + grouping), its arguments, its result payload, and any
 * rich preview (image, diff, terminal, …). This collapses the wrapper into the
 * tool it actually ran.
 *
 * Non-wrapper calls — and wrapper calls whose `tool_name` hasn't streamed in
 * yet — pass straight through untouched.
 */
const WRAPPER_TOOL_NAMES = new Set(['execute_tool', 'vm_execute_tool', 'sis_execute_tool']);

export function unwrapExecuteTool(tool: ToolCall): ToolCall {
  if (!tool || !WRAPPER_TOOL_NAMES.has(tool.tool)) return tool;

  const wrapperArgs = (tool.args || {}) as Record<string, any>;
  const realName =
    typeof wrapperArgs.tool_name === 'string' && wrapperArgs.tool_name.trim()
      ? wrapperArgs.tool_name.trim()
      : typeof wrapperArgs.tool === 'string' && wrapperArgs.tool.trim()
        ? wrapperArgs.tool.trim()
        : typeof wrapperArgs.toolName === 'string' && wrapperArgs.toolName.trim()
          ? wrapperArgs.toolName.trim()
          : '';

  // Nothing to unwrap to yet (args still streaming) — keep the wrapper so the
  // step renders *something* rather than a blank label; it resolves on the next
  // tick once `tool_name` arrives.
  if (!realName || WRAPPER_TOOL_NAMES.has(realName)) return tool;

  const realArgs =
    wrapperArgs.args && typeof wrapperArgs.args === 'object' && !Array.isArray(wrapperArgs.args)
      ? (wrapperArgs.args as Record<string, any>)
      : {};

  // Peel the result envelope so previews/labels see the real tool's output.
  let result = tool.result;
  let error = tool.error;
  let status = tool.status;
  const env = tool.result as any;
  // execute_tool → { success, tool, result|error }; vm_execute_tool → { ok, tool, result|error }.
  if (env && typeof env === 'object' && ('success' in env || 'result' in env || ('ok' in env && 'tool' in env) || 'error' in env)) {
    const failed = env.success === false || env.ok === false || (env.error && env.success !== true && env.ok !== true);
    if (failed) {
      error = typeof env.error === 'string' ? env.error : (error ?? JSON.stringify(env.error));
      result = undefined;
      if (status === 'completed') status = 'error';
    } else if ('result' in env) {
      result = env.result;
    }
  }

  return { ...tool, tool: realName, args: realArgs, result, error, status };
}
