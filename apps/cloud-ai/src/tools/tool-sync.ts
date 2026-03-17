import { getSupabaseService } from '../supabase';
import { getToolRegistry, getToolMetadata } from './tool-registry';
import { embedMany } from 'ai';
import { google } from '../utils/models';
import { clearToolCache } from './sis-supabase';
import { z } from 'zod';

// Ensure registry is initialized
import './meta-tools';
import { initToolRegistry } from './meta-tools';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const BATCH_SIZE = 50;

export interface ToolSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

/**
 * Semantic hints to improve tool matching.
 * Add alternative phrases, common user queries, and related terms.
 */
const SEMANTIC_HINTS: Record<string, string[]> = {
  // Gmail / Google Profile
  google_list_profiles: ['list google users', 'list connected accounts', 'who am i', 'what google profiles do i have', 'google accounts'],
  google_get_userinfo: ['user profile', 'google profile', 'my account info', 'who am i', 'my email'],
  gmail_send_message: ['email', 'send mail', 'compose', 'draft', 'message'],
  gmail_list_messages: ['inbox', 'email list', 'check mail', 'emails'],
  gmail_get_message_brief: ['email summary', 'read email', 'message preview'],
  gmail_get_message_full: ['full email', 'email content', 'message body'],
  gmail_retrieve_messages_with_attachments: ['download attachments', 'email attachments', 'save attachments', 'get files from email', 'download files'],
  gmail_modify_message: ['label email', 'categorize', 'organize'],
  gmail_delete_message: ['remove email', 'trash', 'delete mail'],
  gmail_archive_message: ['archive mail', 'move from inbox'],
  gmail_mark_as_read: ['read email', 'mark read'],
  gmail_mark_as_unread: ['unread email', 'mark unread'],

  // Outlook
  outlook_get_me: ['outlook profile', 'microsoft account'],
  outlook_list_messages: ['outlook inbox', 'outlook emails'],
  outlook_search_messages: ['search outlook', 'find outlook email'],
  outlook_send_mail: ['send outlook', 'outlook compose'],
  outlook_get_message: ['read outlook email', 'outlook message detail'],
  outlook_list_recent_brief: ['recent outlook', 'latest outlook emails'],
  outlook_list_folders: ['outlook folders', 'mail folders'],
  outlook_reply_message: ['reply outlook', 'respond email'],
  outlook_forward_message: ['forward outlook', 'forward email'],
  outlook_create_draft: ['outlook draft', 'draft email'],
  outlook_mark_as_read: ['outlook read', 'mark read'],
  outlook_mark_as_unread: ['outlook unread', 'mark unread'],
  outlook_archive_message: ['outlook archive', 'archive email'],
  outlook_move_message: ['outlook move', 'move email folder'],
  outlook_delete_message: ['outlook delete', 'delete email'],
  outlook_download_attachment: ['outlook attachment', 'download outlook file'],
  outlook_retrieve_messages_with_attachments: ['outlook attachments', 'outlook download'],
  outlook_calendar_list_events: ['outlook calendar', 'outlook events', 'outlook meetings'],
  outlook_calendar_create_event: ['outlook new event', 'outlook meeting', 'create outlook event'],
  outlook_calendar_update_event: ['outlook update event', 'change outlook meeting'],
  outlook_calendar_delete_event: ['outlook cancel event', 'delete outlook meeting'],

  // GitHub
  github_get_me: ['github profile', 'github user'],
  github_list_repos: ['repositories', 'projects', 'code repos', 'my repos'],
  github_list_issues: ['issues', 'bugs', 'tickets', 'github issues'],
  github_create_issue: ['bug report', 'new issue', 'create ticket', 'report bug'],

  // Discord
  discord_list_guilds: ['discord servers', 'my servers', 'guilds', 'discord'],
  discord_list_channels: ['discord channels', 'server channels', 'text channels'],
  discord_list_dms: ['discord dms', 'direct messages', 'discord conversations', 'discord inbox'],
  discord_read_messages: ['read discord', 'discord messages', 'check discord', 'view messages', 'discord chat'],
  discord_send_dm: ['send discord message', 'dm on discord', 'direct message', 'message someone discord'],
  discord_add_reaction: ['react discord', 'emoji reaction', 'discord reaction', 'react to message'],

  // Reddit
  reddit_search: ['search reddit', 'find on reddit', 'reddit lookup', 'reddit query'],
  reddit_view_subreddit: ['subreddit posts', 'browse reddit', 'reddit feed', 'r/', 'subreddit'],
  reddit_view_comments: ['reddit comments', 'post comments', 'reddit discussion', 'read comments'],
  reddit_create_post: ['post on reddit', 'submit to reddit', 'create reddit post', 'new reddit post'],
  reddit_comment: ['reply on reddit', 'reddit comment', 'respond on reddit', 'comment reddit'],

  // Browser
  browser_get_content: ['webpage', 'scrape', 'extract', 'page content', 'web page'],
  browser_click_element: ['click button', 'interact', 'automate click'],
  browser_type_text: ['type in browser', 'fill input', 'enter text'],
  browser_find_text: ['search page', 'find on page'],
  browser_fill_form: ['fill form', 'submit form', 'form automation'],
  browser_execute_script: ['run javascript', 'execute js', 'browser script'],

  // Files
  read_file: ['open file', 'view file', 'file content'],
  write_file: ['save file', 'create file', 'write to file'],
  file_read: ['read with line numbers', 'code file'],
  file_edit: ['modify file', 'change code', 'update file', 'edit code'],
  file_search: ['find files', 'locate', 'search documents'],
  list_directory: ['ls', 'folder contents', 'list files', 'directory listing'],
  create_directory: ['mkdir', 'new folder', 'create folder'],
  move_file: ['rename file', 'move file', 'mv'],
  copy_file: ['duplicate file', 'cp', 'copy'],
  delete_file: ['remove file', 'rm', 'delete'],
  open_file: ['launch file', 'open with app'],

  // System
  run_command: ['terminal', 'shell', 'execute', 'bash', 'cmd', 'command line'],
  run_system_command: ['system command', 'shell command'],
  run_python_script: ['python', 'script', 'py', 'python code'],
  run_node_script: ['nodejs', 'javascript', 'node script'],

  // Terminal
  terminal_create: ['new terminal', 'open terminal', 'start shell'],
  terminal_list: ['list terminals', 'active shells'],
  terminal_send_input: ['terminal input', 'shell command'],
  list_terminals: ['active terminals', 'background processes'],
  read_terminal: ['terminal output', 'shell output'],

  // Vision/Media
  analyze_media: ['analyze video', 'analyze audio', 'youtube', 'media analysis'],
  take_screenshot: ['screenshot', 'capture screen', 'screen capture'],
  capture_media: ['record', 'capture video', 'capture audio', 'record screen'],
  analyze_image: ['image analysis', 'vision', 'describe image'],
  analyze_current_screen: ['what on screen', 'screen analysis'],
  find_text: ['find text on screen', 'locate text on screen', 'get text coordinates', 'find label on screen', 'ocr screen text'],
  find_text_on_screen: ['legacy screen text finder', 'find text on screen', 'screen text coordinates'],
  find_and_click_text: ['find and click text', 'click text on screen', 'ocr click text', 'click matching label'],

  // Secure Vault (Credential Management)
  vault_list: ['list passwords', 'list credentials', 'saved passwords', 'vault entries', 'my credentials'],
  vault_get: ['get password', 'get credential', 'show credential', 'view password', 'retrieve secret'],
  vault_add: ['save password', 'store credential', 'add password', 'save secret', 'store api key'],
  vault_update: ['update password', 'change credential', 'update secret', 'change api key'],
  vault_delete: ['delete password', 'remove credential', 'delete secret'],
  vault_get_credential: ['use credential', 'login with saved password', 'get login info', 'use saved password'],
  vault_search: ['find password', 'search credentials', 'find credential for', 'lookup password'],
  vault_stats: ['vault statistics', 'how many passwords', 'credential count'],

  // Web Search
  web_search: ['google', 'search online', 'look up', 'find information', 'research'],

  // Web Extraction
  scrape_url: ['scrape url', 'extract url', 'web scrape', 'web extraction', 'get page content', 'tavily extract'],

  // Memory/Context
  search_past_conversations: ['history', 'previous chats', 'memory search'],
  get_conversation_context: ['conversation history', 'chat context'],
  list_user_spaces: ['spaces', 'folders', 'collections'],
  get_space_contents: ['space items', 'folder contents'],
  ensure_space_path: ['create folder path', 'ensure folder', 'make folders', 'space path', 'nested folders'],
  list_space_path: ['list folder path', 'browse space', 'folder listing', 'space path list'],
  add_to_space_path: ['add to folder', 'save under path', 'add note to folder', 'space subfolder'],
  get_space_tree: ['space tree', 'folder tree', 'space folders', 'list folders'],

  // Workflows
  search_local_workflows: ['workflows', 'automations', 'stuards'],
  run_automation: ['run workflow', 'execute automation'],
  invoke_workflow: ['call workflow', 'trigger workflow'],

  // Headless Agents
  deploy_headless_agent: ['background task', 'spawn agent', 'async task'],
  get_headless_agent_status: ['task status', 'agent status', 'background status'],
  list_headless_agent_tasks: ['list tasks', 'background tasks'],
  stop_headless_agent: ['cancel task', 'stop agent', 'abort task'],

  // UI
  custom_ui: ['dialog', 'prompt', 'interface', 'form', 'popup', 'pages', 'spa', 'multi-page', 'app', 'navigation'],
  show_table: ['display data', 'grid', 'results table'],
  show_choices: ['multiple choice', 'options', 'selection'],
  ask_confirmation: ['confirm', 'yes no', 'approval'],
  show_progress: ['progress bar', 'loading'],

  // Calendar/Tasks
  calendar_crud: ['calendar', 'events', 'schedule', 'appointments'],
  calendar_delete_event: ['delete calendar event', 'remove event', 'cancel meeting', 'cancel event', 'delete meeting'],
  calendar_update_event: ['update calendar event', 'edit event', 'reschedule meeting', 'modify event', 'change event time', 'recurring event'],
  task_crud: ['tasks', 'todos', 'reminders'],
  task_reminders: ['reminder', 'set reminder', 'recurring reminder', 'repeat reminder', 'notification', 'alert', 'sms reminder', 'whatsapp reminder', 'cloud reminder', 'notify me', 'text me', 'send me a reminder'],

  // Window Management
  list_open_windows: ['windows', 'active apps', 'running programs'],
  bring_window_to_foreground: ['focus window', 'switch window', 'activate window'],
  smart_bring_window_to_foreground: ['find window', 'open app', 'launch'],

  // Input
  send_hotkey: ['keyboard shortcut', 'hotkey', 'key combo'],
  computer_use: ['computer use', 'control computer', 'use the computer', 'gui automation', 'mouse and keyboard', 'click and type', 'desktop control'],
  computer_use_agent: ['autonomous computer use', 'take control', 'control my screen', 'do it for me', 'computer control loop', 'agentic computer use'],
  type_text: ['type', 'keyboard input', 'enter text'],
  click_at_coordinates: ['click', 'mouse click'],
  scroll: ['scroll page', 'scroll down', 'scroll up'],
  drag_and_drop: ['drag', 'move element'],

  // Orchestration
  wait: ['delay', 'pause', 'sleep', 'wait seconds'],
  run_sequential: ['sequence', 'chain', 'one by one'],
  run_parallel: ['parallel', 'concurrent', 'simultaneously'],

  // Telnyx Telephony
  telnyx_send_sms: ['send sms', 'text message', 'send text', 'sms'],
  telnyx_send_mms: ['send picture', 'send image', 'mms', 'picture message', 'image message', 'send photo'],
  telnyx_send_voice_note: ['voice note', 'audio message', 'voice message', 'send recording', 'voice memo'],
  telnyx_voice_call: ['voice call', 'ai call', 'realtime call', 'phone conversation', 'voip call', 'live call', 'phone call', 'call phone', 'make call', 'tts call', 'elevenlabs call', 'openai call', 'grok call', 'gemini call'],
  telnyx_list_voice_providers: ['voice providers', 'available providers', 'voice services'],
  telnyx_list_active_calls: ['active calls', 'ongoing calls', 'current calls'],
  telnyx_hangup_call: ['hangup', 'end call', 'disconnect call'],

  // WhatsApp
  whatsapp_send_message: ['whatsapp message', 'send whatsapp', 'wa message'],
  whatsapp_send_media: ['whatsapp image', 'whatsapp photo', 'send media whatsapp', 'whatsapp file'],
  whatsapp_send_reaction: ['react whatsapp', 'emoji reaction', 'whatsapp emoji'],
  whatsapp_send_voice_note: ['whatsapp voice', 'whatsapp audio', 'voice note whatsapp', 'audio message whatsapp'],
  whatsapp_transcribe_voice_note: ['transcribe voice', 'voice to text', 'speech to text whatsapp', 'transcribe audio'],
  whatsapp_send_template: ['whatsapp template', 'template message', 'approved template'],
  whatsapp_voice_call: ['whatsapp call', 'call whatsapp', 'voice call whatsapp', 'phone call whatsapp', 'ai call whatsapp'],
  whatsapp_make_call: ['call whatsapp basic', 'tts call whatsapp', 'speak to whatsapp'],
};

/**
 * Get semantic hints for a tool
 */
function getSemanticHints(toolName: string): string[] {
  const hints = SEMANTIC_HINTS[toolName];
  if (hints) return hints;
  // Generate default hints from tool name
  return [toolName.replace(/_/g, ' ')];
}

/**
 * Convert Zod schema to a simpler JSON representation for DB storage
 * This is a best-effort conversion to give the AI context about arguments
 */
function zodToJSON(schema: any): any {
  try {
    if (!schema) return {};
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const result: any = {};
      for (const key in shape) {
        result[key] = zodToJSON(shape[key]);
      }
      return result;
    }
    if (schema instanceof z.ZodArray) {
      return [zodToJSON(schema._def?.type ?? schema.element)];
    }
    if (schema instanceof z.ZodString) return "string";
    if (schema instanceof z.ZodNumber) return "number";
    if (schema instanceof z.ZodBoolean) return "boolean";
    if (schema instanceof z.ZodEnum) {
      const vals = (schema._def as any)?.values;
      return vals ? `enum(${Array.isArray(vals) ? vals.join('|') : Object.values(vals).join('|')})` : "enum";
    }
    if (schema instanceof z.ZodUnion) return "union";
    if (schema instanceof z.ZodOptional) return zodToJSON(schema._def?.innerType) + "?";
    if (schema instanceof z.ZodDefault) return zodToJSON(schema._def?.innerType);
    if (schema instanceof z.ZodAny) return "any";
    if (schema instanceof z.ZodRecord) return "record";
    if (schema instanceof z.ZodNullable) return zodToJSON(schema._def?.innerType) + "|null";
    if (schema instanceof z.ZodLiteral) return `literal(${(schema._def as any)?.value})`;
    if (schema instanceof z.ZodTuple) return "tuple";
    if ((schema as any)?._def?.typeName === 'ZodEffects') return zodToJSON((schema._def as any)?.schema);
    if ((schema as any)?._def?.typeName === 'ZodNativeEnum') {
      const vals = (schema._def as any)?.values;
      return vals ? `enum(${Object.values(vals).filter(v => typeof v === 'string').join('|')})` : "enum";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Sync tool definitions to Supabase tool_embeddings table
 */
export async function syncToolsToSupabase(options: {
  force?: boolean;
  toolNames?: string[];
} = {}): Promise<ToolSyncResult> {
  // Ensure tools are registered
  initToolRegistry();

  const { force = false, toolNames } = options;
  const result: ToolSyncResult = { synced: 0, skipped: 0, errors: [] };

  const supabase = getSupabaseService();
  if (!supabase) {
    result.errors.push('Supabase service not available');
    return result;
  }

  // Get tools from registry
  const registry = getToolRegistry();
  let toolsToSync: any[] = [];

  if (toolNames && toolNames.length > 0) {
    for (const name of toolNames) {
      const tool = registry.get(name);
      if (tool) toolsToSync.push(tool);
    }
  } else {
    toolsToSync = Array.from(registry.values());
  }

  console.log(`[tool-sync] Found ${toolsToSync.length} tool definitions`);

  // Check which tools need updating
  const { data: existingTools, error: fetchError } = await supabase
    .from('tool_embeddings')
    .select('name, updated_at')
    .in('name', toolsToSync.map(t => t.id || t.name));

  if (fetchError) {
    result.errors.push(`Failed to fetch existing tools: ${fetchError.message}`);
    return result;
  }

  const existingMap = new Map(
    (existingTools || []).map((t: any) => [t.name, new Date(t.updated_at)])
  );

  const toUpdate = force
    ? toolsToSync
    : toolsToSync.filter(t => !existingMap.has(t.id || t.name));

  if (toUpdate.length === 0) {
    console.log('[tool-sync] All tools up to date');
    result.skipped = toolsToSync.length;
    return result;
  }

  console.log(`[tool-sync] Syncing ${toUpdate.length} tools (${force ? 'forced' : 'incremental'})...`);

  // Generate embeddings in batches
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toUpdate.length / BATCH_SIZE);

    console.log(`[tool-sync] Processing batch ${batchNum}/${totalBatches} (${batch.length} tools)...`);

    try {
      // Generate embeddings
      const texts = batch.map(t => {
        const id = t.id || t.name;
        const hints = getSemanticHints(id);
        return `${id}: ${t.description}${hints.length > 0 ? ' ' + hints.join(' ') : ''}`;
      });

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel(EMBEDDING_MODEL),
        values: texts,
      });

      // Prepare rows for upsert
      const rows = batch.map((tool, idx) => {
        const id = tool.id || tool.name;
        const metadata = getToolMetadata(id) || { category: 'Other', kind: 'local' };

        return {
          name: id,
          description: tool.description,
          category: metadata.category,
          kind: metadata.kind || 'local',
          schema: {
            args: zodToJSON(tool.inputSchema),
            output: zodToJSON(tool.outputSchema)
          },
          semantic_hints: getSemanticHints(id),
          embedding: embeddings[idx],
          enabled: true,
          updated_at: new Date().toISOString(),
        };
      });

      // Upsert to Supabase
      const { error: upsertError } = await supabase
        .from('tool_embeddings')
        .upsert(rows, { onConflict: 'name' });

      if (upsertError) {
        const errorMsg = `Batch ${batchNum} failed: ${upsertError.message}`;
        console.error('[tool-sync]', errorMsg);
        result.errors.push(errorMsg);
      } else {
        result.synced += batch.length;
        console.log(`[tool-sync] Batch ${batchNum} synced successfully`);
      }
    } catch (error: any) {
      const errorMsg = `Batch ${batchNum} error: ${error.message}`;
      console.error('[tool-sync]', errorMsg);
      console.error('[tool-sync] Stack:', error.stack);
      result.errors.push(errorMsg);
    }
  }

  // Clear cache after sync
  clearToolCache();

  console.log(`[tool-sync] Sync complete: ${result.synced} synced, ${result.errors.length} errors`);
  return result;
}

/**
 * Disable tools that are no longer in registry
 */
export async function disableObsoleteTools(): Promise<number> {
  initToolRegistry();
  const supabase = getSupabaseService();
  if (!supabase) return 0;

  const validToolNames = Array.from(getToolRegistry().keys());

  // Get currently enabled tools that aren't in registry
  const { data: allEnabled } = await supabase
    .from('tool_embeddings')
    .select('name')
    .eq('enabled', true);

  const toDisable = (allEnabled || [])
    .filter((t: any) => !validToolNames.includes(t.name))
    .map((t: any) => t.name);

  if (toDisable.length === 0) {
    console.log('[tool-sync] No obsolete tools to disable');
    return 0;
  }

  const { error } = await supabase
    .from('tool_embeddings')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .in('name', toDisable);

  if (error) {
    console.error('[tool-sync] Failed to disable obsolete tools:', error.message);
    return 0;
  }

  console.log(`[tool-sync] Disabled ${toDisable.length} obsolete tools:`, toDisable);
  clearToolCache();

  return toDisable.length;
}

/**
 * Get sync status for all tools
 */
export async function getSyncStatus(): Promise<{
  definedCount: number;
  syncedCount: number;
  unsyncedTools: string[];
  obsoleteTools: string[];
}> {
  initToolRegistry();
  const supabase = getSupabaseService();
  const registry = getToolRegistry();
  const definedTools = Array.from(registry.keys());

  if (!supabase) {
    return {
      definedCount: definedTools.length,
      syncedCount: 0,
      unsyncedTools: definedTools,
      obsoleteTools: [],
    };
  }

  const definedNames = new Set(definedTools);

  const { data: syncedTools } = await supabase
    .from('tool_embeddings')
    .select('name, enabled');

  const syncedSet = new Set((syncedTools || []).map((t: any) => t.name));

  const unsyncedTools = definedTools.filter(t => !syncedSet.has(t));

  const obsoleteTools = (syncedTools || [])
    .filter((t: any) => !definedNames.has(t.name) && t.enabled)
    .map((t: any) => t.name);

  return {
    definedCount: definedTools.length,
    syncedCount: syncedSet.size,
    unsyncedTools,
    obsoleteTools,
  };
}

/**
 * Validate that all synced tools have valid embeddings
 */
export async function validateSyncedTools(): Promise<{
  valid: number;
  invalid: string[];
}> {
  const supabase = getSupabaseService();
  if (!supabase) {
    return { valid: 0, invalid: [] };
  }

  const { data: tools } = await supabase
    .from('tool_embeddings')
    .select('name, embedding')
    .eq('enabled', true);

  const invalid: string[] = [];
  let valid = 0;

  for (const tool of (tools || []) as any[]) {
    // Check if embedding exists and has correct dimension
    if (!tool.embedding || !Array.isArray(tool.embedding) || tool.embedding.length !== 3072) {
      invalid.push(tool.name);
    } else {
      valid++;
    }
  }

  return { valid, invalid };
}
