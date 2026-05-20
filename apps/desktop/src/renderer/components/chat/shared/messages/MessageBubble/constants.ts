// GenUI tools that render interactive UI components
export const GENUI_TOOL_NAMES = new Set([
  // Decision & Input (blocking - wait for user response)
  'ask_confirmation',
  'show_choices',
  'request_files',
  'show_files',
  'show_form',
  // Inline custom React UI (blocking or non-blocking based on args)
  'chat_ui',
]);

// Tools that should be hidden from the chat UI (internal/silent tools)
export const HIDDEN_TOOL_NAMES = new Set([
  // Segment tools (internal for conversation management)
  'segment_create',
  'segment_update',
  'segment_end',
  'segment_list',
  'segment_list_recent',
  'segment_search',
  'segment_get',
  'segment_build_topic_drawers',
  'segment_search_drawers_by_embedding',
  // Collection tools (internal background processing)
  'collection_summary_upsert',
  'collection_summary_list',
  'collection_summary_get',
  // Memory tools (internal)
  'memory_store',
  'memory_recall',
  'memory_update',
  'memory_search',
  'memory_stats',
  'conversation_create',
  'conversation_get',
  'conversation_list',
  'conversation_update',
  'conversation_delete',
  'conversation_search',
  'conversation_get_spaces',
  'message_add',
  'message_list',
  // Project-mode bookkeeping is represented by the active project UI, not
  // repeated tool pills in the chat trace.
  'list_projects',
  'enter_project_mode',
  'exit_project_mode',
  'project_create',
  'project_get',
  'project_list',
  'project_update',
  'project_delete',
  'conversation_set_project',
  'journal_add',
  'journal_list',
  'journal_delete',
  'memory_add',
  'memory_create',
  'memory_list',
  'memory_search',
  'project_search',
  // Agent internal tools
  'agent_todo',
  // Knowledge tools (internal)
  'knowledge_add_fact',
  'knowledge_update_fact',
  'knowledge_build_context',
  'knowledge_get_directives',
  'knowledge_get_identity',
  // Planner internal tools
  'planner_list_items',
  // Internal subagent management tools — spawn-style ones are surfaced as
  // delegation rectangles instead (see DELEGATION_TOOL_NAMES below).
  'subagent_update',
  'subagent_status',
  'subagent_list',
  'subagent_stop',
  // Internal meta-tools (invisible to user)
  'get_tool_schema',
  'search_tools',
  // Orchestrator reply tool (invisible to user)
  'reply_to_subagent',
  // ask_user renders inline prompt, not a tool pill
  'ask_user',
  // Low-level binary I/O helpers — only ever called transitively from
  // analyze_media / OCR / cloud-storage tools; the base64 payload is huge and
  // useless to display in the trace.
  'read_file_binary',
  'read_file_base64',
  'upload_file_to_url',
  // GenUI display tools (rendered as UI, don't need pill)
  ...GENUI_TOOL_NAMES,
]);

// Map genui:* component names to GenUIContainer tool names
export const GENUI_COMPONENT_MAP: Record<string, string> = {
  'confirm': 'ask_confirmation',
  'confirmation': 'ask_confirmation',
  'choices': 'show_choices',
  'choice': 'show_choices',
  'files': 'request_files',
  'dropzone': 'request_files',
  'tree': 'show_files',
  'filetree': 'show_files',
  'form': 'show_form',
  'wizard': 'show_form',
  'survey': 'show_form',
  'form_wizard': 'show_form',
};
