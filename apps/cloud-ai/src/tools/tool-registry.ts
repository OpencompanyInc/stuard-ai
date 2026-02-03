import { ToolAction } from '@mastra/core/tools';

export interface ToolMetadata {
  category: string;
  kind?: 'local' | 'cloud' | 'orchestration';
}

// Map tool ID -> Tool instance
export const TOOL_REGISTRY = new Map<string, ToolAction<any, any, any, any>>();
// Map tool ID -> Metadata
export const TOOL_METADATA = new Map<string, ToolMetadata>();
// Map category -> list of tool IDs
export const TOOL_CATEGORIES = new Map<string, string[]>();

export function registerTool(
  tool: any, 
  category: string = 'Other',
  kind?: 'local' | 'cloud' | 'orchestration'
) {
  try {
    const name = tool?.id || tool?.name;
    if (name && typeof tool?.execute === 'function') {
      TOOL_REGISTRY.set(name, tool);
      
      // Store metadata
      TOOL_METADATA.set(name, { category, kind });
      
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
