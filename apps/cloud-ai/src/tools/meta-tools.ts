import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as deviceTools from './device-tools';
import * as googleTools from './google-tools';
import { web_search } from './perplexity-tools';
import { scrape_url } from './tavily-tools';
import * as outlookTools from './outlook-tools';
import * as githubTools from './github-tools';
import * as discordTools from './discord-tools';
import * as redditTools from './reddit-tools';
import * as youtubeTools from './youtube-tools';
import * as marketplaceTools from './marketplace-tools';
import * as ttsTools from './tts-tools';
import * as feedbackTools from './feedback-tools';
import * as webhookTools from './webhook-tools';
import * as httpTools from './http-tools';
import * as telnyxTools from './telnyx-tools';
import * as whatsappTools from './whatsapp-tools';
import * as metaSocialTools from './meta-social-tools';
import * as cloudStorageTools from './cloud-storage-tools';
import { waitTool } from './wait';
import { analyzeMediaTool } from './analyze-media';
import { aiInferenceTool } from './ai-inference';
import { executeAgenticTask } from './agentic-task';
import { routeToWorkflowAgent } from './workflow-subagent';
import { runSequentialTool, runParallelTool } from './workflow-system';
import { resolveEmbedder } from '../utils/embeddings';
import { embedMany } from 'ai';
import { getSupabaseService } from '../supabase';
import { registerTool, getToolRegistry, getToolCategories, getTool } from './tool-registry';
import { execLocalTool, hasClientBridge } from './bridge';
import { zodToJsonSchema } from './zod-utils';

const MEMORY_AI_TOOL_IDS = new Set([
    'memory_retrieval',
    'group_management',
    'memory_summarization',
    'memory_classify_texts',
    'memory_auto_ingest',
    'memory_extract_texts',
    'search_past_conversations',
    'get_conversation_context',
    'list_user_spaces',
    'get_space_contents',
    'add_to_space',
    'ensure_space_path',
    'list_space_path',
    'add_to_space_path',
    'get_space_tree',
    'create_space',
    'get_memory_stats',
    'add_source_to_space',
    'add_note_to_space',
    'add_code_snippet_to_space',
    'link_conversation_to_space',
    'find_or_create_space',
    'update_space_item',
    'delete_space_item',
]);

const MEMORY_AI_ALLOWLIST = new Set(['search_past_conversations', 'get_conversation_context']);

let _initialized = false;

/** Initialize tool registry if not already done */
export function initToolRegistry(): void {
  if (_initialized) return;
  _initialized = true;
  // Tools are registered during module load via registerTool() calls below
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
  - stuard.callTool(name, args) — call any workflow tool (invisible, no canvas animation)
  - stuard.callNode(nodeId, data) — call a SIBLING NODE by ID or label (see NODE-ROUTING below)

NODE-ROUTING ARCHITECTURE (callNode):
  Instead of encoding all logic inside one custom_ui callTool() block, create STANDALONE
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
            ]).optional().describe('Window position (default center)'),
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

const chatUiTool = createTool({
    id: 'chat_ui',
    description: `Render a custom interactive React component inline in the chat conversation.
Unlike custom_ui (which opens a separate window), chat_ui embeds the UI directly in the chat bubble.

COMPONENT FIELD:
  Define a function App() using JSX syntax. JSX is auto-transformed at render time.

  - Standard React JSX: <div className="p-4">{expr}</div>
  - Hooks: useState, useEffect, useRef, useMemo, useCallback
  - Tailwind CSS classes available (dark mode via dark: prefix)
  - stuard.submit(data) — submit data back to the agent (resolves blocking)
  - stuard.close() — dismiss the UI without data

BLOCKING vs NON-BLOCKING:
  - blocking: true  → Agent pauses until the user interacts (submit/close). Use for forms, confirmations, selections.
  - blocking: false → Agent continues immediately. UI stays rendered in chat as display-only. Use for dashboards, status displays, rich content.

DESIGN SCHEME (auto-injected):
  A \`designScheme\` object is available globally in your component:
    designScheme.mode    — 'dark' | 'light'
    designScheme.colors  — { background, foreground, card, cardForeground, primary, primaryForeground, muted, mutedForeground, border, input }

  The <body> has class "dark" when in dark mode. Use Tailwind dark: classes for styling:
    <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">

  By default, background and text colors already match the host app — only override when needed.

RULES:
  1. EVERY action button MUST have onClick. Use onClick={() => stuard.submit(data)} for submit buttons.
  2. initialData is available globally, seeded from the data arg.
  3. Use JSX style objects: style={{color: 'red'}} NOT style="color: red".
  4. The component renders in a sandboxed iframe — no access to parent window or Node.js APIs.

EXAMPLE (blocking form):
  component: \`
    function App() {
      const [name, setName] = useState(initialData.name || '');
      return (
        <div className="p-4 space-y-3">
          <h2 className="text-lg font-semibold">What's your name?</h2>
          <input className="w-full px-3 py-2 rounded border dark:bg-slate-800 dark:border-slate-600"
            value={name} onChange={e => setName(e.target.value)} placeholder="Enter name" />
          <button onClick={() => stuard.submit({ name })}
            className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600">
            Submit
          </button>
        </div>
      );
    }
  \`

EXAMPLE (non-blocking display):
  component: \`
    function App() {
      return (
        <div className="p-4">
          <div className="text-sm text-slate-500 dark:text-slate-400">Status</div>
          <div className="text-2xl font-bold">{initialData.status}</div>
        </div>
      );
    }
  \``,
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
registerTool(chatUiTool, 'GUI');
registerTool(notifyTool, 'System');
registerTool(logTool, 'Core');

// Device Tools
Object.values(deviceTools).forEach(t => {
    const name = (t as any)?.id || (t as any)?.name;
    if (!name) return;

    if (MEMORY_AI_TOOL_IDS.has(name) && !MEMORY_AI_ALLOWLIST.has(name)) {
        return;
    }

    if (['list_directory', 'read_file', 'write_file', 'create_directory', 'move_file', 'copy_file', 'delete_file', 'folder_permission_add', 'folder_permission_remove', 'folder_permission_list', 'folder_permission_set_enabled', 'folder_permission_check'].includes(name)) {
        registerTool(t, 'FileSystem');
    } else if (['file_index_add_root', 'file_index_remove_root', 'file_index_list_roots', 'file_index_scan', 'file_index_get_pending', 'file_index_stats', 'file_index_update', 'file_search', 'file_search_by_filename', 'file_search_by_kind', 'file_search_recent', 'file_search_details', 'file_search_similar', 'process_pending_file_index', 'process_pending_file_index_batch', 'sync_file_index_batch_jobs', 'semantic_file_search'].includes(name)) {
        registerTool(t, 'FileSearch');
    } else if (['run_command', 'run_system_command', 'list_terminals', 'read_terminal', 'launch_application_or_uri', 'list_open_windows', 'bring_window_to_foreground', 'get_window_info', 'smart_bring_window_to_foreground', 'set_window_bounds', 'python_status', 'python_setup', 'python_install', 'run_python_script', 'run_node_script'].includes(name)) {
        registerTool(t, 'System');
    } else if (['get_datetime', 'math_eval', 'generate_uuid', 'random_number', 'random_choice', 'get_env_var', 'get_system_info', 'hash_string', 'base64_encode', 'base64_decode', 'json_parse', 'json_stringify', 'sleep', 'regex_match', 'regex_replace'].includes(name)) {
        registerTool(t, 'Utils');
    } else if (['computer_use', 'computer_use_agent', 'click_at_coordinates', 'double_click_at_coordinates', 'type_text', 'send_hotkey', 'scroll', 'drag_and_drop', 'take_screenshot', 'capture_screen_to_file', 'find_and_click_text', 'get_screen_text', 'read_image_optimized', 'find_text_on_screen', 'move_cursor', 'get_mouse_position'].includes(name)) {
        registerTool(t, 'GUI');
    } else if (['capture_media', 'stop_capture', 'list_active_captures', 'describe_media_capture_capabilities', 'stream_speech', 'stop_stream_speech'].includes(name)) {
        registerTool(t, 'Media');
    } else if (['ffmpeg_status', 'ffmpeg_setup', 'ffmpeg_run', 'ffmpeg_convert_media', 'ffmpeg_extract_audio', 'ffmpeg_trim_media', 'ffmpeg_probe_media', 'ffmpeg_extract_frames'].includes(name)) {
        registerTool(t, 'Media');
    } else if (['mediapipe_status', 'mediapipe_setup', 'mediapipe_pose', 'mediapipe_hands', 'mediapipe_face_detection', 'mediapipe_face_mesh', 'mediapipe_segmentation', 'mediapipe_holistic', 'mediapipe_process_video'].includes(name)) {
        registerTool(t, 'MediaPipe');
    } else if (['stream_create', 'stream_close', 'stream_list', 'stream_get_status'].includes(name)) {
        registerTool(t, 'Streaming');
    } else if (name.startsWith('_stream_') || name.startsWith('stream_')) {
        // Internal stream tools (prefixed with _) and deprecated stream_from_* — skip registration
    } else if (['agent_node', 'agent_decision', 'agent_extract', 'deploy_headless_agent', 'get_headless_agent_status', 'list_headless_agent_tasks'].includes(name)) {
        registerTool(t, 'AI');
    } else if (['search_local_workflows', 'list_local_stuards', 'show_json_workflow_code', 'import_workflow', 'run_automation', 'stop_automation', 'create_workflow', 'workflow_modify', 'retrieve_tool_format', 'run_workflow', 'execute_workflow', 'invoke_workflow'].includes(name)) {
        registerTool(t, 'Workflow');
    } else if (['search_past_conversations', 'get_conversation_context'].includes(name)) {
        registerTool(t, 'Memory');
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
registerTool(web_search, 'Search');
registerTool(scrape_url, 'Search');

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

Object.values(outlookTools).forEach(t => registerTool(t, 'Outlook'));
// Backward compatibility alias
if (outlookTools.outlook_send_mail) {
    const t = outlookTools.outlook_send_mail;
    if (t) getToolRegistry().set('outlook_send', t);
}

Object.values(githubTools).forEach(t => registerTool(t, 'GitHub'));
Object.values(discordTools).forEach(t => registerTool(t, 'Discord'));
Object.values(redditTools).forEach(t => registerTool(t, 'Reddit'));
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
Object.values(whatsappTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'WhatsApp');
});
Object.values(metaSocialTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'MetaSocial');
});
Object.values(cloudStorageTools).forEach(t => {
    if (typeof (t as any)?.execute === 'function') registerTool(t, 'CloudStorage');
});

// 2. Meta Tools

export const search_tools = createTool({
    id: 'search_tools',
    description: 'Search for available tools by category, free-text query, or list all categories. Backed by the Supabase tool_embeddings table (with pgvector-powered semantic search for free-text queries).',
    inputSchema: z.object({
        query: z.string().optional().describe('Free-text query for semantic search.'),
        category: z.string().optional().describe('Filter results to a specific tool category.'),
        kind: z.string().optional().describe('Filter results to a specific tool kind (local, cloud, orchestration).'),
        list_categories: z.boolean().optional().describe('If true, returns the distinct list of tool categories instead of individual tools.'),
        limit: z.number().int().positive().optional().describe('Maximum number of results to return.'),
    }),
    outputSchema: z.object({
        tools: z.array(z.object({
            name: z.string(),
            description: z.string(),
            category: z.string(),
        })),
    }),
    execute: async (inputData) => {
        const { query, category, kind, list_categories, limit } = inputData as {
            query?: string;
            category?: string;
            kind?: string;
            list_categories?: boolean;
            limit?: number;
        };
        const supabase = getSupabaseService();

        const keywordFallback = () => {
            const registry = getToolRegistry();
            const categories = getToolCategories();
            const results: Array<{ name: string; description: string; category: string }> = [];
            const q = (query || '').toLowerCase();

            for (const [cat, names] of categories.entries()) {
                if (category && cat !== category) continue;
                for (const name of names) {
                    const tool = registry.get(name);
                    if (!tool) continue;
                    const desc = tool.description || '';
                    if (q && !name.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) continue;
                    results.push({ name, description: desc, category: cat });
                }
            }

            const sliced = typeof limit === 'number' ? results.slice(0, limit) : results;
            return { tools: sliced };
        };

        // Mode 1: list distinct categories from tool_embeddings
        if (list_categories) {
            if (!supabase) {
                const cats = Array.from(getToolCategories().keys()).sort();
                return { tools: cats.map((c) => ({ name: c, description: '', category: c })) };
            }
            try {
                const { data, error } = await supabase
                    .from('tool_embeddings')
                    .select('category')
                    .eq('enabled', true);
                if (error || !data) return { tools: [] };
                const unique = Array.from(
                    new Set((data as any[]).map((r) => r.category).filter(Boolean))
                ).sort() as string[];
                return { tools: unique.map((c) => ({ name: c, description: '', category: c })) };
            } catch {
                return { tools: [] };
            }
        }

        const hasQuery = typeof query === 'string' && query.trim().length > 0;

        // Mode 2: free-text semantic search via pgvector RPC
        if (hasQuery) {
            if (!supabase) return keywordFallback();
            try {
                const { embedder } = await resolveEmbedder();
                const { embeddings } = await embedMany({ model: embedder as any, values: [query as string] });
                const queryEmbedding = embeddings[0];

                const { data, error } = await supabase.rpc('search_tools', {
                    query_embedding: queryEmbedding,
                    match_threshold: 0.25,
                    match_count: typeof limit === 'number' ? limit : 10,
                    filter_category: category ?? null,
                    filter_kind: kind ?? null,
                    enabled_only: true,
                });
                if (error || !data) throw error ?? new Error('search_tools RPC returned no data');
                return {
                    tools: (data as any[]).map((r) => ({
                        name: r.name,
                        description: r.description ?? '',
                        category: r.category ?? '',
                    })),
                };
            } catch (e) {
                console.warn('Vector search failed, falling back to keyword search', e);
                return keywordFallback();
            }
        }

        // Mode 3: category / catalog listing from tool_embeddings
        if (supabase) {
            try {
                let builder: any = supabase
                    .from('tool_embeddings')
                    .select('name, description, category')
                    .eq('enabled', true);
                if (category) builder = builder.eq('category', category);
                builder = builder.order('name', { ascending: true });
                if (typeof limit === 'number') builder = builder.limit(limit);

                const { data, error } = await builder;
                if (!error && data) {
                    return {
                        tools: (data as any[]).map((r) => ({
                            name: r.name,
                            description: r.description ?? '',
                            category: r.category ?? '',
                        })),
                    };
                }
            } catch (e) {
                console.warn('Category listing failed, falling back to keyword search', e);
            }
        }

        return keywordFallback();
    },
});

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
            throw new Error(`Tool '${tool_name}' not found. Use search_tools to find available tools.`);
        }

        return {
            name: tool.id || (tool as any).name,
            description: tool.description || '',
            inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema) : {},
            outputSchema: tool.outputSchema ? zodToJsonSchema(tool.outputSchema) : undefined,
        };
    },
});

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
        const { tool_name, args: toolArgs = {} } = inputData;
        const tool = getToolRegistry().get(tool_name);

        if (tool) {
            if (typeof tool.execute !== 'function') {
                return { success: false, tool: tool_name, error: `Tool '${tool_name}' is not executable.` };
            }
            try {
                const result = await tool.execute(toolArgs, runCtx);
                return { success: true, tool: tool_name, result };
            } catch (err: any) {
                return { success: false, tool: tool_name, error: err.message || String(err) };
            }
        }

        // Fallback to local agent bridge
        if (hasClientBridge()) {
            try {
                const result = await execLocalTool(tool_name, toolArgs);
                if (result && typeof result === 'object' && (result as any).error === 'unknown_tool') {
                    return { success: false, error: `Tool '${tool_name}' not found. Use search_tools to find available tools.` };
                }
                return { success: true, tool: tool_name, result };
            } catch (err: any) {
                return { success: false, tool: tool_name, error: err.message || String(err) };
            }
        }

        return { success: false, error: `Tool '${tool_name}' not found. Use search_tools to find available tools.` };
    },
});
