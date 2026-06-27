/**
 * Tool Shortcuts - Human-friendly aliases for common tools
 * 
 * Usage in builder:
 *   .step("screenshot")     → take_screenshot
 *   .step("click", {x, y})  → click_at_coordinates
 *   .step("wait", {ms: 1000}) → wait with args
 */

export interface ToolShortcut {
  tool: string;
  args?: Record<string, any>;
}

/**
 * Map of shortcut names to full tool definitions
 */
export const TOOL_SHORTCUTS: Record<string, ToolShortcut> = {
  // =========================================================================
  // Screen & Visual
  // =========================================================================
  'screenshot': { tool: 'take_screenshot', args: {} },
  'capture': { tool: 'take_screenshot', args: {} },
  'screen': { tool: 'take_screenshot', args: {} },
  'photo': { tool: 'capture_media', args: { kind: 'photo' } },
  'video': { tool: 'capture_media', args: { kind: 'video' } },
  'audio': { tool: 'capture_media', args: { kind: 'audio' } },
  'record': { tool: 'capture_media', args: { kind: 'video' } },
  
  // =========================================================================
  // AI & Analysis
  // =========================================================================
  'analyze': { tool: 'analyze_current_screen', args: {} },
  'analyze_screen': { tool: 'analyze_current_screen', args: {} },
  'vision': { tool: 'cloud_ai_vision', args: {} },
  'ai_vision': { tool: 'cloud_ai_vision', args: {} },
  
  // =========================================================================
  // Mouse Actions
  // =========================================================================
  'click': { tool: 'click_at_coordinates', args: { button: 'left' } },
  'left_click': { tool: 'click_at_coordinates', args: { button: 'left' } },
  'right_click': { tool: 'click_at_coordinates', args: { button: 'right' } },
  'double_click': { tool: 'double_click_at_coordinates', args: { button: 'left' } },
  'dblclick': { tool: 'double_click_at_coordinates', args: { button: 'left' } },
  'scroll_up': { tool: 'scroll', args: { deltaY: -120 } },
  'scroll_down': { tool: 'scroll', args: { deltaY: 120 } },
  'drag': { tool: 'drag_and_drop', args: {} },
  
  // =========================================================================
  // Keyboard Actions
  // =========================================================================
  'type': { tool: 'type_text', args: {} },
  'hotkey': { tool: 'send_hotkey', args: {} },
  'key': { tool: 'send_hotkey', args: {} },
  'press': { tool: 'send_hotkey', args: {} },
  
  // Common hotkey shortcuts
  'copy': { tool: 'send_hotkey', args: { keys: ['Control', 'c'] } },
  'paste': { tool: 'send_hotkey', args: { keys: ['Control', 'v'] } },
  'cut': { tool: 'send_hotkey', args: { keys: ['Control', 'x'] } },
  'undo': { tool: 'send_hotkey', args: { keys: ['Control', 'z'] } },
  'redo': { tool: 'send_hotkey', args: { keys: ['Control', 'y'] } },
  'save': { tool: 'send_hotkey', args: { keys: ['Control', 's'] } },
  'select_all': { tool: 'send_hotkey', args: { keys: ['Control', 'a'] } },
  'find': { tool: 'send_hotkey', args: { keys: ['Control', 'f'] } },
  'new': { tool: 'send_hotkey', args: { keys: ['Control', 'n'] } },
  'close': { tool: 'send_hotkey', args: { keys: ['Alt', 'F4'] } },
  'tab': { tool: 'send_hotkey', args: { keys: ['Tab'] } },
  'enter': { tool: 'send_hotkey', args: { keys: ['Return'] } },
  'escape': { tool: 'send_hotkey', args: { keys: ['Escape'] } },
  'esc': { tool: 'send_hotkey', args: { keys: ['Escape'] } },
  'alt_tab': { tool: 'send_hotkey', args: { keys: ['Alt', 'Tab'] } },
  'win_d': { tool: 'send_hotkey', args: { keys: ['Super_L', 'd'] } },
  'show_desktop': { tool: 'send_hotkey', args: { keys: ['Super_L', 'd'] } },
  
  // =========================================================================
  // Window Management
  // =========================================================================
  'list_windows': { tool: 'list_open_windows', args: {} },
  'windows': { tool: 'list_open_windows', args: {} },
  'focus': { tool: 'bring_window_to_foreground', args: {} },
  'focus_window': { tool: 'bring_window_to_foreground', args: {} },
  'smart_focus': { tool: 'smart_bring_window_to_foreground', args: {} },
  
  // =========================================================================
  // File System
  // =========================================================================
  'read': { tool: 'read_file', args: {} },
  'read_file': { tool: 'read_file', args: {} },
  'write': { tool: 'write_file', args: {} },
  'write_file': { tool: 'write_file', args: {} },
  'append': { tool: 'write_file', args: { append: true } },
  'mkdir': { tool: 'create_directory', args: {} },
  'create_dir': { tool: 'create_directory', args: {} },
  'ls': { tool: 'list_directory', args: {} },
  'list': { tool: 'list_directory', args: {} },
  'dir': { tool: 'list_directory', args: {} },
  'move': { tool: 'move_file', args: {} },
  'mv': { tool: 'move_file', args: {} },
  'rename': { tool: 'move_file', args: {} },
  'copy_file': { tool: 'copy_file', args: {} },
  'cp': { tool: 'copy_file', args: {} },
  'delete': { tool: 'delete_file', args: {} },
  'rm': { tool: 'delete_file', args: {} },
  
  // =========================================================================
  // Clipboard
  // =========================================================================
  'get_clipboard': { tool: 'get_clipboard_content', args: {} },
  'clipboard': { tool: 'get_clipboard_content', args: {} },
  'set_clipboard': { tool: 'set_clipboard_content', args: {} },
  
  // =========================================================================
  // System & Commands
  // =========================================================================
  'run': { tool: 'run_command', args: { shell: 'auto' } },
  'cmd': { tool: 'run_command', args: { shell: 'cmd' } },
  'powershell': { tool: 'run_command', args: { shell: 'powershell' } },
  'bash': { tool: 'run_command', args: { shell: 'bash' } },
  'shell': { tool: 'run_command', args: { shell: 'auto' } },
  'exec': { tool: 'run_command', args: { shell: 'auto' } },
  'launch': { tool: 'launch_application_or_uri', args: {} },
  'open': { tool: 'launch_application_or_uri', args: {} },
  'start': { tool: 'launch_application_or_uri', args: {} },
  
  // =========================================================================
  // Python & Node
  // =========================================================================
  'python': { tool: 'run_python_script', args: {} },
  'py': { tool: 'run_python_script', args: {} },
  'node': { tool: 'run_node_script', args: {} },
  'js': { tool: 'run_node_script', args: {} },
  'pip_install': { tool: 'python_install', args: {} },
  
  // =========================================================================
  // Control Flow & Timing
  // =========================================================================
  'wait': { tool: 'wait', args: {} },
  'delay': { tool: 'wait', args: {} },
  'sleep': { tool: 'wait', args: {} },
  'pause': { tool: 'wait', args: {} },
  'log': { tool: 'log', args: {} },
  'print': { tool: 'log', args: {} },
  'notify': { tool: 'send_notification', args: {} },
  'notification': { tool: 'send_notification', args: {} },
  
  // =========================================================================
  // Orchestration
  // =========================================================================
  'sequential': { tool: 'run_sequential', args: {} },
  'sequence': { tool: 'run_sequential', args: {} },
  'parallel': { tool: 'run_parallel', args: {} },
  'concurrent': { tool: 'run_parallel', args: {} },
  'loop': { tool: 'loop_executor', args: {} },
  'transform': { tool: 'transform_data', args: {} },
  
  // =========================================================================
  // Memory
  // =========================================================================
  'memory': { tool: 'memory_retrieval', args: {} },
  'remember': { tool: 'memory_retrieval', args: { action: 'store' } },
  'recall': { tool: 'memory_retrieval', args: { action: 'search' } },
  'search_memory': { tool: 'memory_retrieval', args: { action: 'search' } },
  
  // =========================================================================
  // Integrations
  // =========================================================================
  'gmail': { tool: 'gmail_send', args: {} },
  'email': { tool: 'gmail_send', args: {} },
  'calendar': { tool: 'google_calendar_list_events', args: {} },
  'drive': { tool: 'google_drive_list_files', args: {} },
  'sheets': { tool: 'google_sheets_read', args: {} },
  'docs': { tool: 'google_docs_read', args: {} },
  'outlook': { tool: 'outlook_send', args: {} },
};

/**
 * Reverse lookup: get shortcut name from tool name
 */
export function getShortcutForTool(tool: string): string | null {
  for (const [shortcut, def] of Object.entries(TOOL_SHORTCUTS)) {
    if (def.tool === tool) return shortcut;
  }
  return null;
}

/**
 * Get all shortcuts for a given tool
 */
export function getShortcutsForTool(tool: string): string[] {
  return Object.entries(TOOL_SHORTCUTS)
    .filter(([_, def]) => def.tool === tool)
    .map(([shortcut]) => shortcut);
}

/**
 * Check if a string is a valid shortcut
 */
export function isShortcut(name: string): boolean {
  return name in TOOL_SHORTCUTS;
}

/**
 * Resolve a tool name (shortcut or full name) to full tool definition
 */
export function resolveTool(name: string): ToolShortcut {
  return TOOL_SHORTCUTS[name] || { tool: name, args: {} };
}

// ============================================================================
// Step Factory Functions (for programmatic use)
// ============================================================================

export const tools = {
  screenshot: () => ({ tool: 'take_screenshot', args: {} }),
  click: (x: number, y: number, button: 'left' | 'right' = 'left') => 
    ({ tool: 'click_at_coordinates', args: { x, y, button } }),
  doubleClick: (x: number, y: number) => 
    ({ tool: 'double_click_at_coordinates', args: { x, y, button: 'left' } }),
  type: (text: string) => 
    ({ tool: 'type_text', args: { text } }),
  hotkey: (...keys: string[]) => 
    ({ tool: 'send_hotkey', args: { keys } }),
  wait: (ms: number) => 
    ({ tool: 'wait', args: { ms } }),
  log: (message: string) => 
    ({ tool: 'log', args: { message } }),
  focus: (title: string) => 
    ({ tool: 'bring_window_to_foreground', args: { title } }),
  run: (command: string, shell: 'auto' | 'cmd' | 'powershell' | 'bash' = 'auto') => 
    ({ tool: 'run_command', args: { command, shell } }),
  python: (code: string, envId?: string) => 
    ({ tool: 'run_python_script', args: { code, envId } }),
  node: (code: string) => 
    ({ tool: 'run_node_script', args: { code } }),
  read: (path: string) => 
    ({ tool: 'read_file', args: { path } }),
  write: (path: string, content: string, append = false) => 
    ({ tool: 'write_file', args: { path, content, append } }),
  analyze: (prompt: string) => 
    ({ tool: 'analyze_current_screen', args: { prompt } }),
  vision: (prompt: string, imagePath: string, schema?: any) => 
    ({ tool: 'cloud_ai_vision', args: { prompt, imagePath, schema } }),
  notify: (title: string, message: string) => 
    ({ tool: 'send_notification', args: { title, message } }),
  launch: (target: string) => 
    ({ tool: 'launch_application_or_uri', args: { target } }),
};
