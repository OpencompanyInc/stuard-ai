import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as deviceTools from './device-tools';
import * as googleTools from './google-tools';
import { web_search } from './perplexity-tools';
import { scrape_url } from './tavily-tools';
import * as outlookTools from './outlook-tools';
import * as githubTools from './github-tools';
import * as youtubeTools from './youtube-tools';
import * as marketplaceTools from './marketplace-tools';
import * as ttsTools from './tts-tools';
import * as feedbackTools from './feedback-tools';
import * as webhookTools from './webhook-tools';
import * as httpTools from './http-tools';
import { waitTool } from './wait';
import { analyzeMediaTool } from './analyze-media';
import { aiInferenceTool } from './ai-inference';
import { executeAgenticTask } from './agentic-task';
import { runSequentialTool, runParallelTool } from './workflow-system';
import { resolveEmbedder, cosineSimilarity } from '../utils/embeddings';
import { embedMany } from 'ai';
import { getSupabaseService } from '../supabase';
import { registerTool, getToolRegistry, getToolCategories, getTool } from './tool-registry';

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

let _syncPromise: Promise<void> | null = null;
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
  - stuard.callTool(name, args) — call any workflow tool

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
            borderRadius: z.number().optional().describe('Corner radius in px'),
            backgroundColor: z.string().optional().describe('Background color hex (default #1a1a2e)'),
        }).optional().describe('Window appearance configuration'),
    }),
    execute: async () => { throw new Error("This tool is for workflow definitions only, not direct execution."); }
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
    execute: async () => { throw new Error("This tool is for workflow definitions only, not direct execution."); }
});

const notifyTool = createTool({
    id: 'notify',
    description: 'Show a local desktop notification',
    inputSchema: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        severity: z.enum(['info', 'warning', 'error']).optional(),
    }),
    execute: async () => { throw new Error("This tool is for workflow definitions only, not direct execution."); }
});

const logTool = createTool({
    id: 'log',
    description: 'Log a message to the workflow console/history',
    inputSchema: z.object({
        message: z.string(),
        level: z.enum(['info', 'warn', 'error']).optional(),
        data: z.any().optional(),
    }),
    execute: async () => { throw new Error("This tool is for workflow definitions only, not direct execution."); }
});

registerTool(customUiTool, 'GUI');
registerTool(updateCustomUiTool, 'GUI');
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

// 2. Meta Tools

export const search_tools = createTool({
    id: 'search_tools',
    description: 'Search for available tools by category or query string. Returns tool names and descriptions.',
    inputSchema: z.object({
        category: z.enum(['Core', 'FileSystem', 'FileSearch', 'System', 'GUI', 'Media', 'Streaming', 'Workflow', 'Memory', 'Knowledge', 'Productivity', 'AI', 'Google', 'Outlook', 'GitHub', 'YouTube', 'Marketplace', 'Variables', 'Database', 'Embeddings', 'Math', 'Feedback', 'Webhooks', 'Integrations', 'Canvas', 'Other']).optional(),
        query: z.string().optional(),
    }),
    outputSchema: z.object({
        tools: z.array(z.object({
            name: z.string(),
            description: z.string(),
            category: z.string(),
        })),
    }),
    execute: async (inputData) => {
        const { category, query } = inputData;
        const registry = getToolRegistry();
        const categories = getToolCategories();

        const keywordSearch = () => {
            const results: Array<{ name: string; description: string; category: string }> = [];
            const q = (query || '').toLowerCase();

            for (const [cat, names] of categories.entries()) {
                if (category && cat !== category) continue;

                for (const name of names) {
                    const tool = registry.get(name);
                    if (!tool) continue;

                    const desc = tool.description || '';
                    if (q && !name.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) continue;

                    results.push({
                        name,
                        description: desc,
                        category: cat,
                    });
                }
            }

            return { tools: results };
        };

        const supabase = getSupabaseService();
        const hasQuery = typeof query === 'string' && query.trim().length > 0;

        if (!hasQuery || !supabase) {
            return keywordSearch();
        }

        // Vector Search Logic
        if (!_syncPromise) {
            _syncPromise = ensureToolEmbeddings().catch(e => console.error('Tool embedding sync failed', e));
        }
        try { await _syncPromise; } catch { }

        try {
            const { embedder } = await resolveEmbedder();
            const { embeddings } = await embedMany({ model: embedder as any, values: [query] });
            const queryVector = embeddings[0];

            // Fetch all tools (caching in memory would be better, but for <1000 tools this is fast enough)
            const { data: rows, error } = await supabase.from('tool_embeddings').select('name, description, category, embedding');
            if (error || !rows) throw error;

            let candidates = rows;
            if (category) {
                candidates = rows.filter((r: any) => r.category === category);
            }

            const withScores = candidates.map((r: any) => {
                let vec = r.embedding;
                if (typeof vec === 'string') {
                    try { vec = JSON.parse(vec); } catch { }
                }
                const sim = Array.isArray(vec) ? cosineSimilarity(queryVector, vec) : -1;
                return { ...r, score: sim };
            });

            withScores.sort((a: any, b: any) => b.score - a.score);

            // Return top 10
            const top = withScores.slice(0, 10).map((t: any) => ({
                name: t.name,
                description: t.description,
                category: t.category,
            }));

            return { tools: top };

        } catch (e) {
            console.warn('Vector search failed, falling back to keyword search', e);
            return keywordSearch();
        }
    },
});

export const get_tool_schema = createTool({
    id: 'get_tool_schema',
    description: 'Get the full JSON schema (input arguments and output) for a specific tool.',
    inputSchema: z.object({
        tool_name: z.string(),
    }),
    outputSchema: z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.any(),
        outputSchema: z.any().optional(),
    }),
    execute: async (inputData, runCtx) => {
        const { tool_name } = inputData;
        const tool = getToolRegistry().get(tool_name);

        if (!tool) {
            throw new Error(`Tool '${tool_name}' not found.`);
        }

        return {
            name: tool.id || (tool as any).name,
            description: tool.description,
            inputSchema: tool.inputSchema ? "See tool definition" : {}, // Placeholder
        };
    },
});

export const execute_tool = createTool({
    id: 'execute_tool',
    description: 'Execute a tool by name with the given arguments.',
    inputSchema: z.object({
        tool_name: z.string(),
        args: z.any().describe('Arguments for the tool as a key-value object.'),
    }),
    outputSchema: z.any(),
    execute: async (inputData, runCtx) => {
        const { tool_name, args: toolArgs } = inputData;
        const tool = getToolRegistry().get(tool_name);

        if (!tool) {
            throw new Error(`Tool '${tool_name}' not found.`);
        }

        if (typeof tool.execute !== 'function') {
             throw new Error(`Tool '${tool_name}' is not executable.`);
        }

        return await tool.execute(toolArgs, runCtx);
    },
});
