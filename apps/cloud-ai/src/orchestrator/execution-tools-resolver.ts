/**
 * Execution Tools Resolver
 *
 * Breaks the circular dependency:
 *   stuard/tools → meta-tools → workflow-subagent → subagent-runtime → stuard/tools
 *
 * Instead of using a direct top-level import (which re-introduces the cycle),
 * consumers import from this module and the actual `getExecutionTools`
 * function is registered by the bootstrap helper during startup or first use.
 */

type GetExecutionToolsFn = (mcpTools?: Record<string, any>) => Record<string, any>;

let _getExecutionTools: GetExecutionToolsFn | undefined;

/**
 * Called by the bootstrap helper to wire the real implementation.
 */
export function registerExecutionTools(fn: GetExecutionToolsFn): void {
  _getExecutionTools = fn;
}

export function hasExecutionToolsRegistered(): boolean {
  return typeof _getExecutionTools === 'function';
}

/**
 * Safe lazy accessor used by subagent-runtime and orchestrator-agent.
 * Throws if called before registration.
 */
export function resolveExecutionTools(mcpTools: Record<string, any> = {}): Record<string, any> {
  if (!_getExecutionTools) {
    throw new Error(
      'Execution tools not registered. Ensure registerExecutionTools() is called at startup.',
    );
  }
  return _getExecutionTools(mcpTools);
}
