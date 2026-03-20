import { Agent } from '@mastra/core/agent';
import type { ModelChoice } from '../router/model-router';
import { getDefaultModelForCategory } from '../pricing';
import { buildProviderModel } from '../utils/models';
import { waitTool } from '../tools/wait';
import { runSequentialTool, runParallelTool } from '../tools/workflow-system';
import { analyzeMediaTool } from '../tools/analyze-media';
import { deployHeadlessAgent } from '../tools/deploy-headless-agent';
import { getHeadlessAgentStatus } from '../tools/get-headless-agent-status';
import { listHeadlessAgentTasks } from '../tools/list-headless-agent-tasks';
import {
  outlook_get_me, outlook_list_messages, outlook_search_messages, outlook_send_mail,
  outlook_get_message, outlook_list_recent_brief, outlook_list_folders,
  outlook_reply_message, outlook_forward_message, outlook_create_draft,
  outlook_mark_as_read, outlook_mark_as_unread, outlook_archive_message,
  outlook_move_message, outlook_delete_message,
  outlook_download_attachment, outlook_retrieve_messages_with_attachments,
  outlook_calendar_list_events, outlook_calendar_create_event,
  outlook_calendar_update_event, outlook_calendar_delete_event,
} from '../tools/outlook-tools';
import { github_get_me, github_list_repos, github_list_issues, github_create_issue } from '../tools/github-tools';
import { google_get_userinfo, gmail_list_messages, gmail_get_message_brief, gmail_get_message_full, gmail_get_messages_brief, gmail_list_recent_brief, gmail_get_most_recent_full, calendar_list_events, calendar_create_event, calendar_delete_event, calendar_update_event, tasks_list, drive_list_files, sheets_read_range, sheets_create_spreadsheet, sheets_write_range, sheets_append_rows, sheets_clear_range, sheets_get_spreadsheet, sheets_add_sheet, sheets_format_cells, sheets_batch_update_values, sheets_delete_rows_columns, sheets_sort_range, sheets_auto_resize, docs_get_document, docs_create_document, docs_write_text } from '../tools/google-tools';
import { facebook_get_me, facebook_list_pages, facebook_list_page_posts, facebook_create_page_post, facebook_list_post_comments, facebook_reply_comment, facebook_delete_post, facebook_list_conversations, facebook_get_conversation_messages, facebook_send_message, instagram_get_me, instagram_list_media, instagram_publish_media, instagram_list_comments, instagram_reply_comment, instagram_delete_comment, instagram_list_conversations, instagram_get_conversation_messages, instagram_send_dm, threads_get_me, threads_list_posts, threads_publish_post, threads_get_post, threads_list_replies, threads_reply_to_post } from '../tools/meta-social-tools';
import { whatsapp_send_message, whatsapp_send_media, whatsapp_send_reaction, whatsapp_mark_read, whatsapp_upload_media, whatsapp_status, whatsapp_get_media_url, whatsapp_download_media, whatsapp_send_voice_note, whatsapp_transcribe_voice_note, whatsapp_send_template, whatsapp_voice_call, whatsapp_make_call } from '../tools/whatsapp-tools';
import { telnyx_send_sms, telnyx_call_control, telnyx_phone_status, telnyx_send_mms, telnyx_send_voice_note, telnyx_voice_call, telnyx_list_voice_providers, telnyx_list_active_calls, telnyx_hangup_call } from '../tools/telnyx-tools';
import { send_hotkey, list_directory, read_file, write_file, create_directory, move_file, canvas_list, canvas_read, canvas_write, canvas_create, canvas_delete, calendar_crud, task_crud, task_reminders, planner_list_items, capture_media, describe_media_capture_capabilities, run_command, run_system_command, search_local_workflows, import_workflow, run_automation, stop_automation, search_past_conversations, get_conversation_context, agent_decision, agent_extract, glob, grep, browser_use_status, browser_use_configure, browser_use_execute_script, browser_use_navigate, browser_use_click, browser_use_type, browser_use_press_key, browser_use_screenshot, browser_use_content, browser_use_scroll, browser_use_tabs, browser_use_cookies, browser_use_hover, browser_use_select_option, browser_use_get_dropdown_options, browser_use_get_interactive_elements, browser_use_fill_form, browser_use_upload_file, browser_use_wait_for } from '../tools/device-tools';
import { web_search } from '../tools/perplexity-tools';

const HEADLESS_SYSTEM_INSTRUCTIONS = `You are the Headless Execution Agent for StuardAI.
You are a highly optimized, non-conversational agent designed for autonomous task execution within a workflow.

OBJECTIVE:
- Complete the assigned task efficiently using available tools.
- Output strict structured data if a schema is provided.
- Do NOT engage in small talk, pleasantries, or conversational filler.
- Do NOT ask for clarification unless the task is completely impossible with current information.
- If you encounter an error, retry with a different strategy or tool parameters.
- If you cannot complete the task after retries, report the failure concisely.

OPERATING PROCEDURE:
1. Analyze the instruction and any input context.
2. Formulate a plan to achieve the goal using tools.
3. Execute tools (observe -> act -> verify).
4. When the task is complete, return the final result.

BROWSER AUTOMATION:
When browsing websites, filling forms, or interacting with web pages:
1. Navigate to the URL with browser_use_navigate.
2. ALWAYS call browser_use_get_interactive_elements to discover all forms, inputs, buttons, links with their exact CSS selectors. This is how you understand the page structure.
3. Use the exact selectors from get_interactive_elements to interact. NEVER guess CSS selectors. Always discover them first.
4. After actions that change the page (clicks, form submissions), use browser_use_wait_for then browser_use_get_interactive_elements again to see what changed.

HANDLING DROPDOWNS — read controlType from get_interactive_elements output:
- When you encounter a dropdown, FIRST call browser_use_get_dropdown_options({ selector }) to read all available options WITHOUT selecting anything. This lets you see exactly what choices exist before making a selection.
- Then call browser_use_select_option with the exact text/value from the options list.
- Native <select> (tag: "select", controlType: "dropdown"): browser_use_get_dropdown_options reads options directly. Then use browser_use_select_option with value or label.
- Searchable combobox / autocomplete (controlType: "dropdown" with role "combobox", or an input with aria-haspopup): Use browser_use_select_option with the "search" parameter. This types the search text, waits for filtered results, and clicks the match. Example: browser_use_select_option({ selector: "#country-input", search: "United States", label: "United States" })
- Custom dropdown (button/div with controlType: "dropdown"): browser_use_get_dropdown_options clicks to open, reads options, then closes. Then use browser_use_select_option with the exact label or value.
- If select_option fails, the error response includes the list of available options. Use one of those exact option texts to retry with the correct label.
- CRITICAL: NEVER use browser_use_type to fill a dropdown or combobox. The model must ALWAYS use browser_use_select_option for any element with controlType "dropdown". If you type into a combobox input, the dropdown will not register a selection — the form framework expects an option to be clicked from the popup list.

HANDLING TOGGLES (checkboxes, radio buttons, switches):
- Elements with controlType: "toggle" (type: checkbox/radio, or role: checkbox/radio/switch).
- The "checked" field in get_interactive_elements shows current state (true/false).
- To toggle: use browser_use_click on the element's selector, OR use browser_use_fill_form with type "checkbox"/"toggle"/"switch" and value "true"/"false".
- For switches (role="switch"): browser_use_click toggles the state. Check the current "checked" value first to avoid double-toggling.

FORM FILLING STRATEGY:
- Prefer browser_use_fill_form for filling multiple fields at once. Use the array format with explicit types:
  [{ selector, value, type: "text" }, { selector, value: "Option Text", type: "select" }, { selector, value: "true", type: "checkbox" }]
- For file inputs, use browser_use_upload_file with a local file path.
- After filling, verify with browser_use_get_interactive_elements to confirm values were set correctly.

OUTPUT FORMAT:
- Your final response must be the result of the task.
- If an output schema is provided, ensure your final response matches it exactly.
`;

/**
 * Get a headless agent configured for task execution.
 * This agent is stripped of personality and focused on tools.
 */
export interface HeadlessAgentOptions {
  model?: ModelChoice;
  enabledIntegrations?: string[];
  mcpTools?: Record<string, any>;
  allowedTools?: string[];
  customSystemPrompt?: string;
  /** When true, desktop-only tools (clipboard, hotkeys, screen capture, etc.) are excluded. Browser tools remain available via Xvfb. */
  vmMode?: boolean;
}

/** Desktop-only tools that require the user's physical desktop (GUI, clipboard, hardware). */
const VM_EXCLUDED_TOOLS = new Set([
  'send_hotkey',
  'capture_media',
  'describe_media_capture_capabilities',
]);

export function getHeadlessAgent(
  modelOrOpts: string | ModelChoice | HeadlessAgentOptions = 'fast',
  enabledIntegrations: string[] = [],
  mcpTools: Record<string, any> = {},
  allowedTools?: string[],
  customSystemPrompt?: string
): Agent {
  // Support both old positional API and new options object
  let vmMode = false;
  let model: string = 'fast';
  if (typeof modelOrOpts === 'object' && modelOrOpts !== null) {
    model = modelOrOpts.model || 'fast';
    enabledIntegrations = modelOrOpts.enabledIntegrations || [];
    mcpTools = modelOrOpts.mcpTools || {};
    allowedTools = modelOrOpts.allowedTools;
    customSystemPrompt = modelOrOpts.customSystemPrompt;
    vmMode = !!modelOrOpts.vmMode;
  } else {
    model = modelOrOpts;
  }
  const allTools = {
    wait: waitTool,
    run_sequential: runSequentialTool,
    run_parallel: runParallelTool,
    analyze_media: analyzeMediaTool,
    web_search,
    deploy_headless_agent: deployHeadlessAgent,
    get_headless_agent_status: getHeadlessAgentStatus,
    list_headless_agent_tasks: listHeadlessAgentTasks,

    // Integrations
    outlook_get_me,
    outlook_list_messages,
    outlook_search_messages,
    outlook_send_mail,
    outlook_get_message,
    outlook_list_recent_brief,
    outlook_list_folders,
    outlook_reply_message,
    outlook_forward_message,
    outlook_create_draft,
    outlook_mark_as_read,
    outlook_mark_as_unread,
    outlook_archive_message,
    outlook_move_message,
    outlook_delete_message,
    outlook_download_attachment,
    outlook_retrieve_messages_with_attachments,
    outlook_calendar_list_events,
    outlook_calendar_create_event,
    outlook_calendar_update_event,
    outlook_calendar_delete_event,
    google_get_userinfo,
    gmail_list_messages,
    gmail_get_message_brief,
    gmail_get_message_full,
    gmail_get_messages_brief,
    gmail_list_recent_brief,
    gmail_get_most_recent_full,
    calendar_list_events,
    calendar_create_event,
    calendar_delete_event,
    calendar_update_event,
    tasks_list,
    drive_list_files,
    sheets_read_range,
    sheets_create_spreadsheet,
    sheets_write_range,
    sheets_append_rows,
    sheets_clear_range,
    sheets_get_spreadsheet,
    sheets_add_sheet,
    sheets_format_cells,
    sheets_batch_update_values,
    sheets_delete_rows_columns,
    sheets_sort_range,
    sheets_auto_resize,
    docs_get_document,
    docs_create_document,
    docs_write_text,
    github_get_me,
    github_list_repos,
    github_list_issues,
    github_create_issue,
    facebook_get_me,
    facebook_list_pages,
    facebook_list_page_posts,
    facebook_create_page_post,
    facebook_list_post_comments,
    facebook_reply_comment,
    facebook_delete_post,
    facebook_list_conversations,
    facebook_get_conversation_messages,
    facebook_send_message,
    instagram_get_me,
    instagram_list_media,
    instagram_publish_media,
    instagram_list_comments,
    instagram_reply_comment,
    instagram_delete_comment,
    instagram_list_conversations,
    instagram_get_conversation_messages,
    instagram_send_dm,
    threads_get_me,
    threads_list_posts,
    threads_publish_post,
    threads_get_post,
    threads_list_replies,
    threads_reply_to_post,
    whatsapp_send_message,
    whatsapp_send_media,
    whatsapp_send_reaction,
    whatsapp_mark_read,
    whatsapp_upload_media,
    whatsapp_status,
    whatsapp_get_media_url,
    whatsapp_download_media,
    whatsapp_send_voice_note,
    whatsapp_transcribe_voice_note,
    whatsapp_send_template,
    whatsapp_voice_call,
    whatsapp_make_call,
    telnyx_send_sms,
    telnyx_call_control,
    telnyx_phone_status,
    telnyx_send_mms,
    telnyx_send_voice_note,
    telnyx_voice_call,
    telnyx_list_voice_providers,
    telnyx_list_active_calls,
    telnyx_hangup_call,

    // Local Device Tools
    send_hotkey,
    glob,
    grep,
    canvas_list,
    canvas_read,
    canvas_write,
    canvas_create,
    canvas_delete,
    capture_media,
    describe_media_capture_capabilities,
    run_system_command,
    run_command,
    browser_use_status,
    browser_use_configure,
    browser_use_execute_script,
    browser_use_navigate,
    browser_use_click,
    browser_use_type,
    browser_use_press_key,
    browser_use_screenshot,
    browser_use_content,
    browser_use_scroll,
    browser_use_tabs,
    browser_use_cookies,
    browser_use_hover,
    browser_use_select_option,
    browser_use_get_dropdown_options,
    browser_use_get_interactive_elements,
    browser_use_fill_form,
    browser_use_upload_file,
    browser_use_wait_for,
    // Memory
    search_past_conversations,
    get_conversation_context,
    calendar_crud,
    task_crud,
    task_reminders,
    planner_list_items,
    list_directory,
    read_file,
    write_file,
    create_directory,
    move_file,
    search_local_workflows,
    import_workflow,
    run_automation,
    stop_automation,
    // AI reasoning helpers (not agent_node to avoid infinite recursion)
    agent_decision,
    agent_extract,
  } as const;

  const tools: Record<string, any> = { ...mcpTools };

  // Always available tools
  let coreTools = [
    'wait', 'run_sequential', 'run_parallel', 'analyze_media', 'web_search',
    'deploy_headless_agent', 'get_headless_agent_status', 'list_headless_agent_tasks',
    'send_hotkey', 'glob', 'grep', 'canvas_list', 'canvas_read', 'canvas_write', 'canvas_create', 'canvas_delete', 'capture_media',
    'describe_media_capture_capabilities', 'run_system_command', 'run_command',
    'browser_use_status', 'browser_use_configure', 'browser_use_execute_script', 'browser_use_navigate', 'browser_use_click',
    'browser_use_type', 'browser_use_press_key', 'browser_use_screenshot', 'browser_use_content', 'browser_use_scroll',
    'browser_use_tabs', 'browser_use_cookies', 'browser_use_hover', 'browser_use_select_option',
    'browser_use_get_dropdown_options', 'browser_use_get_interactive_elements', 'browser_use_fill_form', 'browser_use_upload_file', 'browser_use_wait_for',
    'calendar_crud', 'task_crud', 'task_reminders', 'planner_list_items',
    'list_directory', 'read_file', 'write_file', 'create_directory', 'move_file',
    'search_local_workflows',
    'import_workflow', 'run_automation', 'stop_automation',
    'search_past_conversations', 'get_conversation_context',
    'agent_decision', 'agent_extract',
  ];

  // In VM mode, strip desktop-only tools that need physical hardware/display
  if (vmMode) {
    coreTools = coreTools.filter(name => !VM_EXCLUDED_TOOLS.has(name));
  }

  coreTools.forEach(name => {
    if ((allTools as any)[name]) {
      tools[name] = (allTools as any)[name];
    }
  });

  if (enabledIntegrations.includes('outlook')) {
    tools.outlook_get_me = outlook_get_me;
    tools.outlook_list_messages = outlook_list_messages;
    tools.outlook_search_messages = outlook_search_messages;
    tools.outlook_send_mail = outlook_send_mail;
    tools.outlook_get_message = outlook_get_message;
    tools.outlook_list_recent_brief = outlook_list_recent_brief;
    tools.outlook_list_folders = outlook_list_folders;
    tools.outlook_reply_message = outlook_reply_message;
    tools.outlook_forward_message = outlook_forward_message;
    tools.outlook_create_draft = outlook_create_draft;
    tools.outlook_mark_as_read = outlook_mark_as_read;
    tools.outlook_mark_as_unread = outlook_mark_as_unread;
    tools.outlook_archive_message = outlook_archive_message;
    tools.outlook_move_message = outlook_move_message;
    tools.outlook_delete_message = outlook_delete_message;
    tools.outlook_download_attachment = outlook_download_attachment;
    tools.outlook_retrieve_messages_with_attachments = outlook_retrieve_messages_with_attachments;
    tools.outlook_calendar_list_events = outlook_calendar_list_events;
    tools.outlook_calendar_create_event = outlook_calendar_create_event;
    tools.outlook_calendar_update_event = outlook_calendar_update_event;
    tools.outlook_calendar_delete_event = outlook_calendar_delete_event;
  }

  if (enabledIntegrations.includes('google')) {
    tools.google_get_userinfo = google_get_userinfo;
    tools.gmail_list_messages = gmail_list_messages;
    tools.gmail_get_message_brief = gmail_get_message_brief;
    tools.gmail_get_message_full = gmail_get_message_full;
    tools.gmail_get_messages_brief = gmail_get_messages_brief;
    tools.gmail_list_recent_brief = gmail_list_recent_brief;
    tools.gmail_get_most_recent_full = gmail_get_most_recent_full;
    tools.calendar_list_events = calendar_list_events;
    tools.calendar_create_event = calendar_create_event;
    tools.calendar_delete_event = calendar_delete_event;
    tools.tasks_list = tasks_list;
    tools.drive_list_files = drive_list_files;
    tools.sheets_read_range = sheets_read_range;
    tools.sheets_create_spreadsheet = sheets_create_spreadsheet;
    tools.sheets_write_range = sheets_write_range;
    tools.sheets_append_rows = sheets_append_rows;
    tools.sheets_clear_range = sheets_clear_range;
    tools.sheets_get_spreadsheet = sheets_get_spreadsheet;
    tools.sheets_add_sheet = sheets_add_sheet;
    tools.sheets_format_cells = sheets_format_cells;
    tools.sheets_batch_update_values = sheets_batch_update_values;
    tools.sheets_delete_rows_columns = sheets_delete_rows_columns;
    tools.sheets_sort_range = sheets_sort_range;
    tools.sheets_auto_resize = sheets_auto_resize;
    tools.docs_get_document = docs_get_document;
    tools.docs_create_document = docs_create_document;
    tools.docs_write_text = docs_write_text;
  }

  if (enabledIntegrations.includes('github')) {
    tools.github_get_me = github_get_me;
    tools.github_list_repos = github_list_repos;
    tools.github_list_issues = github_list_issues;
    tools.github_create_issue = github_create_issue;
  }

  if (enabledIntegrations.includes('facebook')) {
    tools.facebook_get_me = facebook_get_me;
    tools.facebook_list_pages = facebook_list_pages;
    tools.facebook_list_page_posts = facebook_list_page_posts;
    tools.facebook_create_page_post = facebook_create_page_post;
    tools.facebook_list_post_comments = facebook_list_post_comments;
    tools.facebook_reply_comment = facebook_reply_comment;
    tools.facebook_delete_post = facebook_delete_post;
    tools.facebook_list_conversations = facebook_list_conversations;
    tools.facebook_get_conversation_messages = facebook_get_conversation_messages;
    tools.facebook_send_message = facebook_send_message;
  }

  if (enabledIntegrations.includes('instagram')) {
    tools.instagram_get_me = instagram_get_me;
    tools.instagram_list_media = instagram_list_media;
    tools.instagram_publish_media = instagram_publish_media;
    tools.instagram_list_comments = instagram_list_comments;
    tools.instagram_reply_comment = instagram_reply_comment;
    tools.instagram_delete_comment = instagram_delete_comment;
    tools.instagram_list_conversations = instagram_list_conversations;
    tools.instagram_get_conversation_messages = instagram_get_conversation_messages;
    tools.instagram_send_dm = instagram_send_dm;
  }

  if (enabledIntegrations.includes('threads')) {
    tools.threads_get_me = threads_get_me;
    tools.threads_list_posts = threads_list_posts;
    tools.threads_publish_post = threads_publish_post;
    tools.threads_get_post = threads_get_post;
    tools.threads_list_replies = threads_list_replies;
    tools.threads_reply_to_post = threads_reply_to_post;
  }

  if (enabledIntegrations.includes('whatsapp')) {
    tools.whatsapp_send_message = whatsapp_send_message;
    tools.whatsapp_send_media = whatsapp_send_media;
    tools.whatsapp_send_reaction = whatsapp_send_reaction;
    tools.whatsapp_mark_read = whatsapp_mark_read;
    tools.whatsapp_upload_media = whatsapp_upload_media;
    tools.whatsapp_status = whatsapp_status;
    tools.whatsapp_get_media_url = whatsapp_get_media_url;
    tools.whatsapp_download_media = whatsapp_download_media;
    tools.whatsapp_send_voice_note = whatsapp_send_voice_note;
    tools.whatsapp_transcribe_voice_note = whatsapp_transcribe_voice_note;
    tools.whatsapp_send_template = whatsapp_send_template;
    tools.whatsapp_voice_call = whatsapp_voice_call;
    tools.whatsapp_make_call = whatsapp_make_call;
  }

  if (enabledIntegrations.includes('telnyx')) {
    tools.telnyx_send_sms = telnyx_send_sms;
    tools.telnyx_call_control = telnyx_call_control;
    tools.telnyx_phone_status = telnyx_phone_status;
    tools.telnyx_send_mms = telnyx_send_mms;
    tools.telnyx_send_voice_note = telnyx_send_voice_note;
    tools.telnyx_voice_call = telnyx_voice_call;
    tools.telnyx_list_voice_providers = telnyx_list_voice_providers;
    tools.telnyx_list_active_calls = telnyx_list_active_calls;
    tools.telnyx_hangup_call = telnyx_hangup_call;
  }

  // If specific tools are allowed, filter the final tools list
  if (allowedTools && allowedTools.length > 0) {
    const filteredTools: Record<string, any> = {};
    // Always allow basic flow/control tools if they exist
    const essentialTools = ['wait', 'run_sequential', 'run_parallel'];

    [...allowedTools, ...essentialTools].forEach(name => {
      if (tools[name]) {
        filteredTools[name] = tools[name];
      }
    });

    // Replace tools with filtered list
    Object.keys(tools).forEach(key => delete tools[key]);
    Object.assign(tools, filteredTools);
  }

  // Model selection — supports direct model IDs (e.g. "google/gemini-3.1-pro-preview")
  // and legacy tier names ("fast", "balanced", "smart")
  let selectedModel: any;
  const isDirectModelId = model.includes('/');
  if (isDirectModelId) {
    selectedModel = buildProviderModel(model);
  }
  if (!selectedModel) {
    // Resolve tier name to default model, or fallback for unknown values
    const tier = isDirectModelId ? 'balanced' : model;
    const defaultId = getDefaultModelForCategory(tier as any);
    selectedModel = buildProviderModel(defaultId);
  }
  if (!selectedModel) {
    // Ultimate fallback
    selectedModel = buildProviderModel('google/gemini-2.5-pro');
  }

  let systemContent = HEADLESS_SYSTEM_INSTRUCTIONS;
  if (vmMode) {
    systemContent += `\n\nVM ENVIRONMENT:
You are running on a headless cloud VM (Linux, Debian 12).
- Browser automation is available via Xvfb virtual display + Chromium. Use browser_use_* tools normally.
- Desktop-only tools (clipboard, hotkeys, screen capture from hardware) are NOT available.
- Use run_command / run_system_command for shell operations.
- File operations (read_file, write_file, glob, grep) operate on the VM filesystem.
`;
  }

  const instructions = [
    {
      role: 'system',
      content: systemContent,
    },
  ];

  if (typeof customSystemPrompt === 'string' && customSystemPrompt.trim()) {
    instructions.push({
      role: 'system',
      content: `Additional system instructions:\n${customSystemPrompt.trim()}`,
    } as any);
  }

  return new Agent({
    id: 'stuard-headless',
    name: 'stuard-headless',
    instructions: instructions as any,
    model: selectedModel,
    tools,
  });
}


