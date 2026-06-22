import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as deviceTools from './device-tools';
import * as googleTools from './google-tools';
import { web_search } from './perplexity-tools';
import { scrape_url } from './tavily-tools';
import { RESEARCH_MODE_TOOLS } from './research-mode';
import { maps_static_map, maps_distance_matrix, maps_search_places, maps_place_details } from './google-maps-tools';
import * as outlookTools from './outlook-tools';
import * as githubTools from './github-tools';
import * as notionTools from './notion-tools';
import * as discordTools from './discord-tools';
import * as redditTools from './reddit-tools';
import * as xTools from './x-tools';
import * as youtubeTools from './youtube-tools';
import * as marketplaceTools from './marketplace-tools';
import * as ttsTools from './tts-tools';
import * as feedbackTools from './feedback-tools';
import * as webhookTools from './webhook-tools';
import * as httpTools from './http-tools';
import * as telnyxTools from './telnyx-tools';
import * as whatsappTools from './whatsapp-tools';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../shared/integration-flags';
import * as metaSocialTools from './meta-social-tools';
import * as cloudStorageTools from './cloud-storage-tools';
import * as vmTools from './vm-tools';
import { waitTool } from './wait';
import { analyzeMediaTool } from './analyze-media';
import { aiInferenceTool } from './ai-inference';
import { generate_image } from './image-gen';
import { executeAgenticTask } from './agentic-task';
import { routeToWorkflowAgent } from './workflow-subagent';
import { runSequentialTool, runParallelTool } from './workflow-system';
import { searchWorkflowDocs } from '../agents/workflow-agent/docs';
import { resolveEmbedder, cosineSimilarity } from '../utils/embeddings';
import { embedMany } from 'ai';
import { getSupabaseService } from '../supabase';
import { registerTool, getToolRegistry, getToolCategories, getTool, getToolMetadata, getDefaultLocationForCategory, isToolDiscoverableForSurface, type ToolSurface } from './tool-registry';
import { execLocalTool, hasClientBridge, getBridgeSecrets } from './bridge';
import { zodToJsonSchema } from './zod-utils';
import { variablesTool, conversationKeyFromSecrets, resolveVarRefs, captureLargeOutputs } from './chat-variables';
import { deploy_integration, run_integration } from './integration-builder-tools';
// NOTE: modify_skill / save_skill are deliberately NOT imported here. skill-agent
// imports search_tools from this module, so importing its tools back would form a
// load-time cycle (TDZ on modifySkillTool during registerTool). The `skills`
// subagent gets them from the execution universe (agents/stuard/tools.ts) and
// calls them by name in its pack, so registry discovery isn't needed.

// ─── Deployed custom-integration tools (request-scoped) ────────────────────
// Compiled in prepare-chat-request.loadIntegrations() and stashed on the
// per-request secret bag. Surfaced via search_tools and run via execute_tool so
// they stay out of the lean orchestrator prompt.
interface CustomCatalogEntry { name: string; description: string; category: string; inputSchema?: any }
function getCustomCatalog(): CustomCatalogEntry[] {
    try {
        const c = (getBridgeSecrets() as any)?.__customCatalog;
        return Array.isArray(c) ? c : [];
    } catch { return []; }
}
function getCustomTools(): Record<string, any> {
    try {
        const t = (getBridgeSecrets() as any)?.__customTools;
        return t && typeof t === 'object' ? t : {};
    } catch { return {}; }
}

const MEMORY_AI_TOOL_IDS = new Set([
    'memory_retrieval',
    'group_management',
    'memory_summarization',
    'memory_classify_texts',
    'memory_auto_ingest',
    'memory_extract_texts',
    'search_past_conversations',
    'get_conversation_context',
    'get_memory_stats',
]);

const MEMORY_AI_ALLOWLIST = new Set(['search_past_conversations', 'get_conversation_context']);

var _initialized = false;

/** Initialize tool registry if not already done */
export function initToolRegistry(): void {
  if (_initialized) return;
  _initialized = true;
  // Tools are registered during module load via registerTool() calls below
}

const BINARY_PAYLOAD_KEYS = new Set([
    '_b64',
    'b64',
    'base64',
    'base64Data',
    'data',
    'imageB64',
    'audioData',
    'content',
]);

export function sanitizeToolResultForModel(value: any): any {
    if (typeof value === 'string') {
        if (value.length > 2000 && /^[A-Za-z0-9+/=_-]+$/.test(value.slice(0, 2000))) {
            return `[redacted base64 payload: ${value.length} chars]`;
        }
        if (value.startsWith('data:') && value.length > 2000) {
            return `[redacted data URL: ${value.length} chars]`;
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeToolResultForModel(item));
    }

    if (!value || typeof value !== 'object') return value;

    const sanitized: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) {
        if (BINARY_PAYLOAD_KEYS.has(key) && typeof child === 'string' && child.length > 2000) {
            sanitized[key] = `[redacted binary payload: ${child.length} chars]`;
            sanitized[`${key}Bytes`] = Math.ceil((child.length * 3) / 4);
            continue;
        }
        sanitized[key] = sanitizeToolResultForModel(child);
    }
    return sanitized;
}

export async function ensureToolEmbeddings() {
    const supabase = getSupabaseService();
    if (!supabase) return;

    // 1. Fetch existing tools
    const { data: existing, error } = await supabase.from('tool_embeddings').select('name, description');
    if (error) {
        // Table might not exist yet if migration didn't run, fail gracefully
        return;
    }
    const existingMap = new Map(existing.map((r: any) => [r.name, r.description]));

    const toUpdate: any[] = [];
    const nameToCat = new Map<string, string>();
    const categories = getToolCategories();
    for (const [cat, names] of categories.entries()) {
        for (const n of names) nameToCat.set(n, cat);
    }

    const registry = getToolRegistry();
    for (const [name, tool] of registry.entries()) {
        const description = tool.description || '';
        // Check if description changed or new tool
        if (!existingMap.has(name) || existingMap.get(name) !== description) {
            toUpdate.push({ name, description, category: nameToCat.get(name) || 'Other' });
        }
    }

    if (toUpdate.length === 0) return;

    // 2. Embed
    try {
        const { embedder } = await resolveEmbedder();
        const texts = toUpdate.map(t => `${t.name}: ${t.description}`);
        const { embeddings } = await embedMany({ model: embedder as any, values: texts });

        const rows = toUpdate.map((t, i) => ({
            name: t.name,
            description: t.description,
            category: t.category,
            embedding: embeddings[i],
            updated_at: new Date().toISOString()
        }));

        const { error: upsertError } = await supabase.from('tool_embeddings').upsert(rows, { onConflict: 'name' });
        if (upsertError) console.warn('Failed to upsert tool embeddings', upsertError);
    } catch (e) {
        console.warn('Embedding generation failed during sync', e);
    }
}

// Register all tools
registerTool(waitTool, 'Core');
registerTool(runSequentialTool, 'Core');
registerTool(runParallelTool, 'Core');
registerTool(executeAgenticTask, 'Core');
registerTool(routeToWorkflowAgent, 'Core', 'orchestration');
registerTool(searchWorkflowDocs, 'Workflow');

// Virtual tools for workflow authoring (not executable directly by agent, but valid in workflows)
const customUiTool = createTool({
    id: 'custom_ui',
    description: `Display a custom overlay UI window using React components (offline, no CDN).

COMPONENT FIELD:
  Define a function App() using JSX syntax. JSX is auto-transformed to React.createElement at runtime via Sucrase.

  - Standard React JSX: <div className="p-4">{expr}</div>
  - onClick={handler}, onChange={e => ...}
  - className="tailwind-classes" (full Tailwind CSS bundled offline)
  - Hooks: useState, useEffect, useRef, useMemo, useCallback
  - useVar(name, default) — bridges React state to workflow variables. Auto-seeds from data args.
  - stuard.submit(data) — submit data and close (resolves blocking)
  - stuard.close() — close window
  - stuard.callNode(nodeId, data) — call a SIBLING NODE by ID or label (preferred; visible canvas animation)
  - stuard.callTool(name, args) — legacy escape hatch; calls a workflow tool invisibly with no canvas animation

NODE-ROUTING ARCHITECTURE (callNode):
  Instead of encoding logic inside custom_ui callTool() blocks, create STANDALONE
  tool nodes in the workflow and dispatch to them from the UI via stuard.callNode().

  HOW IT WORKS:
  1. Create standalone tool nodes with {{caller.X}} templates in their args:
       { id: "read_node", tool: "read_file", label: "Read File", args: { path: "{{caller.filePath}}" } }
  2. Connect the custom_ui to each node with callNode wires:
       { from: "my_ui", to: "read_node", callNode: true }
     callNode wires render as DASHED TEAL lines with a plug icon.
     They are NOT auto-traversed by the engine — they execute ON-DEMAND only.
  3. In the component, call nodes by ID or LABEL:
       const result = await stuard.callNode('read_node', { filePath: '/path/to/file' });
       // OR by label (case-insensitive, whitespace/underscore/hyphen agnostic):
       const result = await stuard.callNode('Read File', { filePath: '/path/to/file' });
       // {{caller.filePath}} in the node args gets replaced with '/path/to/file'

  The called node LIGHTS UP in the workflow canvas with animated particles on the teal wire.

  NODE MATCHING (callNode resolves targets in this order):
    1. Exact step ID match (e.g. "step_abc123")
    2. Exact label match, case-insensitive (e.g. "Read File" == "read file")
    3. Normalized label match ("read_file" matches "Read File", "read-file", "Read_File")

  callNode vs callTool:
    • callTool(name, args) — runs a tool INVISIBLY, no visual feedback in the canvas
    • callNode(nodeId, data) — routes to a named SIBLING NODE in the same workflow.
      Shows running → completed animation on the teal wire. Uses {{caller.X}} templates.
      Use this for generated custom_ui worker actions.

  WIRE DEFINITION:
    { "from": "ui_node_id", "to": "target_node_id", "callNode": true }
    Always include callNode: true — without it the engine auto-traverses the wire.

FILE/FOLDER PICKER (native OS dialogs, no tkinter needed):
  stuard.pickFile({ title, filters, multiple }) → { canceled, filePaths }
  stuard.pickFolder({ title, multiple }) → { canceled, filePaths }
  stuard.pickSavePath({ title, defaultPath, filters }) → { canceled, filePath }

  Example — folder picker:
    const result = await stuard.pickFolder({ title: 'Select Project' });
    if (!result.canceled) setWorkspace(result.filePaths[0]);

  Example — file picker with filters:
    const result = await stuard.pickFile({
      title: 'Select Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'gif'] }],
      multiple: false
    });

FILE I/O (read/write from component, no tool node needed):
  const text = await stuard.readFile('/path/to/file.txt');
  await stuard.writeFile('/path/to/output.txt', content);

CLIPBOARD:
  await stuard.copyToClipboard('text');
  const text = await stuard.readClipboard();

NOTIFICATIONS:
  stuard.notify('Title', 'Body text');

CRITICAL RULES:
  1. EVERY button MUST have onClick. Use onClick={() => stuard.submit(data)} for submit/done/action buttons.
     A button without onClick does NOTHING and blocks the workflow forever.
  2. useVar auto-seeds from data: if data has {"name": "{{step1.json.name}}"}, useVar('name', '') returns it.
  3. Use JSX style objects: style={{color: 'red'}} NOT style="color: red".
  4. Use standard Tailwind classes (bg-slate-950), not arbitrary values (bg-[#050510]).

MULTI-PAGE:
  Use useState for page navigation inside the component:
  const [page, setPage] = useState('home');
  if (page === 'settings') return (<div>...</div>);
  return (<div>...<button onClick={() => setPage('settings')}>Settings</button></div>);

IMPORTANT: The component field is raw JavaScript/JSX, NOT a JSON string.
  Write it with real newlines and unescaped quotes.
  Do NOT double-escape: use actual newlines, not literal \\n.`,
    inputSchema: z.object({
        id: z.string().optional().describe('Window ID. Same ID reuses existing window.'),
        title: z.string().optional().describe('Window title'),
        component: z.string().describe('React function component using JSX. Must define function App(). All React hooks available plus useVar(name, default). Use useState for multi-page navigation.'),
        css: z.string().optional().describe('Additional CSS styles'),
        data: z.record(z.string(), z.any()).optional().describe('Initial data accessible as initialData/formData'),
        blocking: z.boolean().optional().describe('If true (default), workflow waits for user action'),
        keepOpen: z.boolean().optional(),
        timeoutMs: z.number().optional().describe('Timeout in ms. 0 = no timeout (default)'),
        window: z.object({
            width: z.number().optional().describe('Window width in px (default 400)'),
            height: z.number().optional().describe('Window height in px (default 300)'),
            position: z.union([
                z.enum(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']),
                z.object({ x: z.number(), y: z.number() })
            ]).optional().describe('Window position (default center). Explicit x/y uses the same screen origin and scaling as mouse tools.'),
            alwaysOnTop: z.boolean().optional().describe('Keep above other windows (default true)'),
            frameless: z.boolean().optional().describe('Hide window frame/titlebar (default false)'),
            resizable: z.boolean().optional(),
            transparent: z.boolean().optional(),
            backgroundType: z.enum(['color', 'gradient', 'image', 'translucent', 'transparent']).optional().describe('Background style. translucent = semi-transparent with blur, transparent = fully transparent'),
            borderRadius: z.number().optional().describe('Corner radius in px'),
            backgroundColor: z.string().optional().describe('Background color hex (default #1a1a2e)'),
            translucent: z.object({
                color: z.string().optional().describe('Base tint color hex (default #1a1a2e)'),
                opacity: z.number().optional().describe('0-1 opacity (default 0.7). 0=invisible, 1=solid'),
                blur: z.number().optional().describe('Backdrop blur in px (default 12). Frosted glass effect'),
            }).optional().describe('Translucent window config. Requires backgroundType="translucent" and frameless=true'),
            invisible: z.boolean().optional().describe('Hide this window from screenshots and screen recordings (content protection)'),
        }).optional().describe('Window appearance configuration'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – custom_ui requires the Stuard desktop app.');
        return await execLocalTool('custom_ui', args);
    }
});

const updateCustomUiTool = createTool({
    id: 'update_custom_ui',
    description: 'Update an existing custom UI window with new data or component.',
    inputSchema: z.object({
        id: z.string().describe('The ID of the custom_ui window to update'),
        data: z.record(z.string(), z.any()).optional().describe('Data to merge into formData/initialData'),
        component: z.string().optional().describe('New React JSX component to replace current view'),
        css: z.string().optional().describe('New CSS to append'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – update_custom_ui requires the Stuard desktop app.');
        return await execLocalTool('update_custom_ui', args);
    }
});

// ── Custom UI installable packages (local npm libraries for custom_ui) ──
// install-once package sets bundled offline by the desktop. Authoring tools the
// agent emits before/alongside custom_ui; they execute on the desktop bridge.
const uiPackagesInstallTool = createTool({
    id: 'ui_packages_install',
    description: `Install a local npm package set for custom_ui (install-once, reuse by name).
Bundled offline by the desktop and cached. React, ReactDOM and Framer Motion are
already runtime globals — never install those.

Curated packages bundle with no npm needed: lucide-react, recharts, clsx,
tailwind-merge, class-variance-authority, three. Any other package requires
allowNpm: true (npm must be available on the machine).

After installing, reference the set from a custom_ui call with { uiPackageSet: "<set>" }
and import packages normally in the component (import { X } from 'pkg').

Tip: for one custom_ui you can skip this and pass uiPackages: ["recharts"] inline
on the custom_ui call (curated packages only).`,
    inputSchema: z.object({
        set: z.string().describe('Package set name (referenced later via custom_ui uiPackageSet). e.g. "charts".'),
        packages: z.array(z.string()).describe('npm package names, e.g. ["recharts", "lucide-react"].'),
        mode: z.enum(['add', 'set']).optional().describe('"add" (default) merges with the existing set; "set" replaces it.'),
        allowNpm: z.boolean().optional().describe('Allow npm install for non-curated packages (requires npm on the machine). Default false.'),
        force: z.boolean().optional().describe('Force a rebuild even if the resolved set is unchanged.'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – ui_packages_install requires the Stuard desktop app.');
        return await execLocalTool('ui_packages_install', args);
    }
});

const uiPackagesStatusTool = createTool({
    id: 'ui_packages_status',
    description: 'Inspect a custom_ui package set: installed modules, bundle sizes, and any packages that failed to resolve.',
    inputSchema: z.object({
        set: z.string().describe('Package set name to inspect.'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – ui_packages_status requires the Stuard desktop app.');
        return await execLocalTool('ui_packages_status', args);
    }
});

const uiPackagesListTool = createTool({
    id: 'ui_packages_list',
    description: 'List all installed custom_ui package sets plus the curated catalog (packages that bundle offline with no npm).',
    inputSchema: z.object({}),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – ui_packages_list requires the Stuard desktop app.');
        return await execLocalTool('ui_packages_list', args);
    }
});

const uiPackagesRemoveTool = createTool({
    id: 'ui_packages_remove',
    description: 'Delete a custom_ui package set and its cached bundle.',
    inputSchema: z.object({
        set: z.string().describe('Package set name to delete.'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – ui_packages_remove requires the Stuard desktop app.');
        return await execLocalTool('ui_packages_remove', args);
    }
});

const notifyTool = createTool({
    id: 'notify',
    description: 'Show a local desktop notification',
    inputSchema: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        severity: z.enum(['info', 'warning', 'error']).optional(),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – notify requires the Stuard desktop app.');
        return await execLocalTool('notify', args);
    }
});

const logTool = createTool({
    id: 'log',
    description: 'Log a message to the workflow console/history',
    inputSchema: z.object({
        message: z.string(),
        level: z.enum(['info', 'warn', 'error']).optional(),
        data: z.any().optional(),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – log requires the Stuard desktop app.');
        return await execLocalTool('log', args);
    }
});

export const chatUiTool = createTool({
    id: 'chat_ui',
    description: `Render a custom interactive React component inline in the chat bubble (custom_ui opens a separate window instead).

COMPONENT: define a function App() in JSX (auto-transformed at render).
  - Standard React + hooks (useState, useEffect, useRef, useMemo, useCallback).
  - Tailwind utilities for layout/spacing/typography (flex, grid, gap-*, p-*, text-sm/lg/xl, font-*, rounded-*, etc.).
  - stuard.submit(data) submits back to the agent (resolves a blocking UI); stuard.close() dismisses; stuard.openExternal(url) opens an http(s) URL in the user's browser for pages that can't safely run inside chat_ui.

THEME — DO NOT HARDCODE COLORS. The app theme can be light, dark, OR custom and switches freely, so literal color utilities (bg-white, text-black, bg-slate-900, bg-gray-100) and dark: variants break. Style everything with these live theme tokens:
    Backgrounds: bg-theme-bg  bg-theme-card  bg-theme-input  bg-theme-hover  bg-theme-active  bg-theme-muted  bg-theme-primary
    Text:        text-theme-fg  text-theme-muted  text-theme-primary  text-theme-primary-fg
    Borders:     border-theme  border-theme-primary  (with Tailwind's \`border\`)
    Radius:      rounded-theme-card  rounded-theme-button
    Hover:       hover:bg-theme-hover  hover:bg-theme-active  hover:border-theme  hover:text-theme-fg
    Prebuilt:    theme-card (padded surface w/ border+radius)  theme-btn-primary  theme-btn-secondary  divide-theme
  Inputs/textareas/selects auto-style to the theme — leave them unstyled unless you need layout (w-full, etc.).
  For anything else, read the CSS vars directly via style: --chat-ui-background/-foreground/-card/-card-foreground/-primary/-primary-foreground/-muted/-muted-foreground/-border/-input/-hover/-active
    e.g. style={{ background: 'color-mix(in srgb, var(--chat-ui-primary) 12%, transparent)' }}  // subtle primary tint
  Semantic accents (danger/success/warning): mid-tone text that reads on any bg — text-red-500, text-amber-500, text-emerald-500. For a fill use the color-mix trick; never solid light fills like bg-red-100.
  Also global: designScheme.mode ('dark'|'light'), designScheme.colors { background, foreground, card, cardForeground, primary, primaryForeground, muted, mutedForeground, border, input, hover, active }, designScheme.radius { card, button }.

BLOCKING: blocking:true pauses the agent until the user submits/closes (forms, confirmations, selections); blocking:false renders display-only and the agent continues (dashboards, status, rich content).

RULES:
  1. EVERY action button MUST have onClick (submit: onClick={() => stuard.submit(data)}).
  2. initialData is available globally, seeded from the data arg.
  3. Use JSX style objects: style={{ color: 'var(--chat-ui-primary)' }} NOT style="color: red".
  4. Renders in a sandboxed iframe — no parent window or Node.js APIs.
  5. Display-only iframe embeds (maps, videos) are fine but stay isolated.
  6. Don't embed full third-party apps needing login/cookies/localStorage — show a button that calls stuard.openExternal(url).

EXAMPLE (blocking form):
  function App() {
    const [name, setName] = useState(initialData.name || '');
    return (
      <div className="theme-card p-4 space-y-3">
        <h2 className="text-lg font-semibold text-theme-fg">What's your name?</h2>
        <input className="w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Enter name" />
        <button className="theme-btn-primary" onClick={() => stuard.submit({ name })}>Submit</button>
      </div>
    );
  }`,
    inputSchema: z.object({
        component: z.string().describe('React function component using JSX. Must define function App().'),
        blocking: z.boolean().optional().default(false).describe('If true, agent waits for user interaction before continuing.'),
        data: z.record(z.string(), z.any()).optional().describe('Initial data accessible as initialData in the component.'),
        css: z.string().optional().describe('Additional CSS styles injected into the iframe.'),
        height: z.number().optional().describe('Initial height in px (default auto-sizes to content, max 500).'),
        title: z.string().optional().describe('Optional title bar shown above the component.'),
    }),
    execute: async (args) => {
        if (!hasClientBridge()) throw new Error('No desktop bridge available – chat_ui requires the Stuard desktop app.');
        const timeout = args.blocking ? 600000 : 30000;
        return await execLocalTool('chat_ui', args, undefined, timeout);
    }
});

registerTool(customUiTool, 'GUI');
registerTool(updateCustomUiTool, 'GUI');
registerTool(uiPackagesInstallTool, 'GUI');
registerTool(uiPackagesStatusTool, 'GUI');
registerTool(uiPackagesListTool, 'GUI');
registerTool(uiPackagesRemoveTool, 'GUI');
registerTool(chatUiTool, 'GUI');
registerTool(notifyTool, 'System');
registerTool(logTool, 'Core');
// Chat variables — store-by-reference for large payloads. Registered under
// 'Core' (NOT the workflow-only 'Variables' category) so it's discoverable on
// the chat surface and resolvable via execute_tool.
registerTool(variablesTool, 'Core');
// Integration Builder — author/deploy/use custom HTTP integrations.
registerTool(deploy_integration, 'Integrations');
registerTool(run_integration, 'Integrations');

// Device Tools
Object.values(deviceTools).forEach(t => {
    const name = (t as any)?.id || (t as any)?.name;
    if (!name) return;

    if (MEMORY_AI_TOOL_IDS.has(name) && !MEMORY_AI_ALLOWLIST.has(name)) {
        return;
    }

    if (['list_directory', 'read_file', 'write_file', 'create_directory', 'open_file', 'move_file', 'copy_file', 'delete_file', 'folder_permission_add', 'folder_permission_remove', 'folder_permission_list', 'folder_permission_set_enabled', 'folder_permission_check'].includes(name)) {
        registerTool(t, 'FileSystem');
    } else if (['file_index_add_root', 'file_index_remove_root', 'file_index_list_roots', 'file_index_scan', 'file_index_get_pending', 'file_index_stats', 'file_index_update', 'file_search', 'file_search_by_filename', 'file_search_by_kind', 'file_search_recent', 'file_search_details', 'file_search_similar', 'process_pending_file_index', 'process_pending_file_index_batch', 'sync_file_index_batch_jobs', 'semantic_file_search'].includes(name)) {
        registerTool(t, 'FileSearch');
    } else if (['run_command', 'run_system_command', 'list_terminals', 'read_terminal', 'launch_application_or_uri', 'list_open_windows', 'bring_window_to_foreground', 'get_window_info', 'smart_bring_window_to_foreground', 'set_window_bounds', 'python_status', 'python_setup', 'python_list_packages', 'python_install', 'run_python_script', 'run_node_script'].includes(name)) {
        registerTool(t, 'System');
    } else if (['describe_desktop_control_capabilities', 'get_desktop_wallpaper', 'set_desktop_wallpaper', 'get_system_volume', 'set_system_volume', 'list_bluetooth_devices', 'connect_bluetooth_device', 'disconnect_bluetooth_device', 'get_display_brightness', 'set_display_brightness', 'get_power_status'].includes(name)) {
        registerTool(t, 'Desktop');
    } else if (['get_datetime', 'math_eval', 'generate_uuid', 'random_number', 'random_choice', 'get_env_var', 'get_system_info', 'hash_string', 'base64_encode', 'base64_decode', 'json_parse', 'json_stringify', 'sleep', 'regex_match', 'regex_replace'].includes(name)) {
        registerTool(t, 'Utils');
    } else if (['computer_use', 'computer_use_agent', 'click_at_coordinates', 'double_click_at_coordinates', 'type_text', 'send_hotkey', 'scroll', 'drag_and_drop', 'take_screenshot', 'capture_screen_to_file', 'find_and_click_text', 'get_screen_text', 'read_image_optimized', 'find_text_on_screen', 'move_cursor', 'get_mouse_position'].includes(name)) {
        registerTool(t, 'GUI');
    } else if (['capture_media', 'stop_capture', 'list_active_captures', 'describe_media_capture_capabilities', 'stream_speech', 'stop_stream_speech'].includes(name)) {
        registerTool(t, 'Media');
    } else if (['ffmpeg_status', 'ffmpeg_setup', 'ffmpeg_run', 'ffmpeg_convert_media', 'ffmpeg_extract_audio', 'ffmpeg_trim_media', 'ffmpeg_probe_media', 'ffmpeg_extract_frames'].includes(name)) {
        registerTool(t, 'Media');
    } else if (['data_analysis_status', 'data_analysis_setup', 'data_analysis_uninstall', 'data_load', 'describe_data', 'correlate_data', 'plot_line', 'plot_bar', 'plot_scatter', 'plot_hist', 'plot_pie', 'plot_heatmap', 'plot_box', 'run_data_python'].includes(name)) {
        registerTool(t, 'DataAnalysis');
    } else if (['mediapipe_status', 'mediapipe_setup', 'mediapipe_pose', 'mediapipe_hands', 'mediapipe_face_detection', 'mediapipe_face_mesh', 'mediapipe_segmentation', 'mediapipe_holistic', 'mediapipe_process_video'].includes(name)) {
        registerTool(t, 'MediaPipe');
    } else if (['stream_create', 'stream_close', 'stream_list', 'stream_get_status'].includes(name)) {
        registerTool(t, 'Streaming');
    } else if (name.startsWith('_stream_') || name.startsWith('stream_')) {
        // Internal stream tools (prefixed with _) and deprecated stream_from_* — skip registration
    } else if (['agent_node', 'agent_decision', 'agent_extract'].includes(name)) {
        registerTool(t, 'AI');
    } else if (['agent_list', 'agent_get_status', 'agent_create', 'agent_deploy', 'agent_pause', 'agent_delete', 'ask_agent', 'agent_ask'].includes(name)) {
        registerTool(t, 'Agents');
    } else if (['bot_list', 'bot_get_status', 'bot_create', 'bot_deploy', 'bot_pause', 'bot_delete', 'ask_bot', 'bot_ask'].includes(name)) {
        registerTool(t, 'Agents');
    } else if (['search_local_workflows', 'list_local_stuards', 'show_json_workflow_code', 'import_workflow', 'run_automation', 'stop_automation', 'create_workflow', 'workflow_modify', 'retrieve_tool_format', 'run_workflow', 'execute_workflow', 'invoke_workflow'].includes(name)) {
        registerTool(t, 'Workflow');
    } else if (['search_past_conversations', 'get_conversation_context'].includes(name)) {
        registerTool(t, 'Memory');
    } else if (['list_projects', 'create_project', 'update_project', 'delete_project', 'enter_project_mode', 'exit_project_mode', 'journal_add', 'memory_add', 'project_search', 'add_project_context', 'pin_file', 'unpin_file'].includes(name)) {
        registerTool(t, 'Projects');
    } else if (['knowledge_add_instruction', 'knowledge_remember_about_user', 'knowledge_update_profile', 'knowledge_add_project_fact', 'knowledge_stats'].includes(name)) {
        registerTool(t, 'Knowledge');
    } else if (['calendar_crud', 'task_crud', 'task_reminders', 'planner_list_items'].includes(name)) {
        registerTool(t, 'Productivity');
    } else if (['canvas_list', 'canvas_read', 'canvas_write', 'canvas_create', 'canvas_delete'].includes(name)) {
        registerTool(t, 'Canvas');
    } else if (['workspace_read_file', 'workspace_write_file', 'workspace_delete_file', 'workspace_list_files', 'workspace_create_folder', 'workspace_get_info'].includes(name)) {
        registerTool(t, 'Workspace');
    } else if (['set_variable', 'get_variable', 'toggle_variable', 'increment_variable', 'append_to_list', 'list_variables', 'delete_variable'].includes(name)) {
        registerTool(t, 'Variables');
    } else if (['db_query', 'db_store', 'db_retrieve', 'db_search', 'db_delete', 'db_list_tables'].includes(name)) {
        registerTool(t, 'Database');
    } else if (['embed_text', 'vector_similarity', 'embed_and_store'].includes(name)) {
        registerTool(t, 'Embeddings');
    } else if (['name_conversation'].includes(name)) {
        registerTool(t, 'Core');
    } else if (name.startsWith('math_')) {
        registerTool(t, 'Math');
    } else {
        registerTool(t, 'Other');
    }
});

// Integration Tools
registerTool(analyzeMediaTool, 'AI');
registerTool(aiInferenceTool, 'AI');
registerTool(generate_image, 'AI');
registerTool(web_search, 'Search');
registerTool(scrape_url, 'Search');

// Research Mode (deep research with source registry + distilled notes)
Object.values(RESEARCH_MODE_TOOLS).forEach(t => registerTool(t, 'Research'));

// Google Maps Platform
registerTool(maps_static_map, 'Maps');
registerTool(maps_distance_matrix, 'Maps');
registerTool(maps_search_places, 'Maps');
registerTool(maps_place_details, 'Maps');

Object.values(googleTools).forEach(t => registerTool(t, 'Google'));
// Backward compatibility alias
if (googleTools.gmail_send_message) {
    registerTool(googleTools.gmail_send_message, 'Google');
    // Also alias in registry if needed, but registry uses ID.
    // Ideally we duplicate the tool with a new ID if we want an alias.
    // For now, let's just register it as is, assuming it has an ID.
    // Actually, createTool doesn't support changing ID easily without recreating.
    // We can manually add to map.
    const t = googleTools.gmail_send_message;
    if (t) getToolRegistry().set('gmail_send', t);
}

if (OUTLOOK_INTEGRATION_ENABLED) {
Object.values(outlookTools).forEach(t => registerTool(t, 'Outlook'));
// Backward compatibility alias
if (outlookTools.outlook_send_mail) {
    const t = outlookTools.outlook_send_mail;
    if (t) getToolRegistry().set('outlook_send', t);
}
}

Object.values(githubTools).forEach(t => registerTool(t, 'GitHub'));
Object.values(notionTools).forEach(t => registerTool(t, 'Notion'));
if (DISCORD_INTEGRATION_ENABLED) {
Object.values(discordTools).forEach(t => registerTool(t, 'Discord'));
}
if (REDDIT_INTEGRATION_ENABLED) {
Object.values(redditTools).forEach(t => registerTool(t, 'Reddit'));
}
Object.values(xTools).forEach(t => registerTool(t, 'X'));
Object.values(youtubeTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'YouTube');
});
Object.values(marketplaceTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Marketplace');
});
Object.values(ttsTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Media');
});
Object.values(feedbackTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Feedback');
});
Object.values(webhookTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Webhooks');
});
Object.values(httpTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Integrations');
});
Object.values(telnyxTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'Telnyx');
});
if (WHATSAPP_INTEGRATION_ENABLED) {
Object.values(whatsappTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'WhatsApp');
});
}
if (META_INTEGRATION_ENABLED) {
Object.values(metaSocialTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'MetaSocial');
});
}
Object.values(cloudStorageTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'CloudStorage');
});
Object.values(vmTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'VM');
});

// 2. Meta Tools

const SEARCH_TOOL_RESULT_LIMIT = 8;
// Workflow node discovery returns compact schemas per candidate, so each result is
// far heavier than a chat tool-search row and lands in the agent's resent history.
// Keep this tight (4) — enough to choose from without bloating every later turn.
const SEARCH_WORKFLOW_NODES_RESULT_LIMIT = 4;
const SEARCH_TOOL_DESCRIPTION_LIMIT = 240;

function compactToolSearchEntry(entry: {
    name?: unknown;
    description?: unknown;
    category?: unknown;
}) {
    return {
        name: String(entry.name ?? ''),
        description: String(entry.description ?? '').slice(0, SEARCH_TOOL_DESCRIPTION_LIMIT),
        category: String(entry.category ?? ''),
    };
}

// Deployed custom-integration tools are request-scoped and never written to the
// global tool_embeddings table, so the semantic RPC can't rank them. To give
// them real semantic discovery (not just keyword overlap) we embed each tool's
// text once — lazily, cached by name+description so a redeploy that changes the
// description re-embeds — and cosine-rank against the same query embedding. The
// embedder is the same model/dimension native tools use, so scores are
// comparable and the two sets can be merged into one ranking.
const SEARCH_CUSTOM_SIMILARITY_MIN = 0.25;
const customToolEmbedCache = new Map<string, number[]>();

async function semanticCustomToolMatches(
    queryEmbedding: number[],
    opts: { category?: string; kind?: string; allow: (name: string) => boolean },
): Promise<Array<{ entry: { name: string; description: string; category: string }; similarity: number }>> {
    const { category, kind, allow } = opts;
    if (kind && kind !== 'cloud') return [];
    const catalog = getCustomCatalog().filter((e) =>
        e?.name && e?.description && allow(e.name) && (!category || e.category === category),
    );
    if (catalog.length === 0) return [];

    const keyFor = (e: { name: string; description: string }) => `${e.name}\u0000${e.description}`;
    const missing = catalog.filter((e) => !customToolEmbedCache.has(keyFor(e)));
    if (missing.length > 0) {
        try {
            const { embedder } = await resolveEmbedder();
            const { embeddings } = await embedMany({
                model: embedder as any,
                values: missing.map((e) => `${e.name}: ${e.description}`),
            });
            missing.forEach((e, i) => { if (embeddings[i]) customToolEmbedCache.set(keyFor(e), embeddings[i]); });
        } catch (err) {
            console.warn('[search_tools] custom tool embedding failed', err);
            return [];
        }
    }

    const out: Array<{ entry: { name: string; description: string; category: string }; similarity: number }> = [];
    for (const e of catalog) {
        const vec = customToolEmbedCache.get(keyFor(e));
        if (!vec) continue;
        let similarity = 0;
        try { similarity = cosineSimilarity(queryEmbedding, vec); } catch { continue; }
        if (similarity > SEARCH_CUSTOM_SIMILARITY_MIN) out.push({ entry: compactToolSearchEntry(e), similarity });
    }
    return out.sort((a, b) => b.similarity - a.similarity);
}

// Core tool search, surface-aware. Both search_tools (chat) and
// search_workflow_nodes (workflow) call this, so the two discovery catalogs stay
// separated: the chat surface hides workflow-only categories (Variables /
// Workspace / Workflow-authoring) while the workflow surface hides chat-only
// tools (chat_ui, name_conversation). See isToolDiscoverableForSurface.
export async function runToolSearch(args: {
    query?: string;
    category?: string;
    kind?: string;
    surface: ToolSurface;
    limit?: number;
}): Promise<{ tools: Array<{ name: string; description: string; category: string }> }> {
    const { query, category, kind, surface } = args;
    const limit = Math.max(1, Math.min(args.limit ?? SEARCH_TOOL_RESULT_LIMIT, SEARCH_TOOL_RESULT_LIMIT));
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    if (!normalizedQuery) {
        throw new Error('search_tools requires a non-empty query');
    }
    const allow = (name: string) => isToolDiscoverableForSurface(name, surface);
    const supabase = getSupabaseService();

    const q = normalizedQuery.toLowerCase();
    const tokens = Array.from(new Set(q.split(/[^a-z0-9_]+/i).map((part) => part.trim()).filter((part) => part.length >= 3)));

    // Deployed custom-integration tools are request-scoped — they're NEVER in the
    // tool_embeddings table, so the semantic RPC can't surface them. Score them
    // independently here (uncapped + sorted) so they can be merged with priority.
    // Previously they were appended after a full page of semantic hits and then
    // truncated by the slice, so a broad query never showed a user's own tools.
    const customMatches = (): Array<{ name: string; description: string; category: string; score: number }> => {
        if (kind && kind !== 'cloud') return [];
        const out: Array<{ name: string; description: string; category: string; score: number }> = [];
        for (const entry of getCustomCatalog()) {
            if (!allow(entry.name)) continue;
            if (category && entry.category !== category) continue;
            const haystack = `${entry.name} ${entry.category} ${entry.description}`.toLowerCase();
            const exact = q && haystack.includes(q) ? 4 : 0;
            const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
            if (q && exact === 0 && tokenScore === 0) continue;
            out.push({ ...compactToolSearchEntry(entry), score: exact + tokenScore });
        }
        return out.sort((a, b) => b.score - a.score);
    };

    const keywordFallback = () => {
        const registry = getToolRegistry();
        const categories = getToolCategories();
        const results: Array<{ name: string; description: string; category: string; score: number }> = [];

        for (const [cat, names] of categories.entries()) {
            if (category && cat !== category) continue;
            for (const name of names) {
                if (!allow(name)) continue;
                const tool = registry.get(name);
                if (!tool) continue;
                const desc = tool.description || '';
                const haystack = `${name} ${cat} ${desc}`.toLowerCase();
                const exact = q && haystack.includes(q) ? 4 : 0;
                const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
                if (q && exact === 0 && tokenScore === 0) continue;
                results.push({ ...compactToolSearchEntry({ name, description: desc, category: cat }), score: exact + tokenScore });
            }
        }

        // Custom matches lead so they aren't starved by the native-tool slice.
        const merged = [...customMatches(), ...results];
        const seen = new Set<string>();
        const deduped = merged.filter((entry) => (seen.has(entry.name) ? false : (seen.add(entry.name), true)));
        return { tools: deduped.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _score, ...entry }) => entry) };
    };

    if (!supabase) return keywordFallback();
    try {
        const { embedder } = await resolveEmbedder();
        const { embeddings } = await embedMany({ model: embedder as any, values: [normalizedQuery] });
        const queryEmbedding = embeddings[0];

        const { data, error } = await supabase.rpc('search_tools', {
            query_embedding: queryEmbedding,
            match_threshold: 0.25,
            match_count: limit,
            filter_category: category ?? null,
            filter_kind: kind ?? null,
            enabled_only: true,
        });
        if (error || !data) throw error ?? new Error('search_tools RPC returned no data');
        const registry = getToolRegistry();

        // Native vector hits carry their cosine similarity from the RPC.
        const nativeScored = (data as any[])
            .filter((row) => registry.has(String(row?.name || '')) && allow(String(row?.name || '')))
            .map((row) => ({ entry: compactToolSearchEntry(row), similarity: Number(row?.similarity) || 0 }));

        // Custom-integration tools, semantically ranked in-memory against the
        // same query embedding (they're never in tool_embeddings).
        const customScored = await semanticCustomToolMatches(queryEmbedding, { category, kind, allow });

        // One unified ranking by similarity (custom + native interleave on merit,
        // so a user's deployed tools surface semantically — not just on keyword
        // overlap and not truncated off the end). Then keyword backfill catches
        // anything the vector search scored below threshold. Dedupe, then cap.
        const merged: Array<{ name: string; description: string; category: string }> = [];
        const seen = new Set<string>();
        const push = (tool: { name: string; description: string; category: string }) => {
            if (seen.has(tool.name)) return;
            seen.add(tool.name);
            merged.push(tool);
        };
        [...nativeScored, ...customScored]
            .sort((a, b) => b.similarity - a.similarity)
            .forEach((s) => push(s.entry));
        for (const tool of keywordFallback().tools) push(tool);
        return { tools: merged.slice(0, limit) };
    } catch (e) {
        console.warn('Vector search failed, falling back to keyword search', e);
        return keywordFallback();
    }
}

// Compact INPUT signature for a tool so search_tools can inline it — letting the
// model build execute_tool args directly and skip the separate get_tool_schema
// round-trip (each hop re-sends the full ~13k orchestrator prefix). Registry +
// custom-integration tools only (both carry a zod inputSchema in memory); rare
// bridge-only locals return undefined and fall back to get_tool_schema. The
// output schema is intentionally omitted — it isn't needed to make the call.
// compactSchemaSignature is a hoisted declaration defined below; safe to call
// from this async execute at runtime.
function compactInputSignatureForTool(name: string): any {
    try {
        const tool = getToolRegistry().get(name);
        if (tool?.inputSchema) {
            return compactSchemaSignature(zodToJsonSchema(tool.inputSchema));
        }
        const customTool = getCustomTools()[name];
        if (customTool?.inputSchema) {
            return compactSchemaSignature(zodToJsonSchema(customTool.inputSchema));
        }
    } catch {}
    return undefined;
}

// Surface-bound factory: the orchestrator gets the chat instance (default),
// the workflow agent gets a 'workflow' instance so it still sees workflow-only
// tools (variables/workspace/etc.) while chat does not. Both hide the other
// surface's exclusive tools.
export function createSearchToolsTool(surface: ToolSurface = 'chat') {
    return createTool({
        id: 'search_tools',
        description: 'Search for available tools with a required free-text query. Optionally narrow by category or kind. Returns up to 8 compact results, each with an inputSchema signature (arg name → type/required/enum) — usually enough to call execute_tool directly WITHOUT a separate get_tool_schema call.',
        inputSchema: z.object({
            query: z.string().min(1).describe('Required free-text query for semantic tool search.'),
            category: z.string().optional().describe('Filter results to a specific tool category.'),
            kind: z.string().optional().describe('Filter results to a specific tool kind (local, cloud, orchestration).'),
        }),
        outputSchema: z.object({
            tools: z.array(z.object({
                name: z.string(),
                description: z.string(),
                category: z.string(),
                inputSchema: z.any().optional(),
            })),
        }),
        execute: async (inputData) => {
            const { query, category, kind } = inputData as { query?: string; category?: string; kind?: string };
            const result = await runToolSearch({ query, category, kind, surface });
            // Inline each hit's compact input signature so the model can wire
            // execute_tool args in one shot, skipping the get_tool_schema hop.
            // Mirrors search_workflow_nodes (which already returns signatures).
            const tools = result.tools.map((t) => {
                const inputSchema = compactInputSignatureForTool(t.name);
                return inputSchema !== undefined ? { ...t, inputSchema } : t;
            });
            return { tools };
        },
    });
}

// Default chat-surface instance (used by the orchestrator and registered globally).
export const search_tools = createSearchToolsTool('chat');

// ─────────────────────────────────────────────────────────────────────────────
// Compact schema signatures for bulk node discovery.
//
// Raw draft-07 JSON Schema is verbose ($schema, additionalProperties, nested
// `type` wrappers, required[] arrays, etc.) and search_workflow_nodes attaches
// it for input AND output of up to 8 candidates per call — a large, repeated
// cost in the agent's history. A field signature carries everything the model
// needs to wire a node (name, required-ness, type, enum, default, range, short
// description) at ~4-5x fewer tokens and is easier to read. get_tool_schema
// still returns the full JSON Schema for a single tool when a deep dive is
// warranted.
function jsonSchemaTypeName(v: any): string {
    if (!v || typeof v !== 'object') return 'any';
    if (Array.isArray(v.enum)) return `enum[${v.enum.map((e: any) => String(e)).join('|')}]`;
    if (v.const !== undefined) return `const ${JSON.stringify(v.const)}`;
    if (v.type === 'array') return `${jsonSchemaTypeName(v.items || {})}[]`;
    if (Array.isArray(v.anyOf)) return v.anyOf.map(jsonSchemaTypeName).join('|');
    if (Array.isArray(v.oneOf)) return v.oneOf.map(jsonSchemaTypeName).join('|');
    if (typeof v.type === 'string') return v.type;
    if (v.properties) return 'object';
    return 'any';
}

function jsonSchemaFieldSig(v: any, depth: number): string {
    if (!v || typeof v !== 'object') return 'any';
    let type = jsonSchemaTypeName(v);
    // Expand one level of nested objects so the model sees their shape inline.
    if (v.type === 'object' && v.properties && depth < 1) {
        const nested = compactSchemaSignature(v, depth + 1);
        if (nested && typeof nested === 'object') {
            type = `{ ${Object.entries(nested).map(([k, s]) => `${k}: ${s}`).join(', ')} }`;
        }
    }
    const extras: string[] = [];
    if (v.default !== undefined) extras.push(`default ${JSON.stringify(v.default)}`);
    if (typeof v.minimum === 'number' || typeof v.maximum === 'number') {
        extras.push(`${v.minimum ?? ''}..${v.maximum ?? ''}`);
    }
    const meta = extras.length ? ` (${extras.join(', ')})` : '';
    const rawDesc = typeof v.description === 'string' ? v.description.trim().replace(/\s+/g, ' ') : '';
    // Cap per-field descriptions for lean discovery; the full text is always
    // available via get_tool_schema when the model needs the exact wording.
    const desc = rawDesc ? ` — ${rawDesc.length > 110 ? rawDesc.slice(0, 110) + '…' : rawDesc}` : '';
    return `${type}${meta}${desc}`;
}

/**
 * Convert a JSON Schema object into a compact `{ field(?): "type (meta) — desc" }`
 * signature. Optional fields are suffixed with "?". Returns a short type string
 * for non-object schemas, or undefined for empty/missing input.
 */
export function compactSchemaSignature(schema: any, depth = 0): any {
    if (!schema || typeof schema !== 'object') return undefined;
    const node = (Array.isArray(schema.anyOf) && schema.anyOf.length === 1) ? schema.anyOf[0]
        : (Array.isArray(schema.oneOf) && schema.oneOf.length === 1) ? schema.oneOf[0]
            : schema;
    const props = node.properties;
    if (props && typeof props === 'object') {
        const required = new Set(Array.isArray(node.required) ? node.required : []);
        const out: Record<string, string> = {};
        for (const [key, raw] of Object.entries<any>(props)) {
            out[required.has(key) ? key : `${key}?`] = jsonSchemaFieldSig(raw, depth);
        }
        return out;
    }
    if (Object.keys(node).length === 0) return undefined;
    return jsonSchemaTypeName(node);
}

// Per-session dedup for search_workflow_nodes (mirrors search_workflow_docs).
const seenWorkflowNodesByRunObject = new WeakMap<object, Set<string>>();

function resolveWorkflowNodesSeenSet(injected: Set<string> | undefined, ctx: any): Set<string> | null {
    if (injected) return injected;
    const runObj =
        ctx && typeof ctx === 'object'
            ? ctx.requestContext ?? ctx.runtimeContext ?? ctx.abortSignal ?? ctx.agent
            : null;
    if (runObj && typeof runObj === 'object') {
        let set = seenWorkflowNodesByRunObject.get(runObj);
        if (!set) {
            set = new Set<string>();
            seenWorkflowNodesByRunObject.set(runObj, set);
        }
        return set;
    }
    return null;
}

export interface SearchWorkflowNodesOptions {
    /** Shared across calls on this tool instance — pass a fresh Set per agent session. */
    seen?: Set<string>;
}

async function enrichWorkflowNodeFromSearchEntry(
    entry: { name?: string; description?: string; category?: string },
    includeSchema: boolean,
) {
    const name = String(entry?.name || '');
    const registry = getToolRegistry();
    const registryTool = registry.get(name);
    const metadata = getToolMetadata(name);
    const resolvedCategory = String(
        metadata?.category && metadata.category !== 'Other'
            ? metadata.category
            : entry?.category || metadata?.category || '',
    );
    const resolvedLocation =
        metadata?.category && metadata.category !== 'Other'
            ? metadata.location
            : getDefaultLocationForCategory(resolvedCategory);

    let inputSchema: any = undefined;
    let outputSchema: any = undefined;

    if (includeSchema) {
        if (registryTool) {
            inputSchema = registryTool.inputSchema
                ? compactSchemaSignature(zodToJsonSchema(registryTool.inputSchema))
                : undefined;
            outputSchema = registryTool.outputSchema
                ? compactSchemaSignature(zodToJsonSchema(registryTool.outputSchema))
                : undefined;
        } else if (hasClientBridge()) {
            try {
                const info = (await execLocalTool('get_tool_info', { name })) as any;
                if (info && !info.error) {
                    inputSchema = compactSchemaSignature(info.args || info.inputSchema);
                    outputSchema = compactSchemaSignature(info.outputSchema);
                }
            } catch {}
        }
    }

    return {
        name,
        description: String(entry?.description || registryTool?.description || ''),
        category: resolvedCategory,
        kind: metadata?.kind,
        location: resolvedLocation,
        inputSchema,
        outputSchema,
    };
}

export function createSearchWorkflowNodesTool(opts: SearchWorkflowNodesOptions = {}) {
    return createTool({
        id: 'search_workflow_nodes',
        description:
            'Search workflow node/tool types by semantic query or filters. Returns up to 4 best candidates, each with category, runtime type, and a compact input/output signature — enough to wire the node without a follow-up call. Nodes already returned earlier in this session are omitted (see "omitted") — re-request by exact tool name only if you need the signature again. For the full JSON Schema of one tool, use get_tool_schema.',
        inputSchema: z.object({
            query: z.string().min(1).describe('Required free-text query for semantic node search, or an exact tool name.'),
            category: z.string().optional().describe('Filter nodes to a specific category.'),
            kind: z.string().optional().describe('Filter nodes to a specific kind (local, cloud, orchestration).'),
            includeSchema: z
                .boolean()
                .default(true)
                .optional()
                .describe('Whether to include input/output schema details. Defaults true.'),
        }),
        outputSchema: z.object({
            nodes: z.array(
                z.object({
                    name: z.string(),
                    description: z.string(),
                    category: z.string(),
                    kind: z.string().optional(),
                    location: z.string().optional(),
                    inputSchema: z.any().optional(),
                    outputSchema: z.any().optional(),
                }),
            ),
            omitted: z
                .array(
                    z.object({
                        name: z.string(),
                        description: z.string().optional(),
                        category: z.string().optional(),
                    }),
                )
                .optional(),
            note: z.string().optional(),
        }),
        execute: async (inputData, ctx) => {
            const { query, category, kind, includeSchema = true } = inputData as {
                query?: string;
                category?: string;
                kind?: string;
                includeSchema?: boolean;
            };
            const seen = resolveWorkflowNodesSeenSet(opts.seen, ctx);
            const queryTrim = typeof query === 'string' ? query.trim() : '';

            // Explicit tool name re-request bypasses dedup (same as docs section id).
            // Still honor the workflow surface so a chat-only tool (chat_ui) can't be
            // pulled into a workflow by exact name.
            const registry = getToolRegistry();
            if (queryTrim && registry.has(queryTrim) && isToolDiscoverableForSurface(queryTrim, 'workflow')) {
                const node = await enrichWorkflowNodeFromSearchEntry(
                    { name: queryTrim, description: registry.get(queryTrim)?.description },
                    includeSchema,
                );
                seen?.add(node.name);
                return { nodes: [node] };
            }

            const result = await runToolSearch({ query: queryTrim, category, kind, surface: 'workflow', limit: SEARCH_WORKFLOW_NODES_RESULT_LIMIT });
            const tools = Array.isArray((result as any)?.tools) ? (result as any).tools : [];

            const nodes = await Promise.all(
                tools.map((entry: any) => enrichWorkflowNodeFromSearchEntry(entry, includeSchema)),
            );

            const omitted: Array<{ name: string; description?: string; category?: string }> = [];
            const fresh = nodes.filter((node) => {
                if (seen && seen.has(node.name)) {
                    omitted.push({
                        name: node.name,
                        description: node.description,
                        category: node.category,
                    });
                    return false;
                }
                return true;
            });

            for (const node of fresh) {
                seen?.add(node.name);
            }

            let note: string | undefined;
            if (omitted.length > 0) {
                note =
                    fresh.length === 0
                        ? `All ${omitted.length} match(es) for this query were already returned earlier in this session. Re-request by exact tool name only if you need schemas again.`
                        : `${omitted.length} further match(es) were already returned earlier in this session (see "omitted").`;
            }

            return {
                nodes: fresh,
                ...(omitted.length > 0 ? { omitted } : {}),
                ...(note ? { note } : {}),
            };
        },
    });
}

export const searchWorkflowNodes = createSearchWorkflowNodesTool();
export const search_workflow_nodes = searchWorkflowNodes;

registerTool(search_workflow_nodes, 'Workflow');

export const get_tool_schema = createTool({
    id: 'get_tool_schema',
    description: 'Get the full JSON schema (input args + output) for a tool before calling execute_tool. Returns the exact parameters the tool expects.',
    inputSchema: z.object({
        tool_name: z.string().describe('Exact tool name from the catalog or search_tools results'),
    }),
    outputSchema: z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.any(),
        outputSchema: z.any().optional(),
    }),
    execute: async (inputData) => {
        const { tool_name } = inputData;
        const tool = getToolRegistry().get(tool_name);

        if (!tool) {
            // Deployed custom-integration tool?
            const customTool = getCustomTools()[tool_name];
            if (customTool) {
                return {
                    name: tool_name,
                    description: customTool.description || tool_name,
                    inputSchema: customTool.inputSchema ? zodToJsonSchema(customTool.inputSchema) : {},
                    outputSchema: customTool.outputSchema ? zodToJsonSchema(customTool.outputSchema) : undefined,
                };
            }
            // Try the bridge for local-only tools
            if (hasClientBridge()) {
                try {
                    const info = await execLocalTool('get_tool_info', { name: tool_name }) as any;
                    if (info && !info.error) {
                        return {
                            name: tool_name,
                            description: info.description || tool_name,
                            inputSchema: info.args || info.inputSchema || {},
                            outputSchema: info.outputSchema,
                        };
                    }
                } catch {}
            }
            throw new Error(toolNotFoundError(tool_name));
        }

        return {
            name: tool.id || (tool as any).name,
            description: tool.description || '',
            inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema) : {},
            outputSchema: tool.outputSchema ? zodToJsonSchema(tool.outputSchema) : undefined,
        };
    },
});

/**
 * Mastra's Tool.execute() does NOT throw on schema-validation failure — it returns
 * { error: true, message, validationErrors }. Wrapping that in { success: true }
 * hid real failures (e.g. a tool whose output didn't match its schema) behind an
 * apparent success. Detect that shape and report it as a clean failure so the model
 * can self-correct, otherwise wrap the result as a success.
 */
/**
 * Tool-name "did you mean": models routinely call a plausible-but-wrong name
 * (e.g. `run_terminal_command` for the registered `run_command`, a generic name
 * baked into training data). Rather than dead-end with a bare "not found", score
 * every known tool name by shared underscore-tokens (+ substring bonus) and
 * suggest the closest matches so the model self-corrects in one step instead of
 * bouncing off the error. Pure string match — no embedding call, synchronous.
 */
function suggestToolNames(badName: string, limit = 3): string[] {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const tokensOf = (s: string) => new Set(norm(s).split('_').filter((t) => t.length >= 2));
    const target = norm(badName);
    const targetTokens = tokensOf(badName);
    if (targetTokens.size === 0) return [];

    const candidates = new Set<string>([
        ...getToolRegistry().keys(),
        ...Object.keys(getCustomTools()),
    ]);

    const scored: Array<{ name: string; score: number }> = [];
    for (const name of candidates) {
        const nameTokens = tokensOf(name);
        let shared = 0;
        for (const t of targetTokens) if (nameTokens.has(t)) shared += 1;
        if (shared === 0) continue;
        // Normalize by the smaller token set so a short name fully contained in
        // the bad name (run_command ⊂ run_terminal_command) scores high.
        let score = shared / Math.min(targetTokens.size, nameTokens.size);
        const nName = norm(name);
        if (nName.includes(target) || target.includes(nName)) score += 0.5;
        scored.push({ name, score });
    }

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.name);
}

function toolNotFoundError(toolName: string): string {
    const suggestions = suggestToolNames(toolName);
    const didYouMean = suggestions.length
        ? ` Did you mean: ${suggestions.join(', ')}?`
        : '';
    return `Tool '${toolName}' not found.${didYouMean} Use search_tools to find available tools.`;
}

function finalizeToolResult(toolName: string, result: any, convKey?: string) {
    if (result && typeof result === 'object' && (result as any).error === true && typeof (result as any).message === 'string') {
        return { success: false, tool: toolName, error: (result as any).message };
    }
    // captureLargeOutputs is the non-lossy successor to sanitizeToolResultForModel:
    // oversized base64/data-URL payloads are stored under a reusable {{var:…}}
    // handle (so the agent can pass them onward to image-gen / send-media) instead
    // of being redacted away. Falls back to plain sanitize when we can't resolve a
    // conversation key (no bridge secrets in context).
    const key = convKey ?? conversationKeyFromSecrets();
    const processed = key ? captureLargeOutputs(key, result) : sanitizeToolResultForModel(result);
    return { success: true, tool: toolName, result: processed };
}

export const execute_tool = createTool({
    id: 'execute_tool',
    description: 'Execute any tool by name with arguments. Use get_tool_schema first if you are unsure of the args format.',
    inputSchema: z.object({
        tool_name: z.string().describe('Exact tool name'),
        args: z.record(z.string(), z.any()).optional().default({}).describe('Arguments matching the tool schema'),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        tool: z.string().optional(),
        result: z.any().optional(),
        error: z.string().optional(),
    }),
    execute: async (inputData, runCtx) => {
        const { tool_name, args: rawArgs = {} } = inputData;
        // Rehydrate any {{var:NAME}} handles the model passed (e.g. a base64 image
        // it stashed earlier) before the underlying tool runs, and stash this
        // turn's conversation key so the result's large payloads are captured to
        // handles instead of dumped into context.
        const convKey = conversationKeyFromSecrets();
        const toolArgs = resolveVarRefs(convKey, rawArgs);
        const tool = getToolRegistry().get(tool_name);

        if (tool) {
            if (typeof tool.execute !== 'function') {
                return { success: false, tool: tool_name, error: `Tool '${tool_name}' is not executable.` };
            }
            try {
                const result = await tool.execute(toolArgs, runCtx);
                return finalizeToolResult(tool_name, result, convKey);
            } catch (err: any) {
                return { success: false, tool: tool_name, error: err.message || String(err) };
            }
        }

        // Deployed custom-integration tool?
        const customTool = getCustomTools()[tool_name];
        if (customTool && typeof customTool.execute === 'function') {
            try {
                const result = await customTool.execute(toolArgs, runCtx);
                return finalizeToolResult(tool_name, result, convKey);
            } catch (err: any) {
                return { success: false, tool: tool_name, error: err.message || String(err) };
            }
        }

        // Fallback to local agent bridge
        if (hasClientBridge()) {
            try {
                const result = await execLocalTool(tool_name, toolArgs);
                if (result && typeof result === 'object' && (result as any).error === 'unknown_tool') {
                    return { success: false, error: toolNotFoundError(tool_name) };
                }
                return finalizeToolResult(tool_name, result, convKey);
            } catch (err: any) {
                return { success: false, tool: tool_name, error: err.message || String(err) };
            }
        }

        return { success: false, error: toolNotFoundError(tool_name) };
    },
});
