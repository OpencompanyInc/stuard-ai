/**
 * Execution Tools Resolver
 *
 * Breaks the circular dependency:
 *   stuard/tools → meta-tools → workflow-subagent → subagent-runtime → stuard/tools
 *
 * Instead of using `createRequire` + dynamic `require()` (which breaks when tsup
 * bundles into a single file), consumers import from this module and the actual
 * `getExecutionTools` function is registered at startup from server.ts.
 */

type GetExecutionToolsFn = (mcpTools?: Record<string, any>) => Record<string, any>;

let _getExecutionTools: GetExecutionToolsFn | undefined;

/**
 * Called once at startup (from server.ts) to wire the real implementation.
 */
export function registerExecutionTools(fn: GetExecutionToolsFn): void {
  _getExecutionTools = fn;
}

/**
 * Safe lazy accessor used by subagent-runtime and orchestrator-agent.
 * Throws if called before registration (should never happen in practice
 * because server.ts registers before accepting any connections).
 */
export function resolveExecutionTools(mcpTools: Record<string, any> = {}): Record<string, any> {
  if (!_getExecutionTools) {
    throw new Error(
      'Execution tools not registered. Ensure registerExecutionTools() is called at startup.',
    );
  }
  return _getExecutionTools(mcpTools);
}
