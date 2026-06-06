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
export function unwrapExecuteTool(tool: ToolCall): ToolCall {
  if (!tool || tool.tool !== 'execute_tool') return tool;

  const wrapperArgs = (tool.args || {}) as Record<string, any>;
  const realName =
    typeof wrapperArgs.tool_name === 'string' && wrapperArgs.tool_name.trim()
      ? wrapperArgs.tool_name.trim()
      : typeof wrapperArgs.tool === 'string' && wrapperArgs.tool.trim()
        ? wrapperArgs.tool.trim()
        : '';

  // Nothing to unwrap to yet (args still streaming) — keep the wrapper so the
  // step renders *something* rather than a blank label; it resolves on the next
  // tick once `tool_name` arrives.
  if (!realName || realName === 'execute_tool') return tool;

  const realArgs =
    wrapperArgs.args && typeof wrapperArgs.args === 'object' && !Array.isArray(wrapperArgs.args)
      ? (wrapperArgs.args as Record<string, any>)
      : {};

  // Peel the result envelope so previews/labels see the real tool's output.
  let result = tool.result;
  let error = tool.error;
  let status = tool.status;
  const env = tool.result as any;
  if (env && typeof env === 'object' && ('success' in env || 'result' in env || 'error' in env)) {
    if (env.success === false || (env.error && env.success !== true)) {
      error = typeof env.error === 'string' ? env.error : (error ?? JSON.stringify(env.error));
      result = undefined;
      if (status === 'completed') status = 'error';
    } else {
      result = 'result' in env ? env.result : env;
    }
  }

  return { ...tool, tool: realName, args: realArgs, result, error, status };
}
