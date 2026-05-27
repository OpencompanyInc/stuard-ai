/**
 * @stuardai/workflow-core/runtime — shared workflow execution core.
 *
 * Consumed by the desktop Electron engine and the VM engine so both run the
 * same logic. Platform-specific concerns (tool transports, variable stores,
 * auth) are injected by each host, not implemented here.
 */
export * from './types';
