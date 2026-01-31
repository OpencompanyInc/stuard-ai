export type ToolKind = 'local' | 'cloud' | 'orchestration' | 'electron';

export const TOOL_REGISTRY: Record<string, { kind: ToolKind; handler?: string }> = {
  // Electron-native tools (handled in main process)
  'custom_ui': { kind: 'electron' },
  'update_custom_ui': { kind: 'electron' },
  'close_custom_ui': { kind: 'electron' },
  'send_ui_event': { kind: 'electron' },     // Send event to custom UI window
  'run_ui_script': { kind: 'electron' },     // Run JavaScript in custom UI window
  'list_custom_ui_windows': { kind: 'electron' },  // List open custom UI windows
  'stop_workflow': { kind: 'electron' },  // Stop a running workflow
  'log': { kind: 'electron' },
  'wait': { kind: 'electron' },
  'end': { kind: 'electron' },  // Workflow terminator
  'return_value': { kind: 'electron' },  // Workflow return value (terminates run with result)
  'invoke_workflow': { kind: 'electron' },  // Invoke workflow with args
  'call_workflow': { kind: 'electron' },  // Call external workflow as function (waits for result)
  'call_function': { kind: 'electron' },  // Call function trigger within same workflow
  'test_run_steps': { kind: 'electron' },  // Test run workflow steps
  'list_local_workflows': { kind: 'electron' },  // List saved workflows
  'list_local_stuards': { kind: 'electron' },  // List saved stuards
  'play_audio': { kind: 'electron' },
  'get_clipboard_content': { kind: 'electron' },
  'set_clipboard_content': { kind: 'electron' },

  'list_open_windows': { kind: 'electron' },
  'bring_window_to_foreground': { kind: 'electron' },
  'get_window_info': { kind: 'electron' },
  'smart_bring_window_to_foreground': { kind: 'electron' },
  'set_window_bounds': { kind: 'electron' },

  // Browser control tools
  'browser_get_content': { kind: 'electron' },
  'browser_click_element': { kind: 'electron' },
  'browser_type_text': { kind: 'electron' },
  'browser_find_text': { kind: 'electron' },
  'browser_get_element_position': { kind: 'electron' },
  'browser_find_clickable': { kind: 'electron' },
  'browser_hover': { kind: 'electron' },
  'browser_select_option': { kind: 'electron' },
  'browser_press_key': { kind: 'electron' },
  'browser_get_form_fields': { kind: 'electron' },
  'browser_fill_form': { kind: 'electron' },
  'browser_wait_for_element': { kind: 'electron' },
  'browser_scroll_to': { kind: 'electron' },
  'browser_get_page_info': { kind: 'electron' },
  'browser_execute_script': { kind: 'electron' },

  // Variable management tools (electron-native)
  'set_variable': { kind: 'electron' },
  'get_variable': { kind: 'electron' },
  'toggle_variable': { kind: 'electron' },
  'increment_variable': { kind: 'electron' },
  'append_to_list': { kind: 'electron' },
  'list_variables': { kind: 'electron' },
  'delete_variable': { kind: 'electron' },

  // Canvas document tools (sidebar canvas)
  'canvas_list': { kind: 'electron' },
  'canvas_read': { kind: 'electron' },
  'canvas_write': { kind: 'electron' },
  'canvas_create': { kind: 'electron' },
  'canvas_delete': { kind: 'electron' },
  // Backward compatibility aliases
  'sidebar_canvas_list': { kind: 'electron' },
  'sidebar_canvas_read': { kind: 'electron' },
  'sidebar_canvas_write': { kind: 'electron' },
  'sidebar_canvas_create': { kind: 'electron' },
  'sidebar_canvas_delete': { kind: 'electron' },

  // Terminal tools (PTY-based, electron-native)
  'terminal_create': { kind: 'electron' },
  'terminal_list': { kind: 'electron' },
  'terminal_get': { kind: 'electron' },
  'terminal_send_input': { kind: 'electron' },  // AI writes to live PTY
  'terminal_send_raw': { kind: 'electron' },    // AI writes raw bytes (no newline)
  'terminal_send_keys': { kind: 'electron' },   // Convenience mapping (ctrl+c, enter, arrows, etc.)
  'terminal_read': { kind: 'electron' },        // Incremental read via seq cursor
  'terminal_wait_for': { kind: 'electron' },    // Wait until output contains a substring
  'terminal_destroy': { kind: 'electron' },

  // Orchestration tools (handled inline by engine)
  'run_sequential': { kind: 'orchestration' },
  'run_parallel': { kind: 'orchestration' },
  'loop_executor': { kind: 'orchestration' },

  // Cloud AI tools
  'analyze_media': { kind: 'cloud', handler: '/inference/ai/analyze-media' },
  'ai_inference': { kind: 'cloud', handler: '/inference/ai/text' },
  'analyze_image': { kind: 'cloud', handler: '/inference/ai/analyze-image' },
  'analyze_current_screen': { kind: 'cloud', handler: '/inference/ai/vision-structured' },
  'web_search': { kind: 'cloud', handler: '/tools/web_search' },
  'scrape_url': { kind: 'cloud', handler: '/tools/scrape_url' },
  'text_to_speech': { kind: 'cloud', handler: '/tools/text_to_speech' },
  'list_tts_voices': { kind: 'cloud', handler: '/tools/list_tts_voices' },
  'youtube_get_video': { kind: 'cloud' },
  'youtube_get_channel': { kind: 'cloud' },
  'youtube_get_playlist': { kind: 'cloud' },
  'youtube_search': { kind: 'cloud' },
  'search_marketplace': { kind: 'cloud' },
  'get_marketplace_workflow': { kind: 'cloud' },
  'import_from_marketplace': { kind: 'cloud' },
  'list_popular_workflows': { kind: 'cloud' },
  'list_marketplace_categories': { kind: 'cloud' },

  // Google integrations
  'google_get_userinfo': { kind: 'cloud' },
  'gmail_send': { kind: 'cloud' }, // Alias for gmail_send_message
  'gmail_send_message': { kind: 'cloud' },
  'gmail_list_messages': { kind: 'cloud' },
  'gmail_get_message_brief': { kind: 'cloud' },
  'gmail_get_message_full': { kind: 'cloud' },
  'gmail_get_messages_brief': { kind: 'cloud' },
  'gmail_list_recent_brief': { kind: 'cloud' },
  'gmail_get_most_recent_full': { kind: 'cloud' },
  'gmail_modify_message': { kind: 'cloud' },
  'gmail_delete_message': { kind: 'cloud' },
  'gmail_archive_message': { kind: 'cloud' },
  'gmail_mark_as_read': { kind: 'cloud' },
  'gmail_mark_as_unread': { kind: 'cloud' },
  'calendar_list_events': { kind: 'cloud' },
  'calendar_create_event': { kind: 'cloud' },
  'tasks_list': { kind: 'cloud' },
  'drive_list_files': { kind: 'cloud' },
  'sheets_read_range': { kind: 'cloud' },
  'docs_get_document': { kind: 'cloud' },
  'docs_create_document': { kind: 'cloud' },
  'docs_write_text': { kind: 'cloud' },

  // Outlook integrations
  'outlook_get_me': { kind: 'cloud' },
  'outlook_send_mail': { kind: 'cloud' },
  'outlook_list_messages': { kind: 'cloud' },
  'outlook_search_messages': { kind: 'cloud' },

  // GitHub integrations
  'github_get_me': { kind: 'cloud' },
  'github_list_repos': { kind: 'cloud' },
  'github_list_issues': { kind: 'cloud' },
  'github_create_issue': { kind: 'cloud' },

  // Everything else goes to local Python agent
  // (default if not in registry)
};

/**
 * Get the routing kind for a tool
 */
export function getToolKind(toolName: string): ToolKind {
  const entry = TOOL_REGISTRY[toolName];
  if (entry) return entry.kind;
  // Default: route to local Python agent
  return 'local';
}
