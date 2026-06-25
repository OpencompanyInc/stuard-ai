import { ToolAction } from '@mastra/core/tools';
import { withToolInputCoercion } from './zod-utils';

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
  Maps: 'cloud',
  Webhooks: 'cloud',
  Telnyx: 'cloud',
  WhatsApp: 'cloud',
  Integrations: 'cloud',
  Feedback: 'cloud',
  Memory: 'cloud',
  Projects: 'device',
  Knowledge: 'cloud',
  Productivity: 'cloud',
  Embeddings: 'cloud',
  AI: 'cloud',
  Agents: 'compute',

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
      const safeTool = withToolInputCoercion(tool);
      TOOL_REGISTRY.set(name, safeTool);

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

// ─── Discovery surfaces ──────────────────────────────────────────────────────
// A tool can be discovered in the main chat ('chat'), the workflow builder
// ('workflow'), or both (the default — most tools intersect). Only a few are
// surface-specific. search_tools (chat) and search_workflow_nodes (workflow)
// both run through isToolDiscoverableForSurface so the two catalogs don't
// cross-contaminate.
export type ToolSurface = 'chat' | 'workflow';

// Categories that only make sense INSIDE a workflow graph → hidden from main-chat
// tool search. Note: run_sequential/run_parallel are category 'Core' and stay
// shared (legit chat orchestration); the pure graph nodes (call_function,
// return_value, end, loop_executor) aren't in this registry at all, so they
// can't leak into chat search regardless.
const WORKFLOW_ONLY_CATEGORIES = new Set<string>(['Variables', 'Workspace', 'Workflow']);

// Tools that only work in a live chat turn → hidden from workflow node search.
// (chat_ui renders in the chat bubble; name_conversation renames the chat.)
const CHAT_ONLY_TOOLS = new Set<string>(['chat_ui', 'name_conversation']);

// Categories that are app/chat actions, not workflow building blocks → hidden
// from workflow node search. 'Feedback' (submit_feedback) files a bug/feature
// report from the live app — it makes no sense as an automation node.
const CHAT_ONLY_CATEGORIES = new Set<string>(['Feedback']);

// Internal / system-managed plumbing the agent must NEVER discover or call.
// These run the file index under the hood: roots are added + folders scanned
// automatically when the user pins project context (pin_file / add_project_context)
// or configures indexing in Settings; pending files are embedded by the
// background processor; *_update / *_mark_error are cloud-processing callbacks.
// Surfacing them as callable tools only invited the model to hand-crank the
// indexer and leaked "chunking / pending / embedding" internals into the trace.
// The user-facing SEARCH tools (file_search, semantic_file_search, …) stay
// discoverable — only the index-management/plumbing layer is hidden. The
// file-indexing service still calls these directly over the desktop bridge
// (execLocalTool), which does not go through this registry, so hiding them here
// has no effect on the automatic pipeline.
const INTERNAL_TOOLS = new Set<string>([
  'file_index_add_root',
  'file_index_remove_root',
  'file_index_list_roots',
  'file_index_scan',
  'file_index_get_pending',
  'file_index_stats',
  'file_index_update',
  'file_index_mark_error',
  'process_pending_file_index',
  'process_pending_file_index_batch',
  'sync_file_index_batch_jobs',
]);

/** Internal/system-managed tool the agent should never discover or execute directly. */
export function isInternalTool(name: string): boolean {
  return INTERNAL_TOOLS.has(name);
}

/** Whether a tool should surface in a given discovery surface's search results. */
export function isToolDiscoverableForSurface(name: string, surface: ToolSurface): boolean {
  // Internal plumbing is never agent-discoverable on any surface.
  if (INTERNAL_TOOLS.has(name)) return false;
  const category = TOOL_METADATA.get(name)?.category;
  if (surface === 'workflow') {
    // workflow surface: hide chat-only tools + chat-only (app-action) categories.
    if (CHAT_ONLY_TOOLS.has(name)) return false;
    return !(category && CHAT_ONLY_CATEGORIES.has(category));
  }
  // chat surface: chat-only tools belong here; workflow-only categories do not.
  if (CHAT_ONLY_TOOLS.has(name)) return true;
  return !(category && WORKFLOW_ONLY_CATEGORIES.has(category));
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
