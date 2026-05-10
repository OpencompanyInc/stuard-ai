import { ToolAction } from '@mastra/core/tools';

export type ToolLocation = 'device' | 'compute' | 'cloud';

export interface ToolMetadata {
  category: string;
  kind?: 'local' | 'cloud' | 'orchestration';
  location: ToolLocation;
}

// Default location per category — used when no explicit location is passed
const CATEGORY_LOCATION: Record<string, ToolLocation> = {
  // Device — requires desktop hardware / display
  GUI: 'device',
  Media: 'device',
  MediaPipe: 'device',
  Ollama: 'device',
  Canvas: 'device',
  Streaming: 'device',
  Workspace: 'device',
  Desktop: 'device',

  // Cloud — API-based, runs on server
  Google: 'cloud',
  Outlook: 'cloud',
  GitHub: 'cloud',
  Discord: 'cloud',
  Reddit: 'cloud',
  X: 'cloud',
  YouTube: 'cloud',
  Marketplace: 'cloud',
  Search: 'cloud',
  Webhooks: 'cloud',
  Telnyx: 'cloud',
  WhatsApp: 'cloud',
  Integrations: 'cloud',
  Feedback: 'cloud',
  Memory: 'cloud',
  Spaces: 'cloud',
  Knowledge: 'cloud',
  Productivity: 'cloud',
  Embeddings: 'cloud',
  AI: 'cloud',

  // Compute — file ops, shell, scripts (can run on VM or desktop)
  FileSystem: 'compute',
  FileSearch: 'compute',
  System: 'compute',
  Database: 'compute',
  Variables: 'compute',
  Utils: 'compute',
  Math: 'compute',
  Core: 'compute',
  Workflow: 'compute',
  Other: 'compute',
};

// Map tool ID -> Tool instance
export const TOOL_REGISTRY = new Map<string, ToolAction<any, any, any, any>>();
// Map tool ID -> Metadata
export const TOOL_METADATA = new Map<string, ToolMetadata>();
// Map category -> list of tool IDs
export const TOOL_CATEGORIES = new Map<string, string[]>();

export function registerTool(
  tool: any,
  category: string = 'Other',
  kind?: 'local' | 'cloud' | 'orchestration',
  location?: ToolLocation
) {
  try {
    const name = tool?.id || tool?.name;
    if (name && typeof tool?.execute === 'function') {
      TOOL_REGISTRY.set(name, tool);

      // Derive location: explicit > category default > 'compute'
      const resolved = location || CATEGORY_LOCATION[category] || 'compute';
      TOOL_METADATA.set(name, { category, kind, location: resolved });

      if (!TOOL_CATEGORIES.has(category)) {
        TOOL_CATEGORIES.set(category, []);
      }
      const catList = TOOL_CATEGORIES.get(category);
      if (catList && !catList.includes(name)) {
        catList.push(name);
      }
    }
  } catch (e) {
    console.warn('Failed to register tool:', e);
  }
}

export function getToolRegistry() {
  return TOOL_REGISTRY;
}

export function getToolCategories() {
  return TOOL_CATEGORIES;
}

export function getTool(id: string) {
  return TOOL_REGISTRY.get(id);
}

export function getToolMetadata(id: string) {
  return TOOL_METADATA.get(id);
}

export function getAllTools() {
  return Array.from(TOOL_REGISTRY.values());
}

export function getToolLocation(id: string): ToolLocation {
  return TOOL_METADATA.get(id)?.location || 'compute';
}

export function getDefaultLocationForCategory(category: string): ToolLocation {
  return CATEGORY_LOCATION[category] || 'compute';
}

/**
 * Returns true if the tool must be routed through the user's desktop bridge.
 * - Device tools always need desktop
 * - Compute tools need desktop when there's no VM available
 */
export function requiresDesktopBridge(id: string, hasVm: boolean = false): boolean {
  const loc = getToolLocation(id);
  if (loc === 'device') return true;
  if (loc === 'compute' && !hasVm) return true;
  return false;
}
