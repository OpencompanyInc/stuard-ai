/**
 * Runtime registry of deployed custom-integration tool names.
 *
 * The renderer fetches the user's deployed integrations from cloud-ai and
 * syncs the compiled tool names (`${slug}_${tool}`) here via the
 * `integrations:syncToolNames` IPC. execTool() consults this set to route those
 * tools to the cloud /v1/integrations/run endpoint (which resolves the stored,
 * encrypted credentials server-side) instead of the local Python agent.
 */

let customIntegrationToolNames = new Set<string>();

export function setCustomIntegrationToolNames(names: string[]): void {
  customIntegrationToolNames = new Set(
    (Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean),
  );
}

export function isCustomIntegrationTool(name: string): boolean {
  return customIntegrationToolNames.has(String(name || '').trim());
}

export function listCustomIntegrationToolNames(): string[] {
  return Array.from(customIntegrationToolNames);
}
