/**
 * Dynamic Tool Schema System
 *
 * Automatically generates schemas from tool definitions.
 * All tools get proper argument and output suggestions dynamically.
 *
 * NOTE: This file embeds the tool definitions directly.
 * When adding new tools to cloud-ai/src/tools/definitions.ts,
 * run: pnpm sync-tool-defs (or manually update TOOL_DEFINITIONS below)
 */

export type ArgType = 'string' | 'number' | 'boolean' | 'select' | 'multiselect' | 'array' | 'object' | 'code' | 'path' | 'hotkey' | 'accelerator' | 'json' | 'cron' | 'files' | 'memory';

export interface ArgOption {
  value: string | number | boolean;
  label: string;
  description?: string;
  group?: string;
}

export interface ArgSchema {
  type: ArgType;
  label: string;
  description?: string;
  required?: boolean;
  default?: any;
  options?: ArgOption[];
  placeholder?: string;
  itemType?: ArgType;
  itemOptions?: ArgOption[];
  language?: 'python' | 'javascript' | 'shell' | 'json';
  suggestFrom?: string[];
  advanced?: boolean;
  hidden?: boolean;
  /** Allow free text input alongside select options — user can pick a preset or type a custom value */
  allowFreeform?: boolean;
  /** Conditional visibility: only show this arg when another arg has a specific value */
  showWhen?: { field: string; value?: any; values?: any[] };
}

export interface ToolSchema {
  name: string;
  label: string;
  description?: string;
  category?: string;
  args: Record<string, ArgSchema>;
  outputs: string[];
}

// ============================================================================
// TOOL DEFINITIONS (synced from cloud-ai/src/tools/definitions.ts)
// ============================================================================

type ToolCategory = 'core' | 'system' | 'input' | 'ui' | 'vision' | 'data' | 'integrations' | 'flow' | 'utils' | 'ollama' | 'cloud_storage';

interface ToolDefinition {
  id: string;
  category: ToolCategory;
  kind: 'local' | 'cloud' | 'orchestration';
  description: string;
  argsTemplate: any;
  outputSchema: any;
  deprecated?: boolean;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // --- CORE / FLOW ---
  { id: 'wait', category: 'flow', kind: 'local', description: 'Delay execution for a number of milliseconds', argsTemplate: { ms: 1000 }, outputSchema: { ok: 'boolean', waitedMs: 'number' } },
  { id: 'run_sequential', category: 'flow', kind: 'orchestration', description: 'Run a list of tools in sequence', argsTemplate: { steps: [], continueOnError: false }, outputSchema: { results: 'any[]', combined: 'object', allOk: 'boolean' } },
  { id: 'run_parallel', category: 'flow', kind: 'orchestration', description: 'Run a list of tools in parallel', argsTemplate: { steps: [], concurrency: 2 }, outputSchema: { results: 'any[]', combined: 'object', allOk: 'boolean' } },
  // DEPRECATED: loop_executor is deprecated - use wire loop configuration instead (wire.loop property)
  // Kept for backwards compatibility with existing workflows
  { id: 'loop_executor', category: 'flow', kind: 'orchestration', description: '[DEPRECATED] Use wire loops instead. Execute a tool repeatedly', argsTemplate: { mode: 'each', items: ['a', 'b'], item_var: 'item', count: 3 }, outputSchema: { results: 'any[]' }, deprecated: true },
  { id: 'end', category: 'flow', kind: 'local', description: 'Terminate the workflow gracefully', argsTemplate: {}, outputSchema: { ok: 'boolean', terminated: 'boolean' } },
  { id: 'return_value', category: 'flow', kind: 'local', description: 'Return a value and terminate - use for workflow functions', argsTemplate: { value: '{{}}', success: true, message: '' }, outputSchema: { ok: 'boolean', terminated: 'boolean', value: 'any', success: 'boolean', message: 'string' } },
  { id: 'call_workflow', category: 'flow', kind: 'local', description: 'Call another workflow project as a function with input parameters', argsTemplate: { workflowId: '', inputs: {} }, outputSchema: { ok: 'boolean', result: 'any', error: 'string' } },
  { id: 'call_function', category: 'flow', kind: 'local', description: 'Call a function trigger within the same workflow by trigger ID', argsTemplate: { triggerId: '', inputs: {} }, outputSchema: { ok: 'boolean', result: 'any', error: 'string' } },
  { id: 'call_workspace_function', category: 'flow', kind: 'local', description: 'Call a .stuard sub-workflow from the workspace (e.g. helpers/send-email.stuard)', argsTemplate: { path: '', inputs: {} }, outputSchema: { ok: 'boolean', functionPath: 'string', result: 'any', error: 'string' } },
  { id: 'list_workspace_functions', category: 'flow', kind: 'local', description: 'List all callable .stuard sub-workflows in the workspace', argsTemplate: {}, outputSchema: { ok: 'boolean', functions: 'array' } },

  // --- WORKSPACE FILE MANAGEMENT ---
  { id: 'workspace_read_file', category: 'data', kind: 'local', description: 'Read a file from the workflow workspace directory. Path is relative to workspace root (e.g. "data/config.json").', argsTemplate: { path: 'data/config.json' }, outputSchema: { ok: 'boolean', content: 'string', size: 'number', updatedAt: 'string', error: 'string' } },
  { id: 'workspace_write_file', category: 'data', kind: 'local', description: 'Write/create a file in the workflow workspace directory. Creates parent directories automatically and asks for approval in workflow chat.', argsTemplate: { path: 'data/config.json', content: '{}', description: 'Save config.json in the workflow workspace.' }, outputSchema: { ok: 'boolean', error: 'string' } },
  { id: 'workspace_delete_file', category: 'data', kind: 'local', description: 'Delete a file from the workflow workspace directory.', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', error: 'string' } },
  { id: 'workspace_list_files', category: 'data', kind: 'local', description: 'List files and folders in the workflow workspace (or a subpath).', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', files: 'array', error: 'string' } },
  { id: 'workspace_create_folder', category: 'data', kind: 'local', description: 'Create a subdirectory in the workflow workspace.', argsTemplate: { path: 'data/exports' }, outputSchema: { ok: 'boolean', error: 'string' } },
  { id: 'workspace_get_info', category: 'data', kind: 'local', description: 'Get workspace info: absolute path, subdirectories, and all files.', argsTemplate: {}, outputSchema: { ok: 'boolean', workspacePath: 'string', subdirs: 'string[]', files: 'array', error: 'string' } },
  { id: 'log', category: 'flow', kind: 'local', description: 'Log a message to the workflow execution log', argsTemplate: { message: 'Step completed' }, outputSchema: { ok: 'boolean', logged: 'string' } },
  { id: 'send_notification', category: 'flow', kind: 'local', description: 'Show a rich local desktop notification with optional image and reply input', argsTemplate: { title: 'Stuard AI', body: 'Hello!', severity: 'info', imagePath: '', durationMs: 5000, showInput: false, waitForInput: false, inputPlaceholder: 'Reply…', inputDefaultValue: '', inputSubmitText: 'Send', inputCancelText: 'Cancel', inputType: 'text', keepAfterSubmit: false, progress: 0, taskId: '', workflowRunId: '', timeoutMs: 300000 }, outputSchema: { ok: 'boolean', notification: 'object', value: 'string', response: 'object', submitted: 'boolean', cancelled: 'boolean', dismissed: 'boolean', error: 'string' } },

  // --- SYSTEM ---
  { id: 'run_command', category: 'system', kind: 'local', description: 'Run shell commands cross-platform with timeout. Use shell="default" for the platform default shell.', argsTemplate: { command: 'echo hello', isPermissionRequired: false, description: '', shell: 'auto', timeoutMs: 30000, cwd: '', checkpoint: false, background: false, terminalId: '' }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', terminalId: 'string', pid: 'number', status: 'string', shell: 'string' } },
  { id: 'list_terminals', category: 'system', kind: 'local', description: 'List active and recent terminal sessions', argsTemplate: {}, outputSchema: { ok: 'boolean', terminals: 'any[]' } },
  { id: 'read_terminal', category: 'system', kind: 'local', description: 'Read incremental terminal output for a terminalId', argsTemplate: { terminalId: '', sinceSeq: 0, maxChars: 8000 }, outputSchema: { ok: 'boolean', terminalId: 'string', chunks: 'any[]', done: 'boolean', exitCode: 'number', seq: 'number' } },
  { id: 'run_python_script', category: 'system', kind: 'local', description: 'Run Python code inline or from a workspace file. Use filePath to run a .py file from your workspace (e.g. {{$workspace.scripts}}/process.py), or code for inline. filePath takes priority over code.', argsTemplate: { filePath: '', code: "print('hello')", packages: [], envId: 'default', timeoutMs: 30000, checkpoint: false }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', installed: 'string[]' } },
  { id: 'run_node_script', category: 'system', kind: 'local', description: 'Run Node.js code inline or from a workspace file. Use filePath to run a .js file from your workspace (e.g. {{$workspace.scripts}}/app.js), or code for inline. filePath takes priority over code.', argsTemplate: { filePath: '', code: "console.log('hello')", timeoutMs: 30000, checkpoint: false }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number' } },

  // --- UTILITIES (no scripts needed) ---
  { id: 'get_datetime', category: 'utils', kind: 'local', description: 'Get current date and time with formatting', argsTemplate: { format: '', tzOffset: 0 }, outputSchema: { ok: 'boolean', iso: 'string', unix: 'number', date: 'string', time: 'string', time12: 'string', weekday: 'string', year: 'number', month: 'number', day: 'number', hour: 'number', minute: 'number', second: 'number', formatted: 'string' } },
  { id: 'math_eval', category: 'utils', kind: 'local', description: 'Evaluate a safe math expression (sqrt, pow, sin, cos, log, pi, e, etc.)', argsTemplate: { expression: '' }, outputSchema: { ok: 'boolean', result: 'number', expression: 'string', type: 'string' } },
  { id: 'generate_uuid', category: 'utils', kind: 'local', description: 'Generate UUID(s)', argsTemplate: { version: 4, count: 1 }, outputSchema: { ok: 'boolean', uuid: 'string', uuids: 'string[]', count: 'number' } },
  { id: 'random_number', category: 'utils', kind: 'local', description: 'Generate random number(s)', argsTemplate: { min: 0, max: 100, count: 1, float: false, decimals: 2 }, outputSchema: { ok: 'boolean', value: 'number', values: 'number[]' } },
  { id: 'random_choice', category: 'utils', kind: 'local', description: 'Pick random item(s) from a list', argsTemplate: { items: [], count: 1, allowDuplicates: false }, outputSchema: { ok: 'boolean', choice: 'any', choices: 'any[]' } },
  { id: 'sleep', category: 'utils', kind: 'local', description: 'Sleep/wait for a duration (max 5 min)', argsTemplate: { ms: 0, seconds: 0 }, outputSchema: { ok: 'boolean', sleptMs: 'number' } },
  { id: 'get_system_info', category: 'utils', kind: 'local', description: 'Get basic system info (OS, hostname, username, paths)', argsTemplate: {}, outputSchema: { ok: 'boolean', os: 'string', osVersion: 'string', machine: 'string', hostname: 'string', username: 'string', home: 'string', cwd: 'string' } },
  { id: 'get_env_var', category: 'utils', kind: 'local', description: 'Get environment variable value', argsTemplate: { name: '', default: '' }, outputSchema: { ok: 'boolean', name: 'string', value: 'string', exists: 'boolean' } },
  { id: 'hash_string', category: 'utils', kind: 'local', description: 'Hash a string (md5, sha1, sha256, sha512)', argsTemplate: { text: '', algorithm: 'sha256' }, outputSchema: { ok: 'boolean', hash: 'string', algorithm: 'string' } },
  { id: 'base64_encode', category: 'utils', kind: 'local', description: 'Encode text to base64', argsTemplate: { text: '', urlSafe: false }, outputSchema: { ok: 'boolean', encoded: 'string' } },
  { id: 'base64_decode', category: 'utils', kind: 'local', description: 'Decode base64 to text', argsTemplate: { encoded: '', urlSafe: false }, outputSchema: { ok: 'boolean', decoded: 'string' } },
  { id: 'json_parse', category: 'utils', kind: 'local', description: 'Parse a JSON string into an object', argsTemplate: { text: '' }, outputSchema: { ok: 'boolean', data: 'any', type: 'string' } },
  { id: 'json_stringify', category: 'utils', kind: 'local', description: 'Convert data to JSON string', argsTemplate: { data: {}, pretty: false }, outputSchema: { ok: 'boolean', json: 'string' } },
  { id: 'regex_match', category: 'utils', kind: 'local', description: 'Match regex pattern and get all matches with groups', argsTemplate: { text: '', pattern: '', flags: '' }, outputSchema: { ok: 'boolean', matches: 'any[]', count: 'number', hasMatch: 'boolean' } },
  { id: 'regex_replace', category: 'utils', kind: 'local', description: 'Replace text using regex', argsTemplate: { text: '', pattern: '', replacement: '', flags: '', count: 0 }, outputSchema: { ok: 'boolean', result: 'string', changed: 'boolean' } },

  { id: 'launch_application_or_uri', category: 'system', kind: 'local', description: 'Launch desktop applications or open URLs', argsTemplate: { target: 'https://example.com', args: [] }, outputSchema: { ok: 'boolean' } },
  { id: 'read_file', category: 'system', kind: 'local', description: 'Read file contents. Supports plain text plus extractable PDF and spreadsheet files.', argsTemplate: { path: '', line_start: 1, line_end: 100 }, outputSchema: { ok: 'boolean', content: 'string', total_lines: 'number', line_start: 'number', line_end: 'number' } },
  { id: 'file_read', category: 'system', kind: 'local', description: 'Read file contents with line numbers. Supports plain text plus extractable PDF and spreadsheet files.', argsTemplate: { path: '', whole_file: true, line_start: 1, line_end: 100 }, outputSchema: { ok: 'boolean', content: 'string', total_lines: 'number', line_start: 'number', line_end: 'number', lines_returned: 'number', truncated: 'boolean', error: 'string' } },
  { id: 'file_edit', category: 'system', kind: 'local', description: 'Edit file contents (delete, add, replace lines)', argsTemplate: { path: '', mode: 'replace', line_start: 10, line_end: 15, content: '' }, outputSchema: { ok: 'boolean', mode: 'string', lines_affected: 'number', new_total_lines: 'number', error: 'string' } },
  { id: 'write_file', category: 'system', kind: 'local', description: 'Write text content to a file', argsTemplate: { path: '', content: '', append: false }, outputSchema: { ok: 'boolean' } },
  { id: 'create_directory', category: 'system', kind: 'local', description: 'Create a directory on disk', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'list_directory', category: 'system', kind: 'local', description: 'List directory contents', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', items: 'any[]' } },
  { id: 'glob', category: 'system', kind: 'local', description: 'Find files and folders by name pattern. Use simple patterns like *.txt to find all text files, or **/*.js to find JavaScript files in all subfolders.', argsTemplate: { pattern: '*.txt', root: '' }, outputSchema: { ok: 'boolean', items: 'any[]', count: 'number', truncated: 'boolean', error: 'string' } },
  { id: 'grep', category: 'system', kind: 'local', description: 'Search for text inside files. Finds every line that contains your search term across one or many files.', argsTemplate: { path: '', pattern: '', file_filter: '' }, outputSchema: { ok: 'boolean', results: 'any[]', count: 'number', truncated: 'boolean', error: 'string' } },
  { id: 'open_file', category: 'system', kind: 'local', description: 'Open a file or folder with the default application', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', opened: 'string', method: 'string' } },
  { id: 'move_file', category: 'system', kind: 'local', description: 'Move or rename files and directories', argsTemplate: { src: '', dest: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'list_open_windows', category: 'system', kind: 'local', description: 'List all open windows and their properties', argsTemplate: {}, outputSchema: { ok: 'boolean', windows: 'any[]' } },
  { id: 'bring_window_to_foreground', category: 'system', kind: 'local', description: 'Activate and focus a window by title', argsTemplate: { title: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'smart_bring_window_to_foreground', category: 'system', kind: 'local', description: 'Intelligently find and activate a window', argsTemplate: { hint: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'get_window_info', category: 'system', kind: 'local', description: 'Get details about a specific window', argsTemplate: { title: '' }, outputSchema: { ok: 'boolean', bounds: 'object' } },
  { id: 'set_window_bounds', category: 'system', kind: 'local', description: 'Move and/or resize a window', argsTemplate: { title: '', bounds: { x: 0, y: 0, width: 800, height: 600 }, bringToTop: true }, outputSchema: { ok: 'boolean', bounds: 'object' } },

  // --- DESKTOP CONTROLS (volume / brightness / bluetooth / wallpaper / power) ---
  { id: 'describe_desktop_control_capabilities', category: 'system', kind: 'local', description: 'Describe which desktop software controls (wallpaper, volume, Bluetooth, brightness, battery) are available on this machine.', argsTemplate: {}, outputSchema: { ok: 'boolean', platform: 'string', capabilities: 'object', tools: 'string[]' } },
  { id: 'get_desktop_wallpaper', category: 'system', kind: 'local', description: 'Get the current desktop wallpaper path(s) when the platform exposes them.', argsTemplate: {}, outputSchema: { ok: 'boolean', path: 'string', paths: 'string[]', backend: 'string' } },
  { id: 'set_desktop_wallpaper', category: 'system', kind: 'local', description: 'Set the desktop wallpaper from a local image path. Cross-platform: Windows native API, macOS System Events, Linux desktop-environment CLIs when available.', argsTemplate: { path: '', style: 'fill' }, outputSchema: { ok: 'boolean', backend: 'string' } },
  { id: 'get_system_volume', category: 'system', kind: 'local', description: 'Get current system output volume (0-100) and mute state.', argsTemplate: {}, outputSchema: { ok: 'boolean', volume: 'number', muted: 'boolean', backend: 'string' } },
  { id: 'set_system_volume', category: 'system', kind: 'local', description: 'Set or adjust system output volume and mute state. Use level for absolute (0-100), delta for relative change, or muted to toggle mute.', argsTemplate: { level: 50 }, outputSchema: { ok: 'boolean', volume: 'number', muted: 'boolean', backend: 'string' } },
  { id: 'list_bluetooth_devices', category: 'system', kind: 'local', description: 'List known or paired Bluetooth devices using the best available platform backend.', argsTemplate: {}, outputSchema: { ok: 'boolean', devices: 'any[]', backend: 'string' } },
  { id: 'connect_bluetooth_device', category: 'system', kind: 'local', description: 'Connect a Bluetooth device by MAC address. Linux requires bluetoothctl; macOS requires blueutil. Windows can open Bluetooth settings.', argsTemplate: { address: '', openSettings: false }, outputSchema: { ok: 'boolean', backend: 'string', error: 'string' } },
  { id: 'disconnect_bluetooth_device', category: 'system', kind: 'local', description: 'Disconnect a Bluetooth device by MAC address. Linux requires bluetoothctl; macOS requires blueutil.', argsTemplate: { address: '' }, outputSchema: { ok: 'boolean', backend: 'string', error: 'string' } },
  { id: 'get_display_brightness', category: 'system', kind: 'local', description: 'Get laptop or display brightness (0-100) when the OS/backend exposes it.', argsTemplate: {}, outputSchema: { ok: 'boolean', percent: 'number', backend: 'string' } },
  { id: 'set_display_brightness', category: 'system', kind: 'local', description: 'Set laptop or display brightness (0-100). Windows uses WMI; Linux uses brightnessctl/sysfs; macOS requires the brightness CLI.', argsTemplate: { percent: 75 }, outputSchema: { ok: 'boolean', percent: 'number', backend: 'string' } },
  { id: 'get_power_status', category: 'system', kind: 'local', description: 'Get battery percentage and charging status for laptops when available.', argsTemplate: {}, outputSchema: { ok: 'boolean', percent: 'number', charging: 'boolean', onBattery: 'boolean', batteries: 'any[]', backend: 'string' } },

  // --- INPUT ---
  { id: 'send_hotkey', category: 'input', kind: 'local', description: 'Send keyboard hotkey combinations', argsTemplate: { keys: ['ctrl', 'c'], count: 1, delay: 0 }, outputSchema: { ok: 'boolean', count: 'number' } },
  { id: 'type_text', category: 'input', kind: 'local', description: 'Type text at cursor position', argsTemplate: { text: '', useClipboardFallback: false }, outputSchema: { ok: 'boolean' } },
  { id: 'click_at_coordinates', category: 'input', kind: 'local', description: 'Click at specific screen coordinates', argsTemplate: { x: 100, y: 100, button: 'left' }, outputSchema: { ok: 'boolean' } },
  { id: 'double_click_at_coordinates', category: 'input', kind: 'local', description: 'Double-click at specific screen coordinates', argsTemplate: { x: 100, y: 100, button: 'left' }, outputSchema: { ok: 'boolean' } },
  { id: 'scroll', category: 'input', kind: 'local', description: 'Scroll the mouse wheel', argsTemplate: { deltaY: 120, deltaX: 0, speed: 1 }, outputSchema: { ok: 'boolean' } },
  { id: 'drag_and_drop', category: 'input', kind: 'local', description: 'Drag from one coordinate to another', argsTemplate: { fromX: 100, fromY: 100, toX: 400, toY: 400 }, outputSchema: { ok: 'boolean' } },
  { id: 'get_mouse_position', category: 'input', kind: 'local', description: 'Get the current mouse cursor position on screen', argsTemplate: {}, outputSchema: { ok: 'boolean', x: 'number', y: 'number' } },
  { id: 'move_cursor', category: 'input', kind: 'local', description: 'Move the mouse cursor to specific screen coordinates', argsTemplate: { x: 100, y: 100, duration: 0 }, outputSchema: { ok: 'boolean', x: 'number', y: 'number' } },
  { id: 'computer_use', category: 'input', kind: 'local', description: 'Perform GUI actions (mouse/keyboard) and optionally capture a screenshot', argsTemplate: { action: 'mouse_move', x: 100, y: 100, includeScreenshot: false }, outputSchema: { ok: 'boolean', action: 'string', filePath: 'string', screenshot: 'string', cursor: { x: 'number', y: 'number' }, display: { width: 'number', height: 'number' }, text: 'string' } },
  { id: 'get_clipboard_content', category: 'input', kind: 'local', description: 'Read the clipboard with its type (text, image, files, html). Set saveImage to write a clipboard image to a PNG file.', argsTemplate: { saveImage: false, includeImageData: false }, outputSchema: { ok: 'boolean', type: 'string', types: 'string[]', text: 'string', html: 'string', files: 'string[]', hasImage: 'boolean', imageSize: { width: 'number', height: 'number' }, imagePath: 'string', imageDataUrl: 'string', formats: 'string[]' } },
  { id: 'set_clipboard_content', category: 'input', kind: 'local', description: 'Write to the clipboard. Defaults to text; set type to html or image (with imagePath or imageDataUrl) for other formats.', argsTemplate: { type: 'text', text: '', html: '', imagePath: '', imageDataUrl: '' }, outputSchema: { ok: 'boolean', type: 'string' } },

  // --- VISION / MEDIA ---
  { id: 'take_screenshot', category: 'vision', kind: 'local', description: 'Capture screenshot and return a local file path', argsTemplate: { region: { x: 0, y: 0, width: 800, height: 600 }, hideUI: false }, outputSchema: { ok: 'boolean', filePath: 'string' } },
  { id: 'capture_media', category: 'vision', kind: 'local', description: 'Capture photos, videos, or audio', argsTemplate: { kind: 'audio', mode: 'fixed', stream: false, mirror: false, durationMs: 5000, device: '', filePath: '', sessionId: '', maxDurationMs: 600000 }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', streamId: 'string', stoppedBy: 'string', mode: 'string', status: 'string', durationMs: 'number', volumePercent: 'number' } },
  { id: 'stop_capture', category: 'vision', kind: 'local', description: 'Stop an active capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean', stopped: 'boolean', filePath: 'string', stoppedBy: 'string', busInfo: 'any' } },
  { id: 'list_active_captures', category: 'vision', kind: 'local', description: 'List all currently active capture sessions', argsTemplate: {}, outputSchema: { ok: 'boolean', sessions: 'string[]' } },
  { id: 'capture_screen', category: 'vision', kind: 'local', description: 'Record the screen (full screen, monitor, window, or region) with optional system audio', argsTemplate: { mode: 'fixed', stream: false, durationMs: 5000, target: 'fullscreen', monitorId: 0, windowTitle: '', region: { x: 0, y: 0, width: 1920, height: 1080 }, includeSystemAudio: false, fps: 30, quality: 'medium', filePath: '', sessionId: '', maxDurationMs: 7200000 }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', streamId: 'string', stoppedBy: 'string', mode: 'string', status: 'string', hasAudio: 'boolean', audioFilePath: 'string', volumePercent: 'number' } },
  { id: 'stop_screen_capture', category: 'vision', kind: 'local', description: 'Stop an active screen capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean', filePath: 'string', audioFilePath: 'string' } },
  { id: 'describe_screen_capture_capabilities', category: 'vision', kind: 'local', description: 'List available monitors and windows for screen capture', argsTemplate: {}, outputSchema: { monitors: 'any[]', windows: 'any[]' } },
  { id: 'capture_system_audio', category: 'vision', kind: 'local', description: 'Record system audio output (what you hear from speakers). Uses WASAPI loopback on Windows.', argsTemplate: { mode: 'fixed', stream: false, durationMs: 5000, device: '', filePath: '', sessionId: '', maxDurationMs: 7200000, format: 'wav' }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', streamId: 'string', stoppedBy: 'string', mode: 'string', status: 'string', durationMs: 'number', volumePercent: 'number' } },
  { id: 'stop_system_audio', category: 'vision', kind: 'local', description: 'Stop an active system audio capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean' } },
  { id: 'describe_system_audio_capabilities', category: 'vision', kind: 'local', description: 'List available loopback devices and check platform support', argsTemplate: {}, outputSchema: { supported: 'boolean', platform: 'string', devices: 'any[]', note: 'string' } },
  { id: 'analyze_image', category: 'vision', kind: 'cloud', description: 'Analyze an image file with AI vision', argsTemplate: { imagePath: '', prompt: '' }, outputSchema: { text: 'string' } },
  { id: 'analyze_current_screen', category: 'vision', kind: 'cloud', description: 'Capture and analyze the current screen', argsTemplate: { mode: 'text', prompt: '', booleanKey: '' }, outputSchema: { text: 'string', json: 'any', boolean: 'boolean' } },
  { id: 'find_text', category: 'vision', kind: 'cloud', description: 'Find text on screen with OCR and return coordinates for the best match plus all detected matches.', argsTemplate: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false }, outputSchema: { ok: 'boolean', found: 'boolean', ambiguous: 'boolean', matchCount: 'number', matchedText: 'string', x: 'number', y: 'number', centerX: 'number', centerY: 'number', boundingBox: 'object', matches: 'any[]', allMatches: 'any[]', fullText: 'string', error: 'string' } },
  { id: 'find_and_click_text', category: 'vision', kind: 'cloud', description: 'Find matching text on screen with OCR and click only when there is a single unambiguous match.', argsTemplate: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false }, outputSchema: { ok: 'boolean', found: 'boolean', clicked: 'boolean', ambiguous: 'boolean', matchCount: 'number', matchedText: 'string', x: 'number', y: 'number', centerX: 'number', centerY: 'number', boundingBox: 'object', matches: 'any[]', allMatches: 'any[]', fullText: 'string', error: 'string' } },
  { id: 'google_cloud_ocr', category: 'vision', kind: 'cloud', description: 'Extract text from an image file, URL, or fresh screenshot using Google Cloud Vision OCR.', argsTemplate: { path: '', imageUrl: '', base64: '', mimeType: 'image/png', captureScreen: false, region: { x: 0, y: 0, width: 800, height: 600 }, ocrMode: 'document', languageHints: [], includeWordBoxes: true }, outputSchema: { ok: 'boolean', text: 'string', wordCount: 'number', words: 'any[]', detectedLanguages: 'string[]', source: 'object', mimeType: 'string', screenshotPath: 'string', error: 'string' } },
  { id: 'analyze_media', category: 'vision', kind: 'cloud', description: 'Analyze video/audio files or transcribe audio. The task determines the output - use task="transcribe" for transcription.', argsTemplate: { task: 'Summarize this media', sources: [{ path: '' }], mode: 'fast', model: '' }, outputSchema: { summary: 'string' } },
  { id: 'stream_speech', category: 'vision', kind: 'local', description: 'Stream microphone audio to the cloud speech proxy', argsTemplate: { accessToken: '', device: '', busId: 'default', durationMs: 60000, sampleRate: 16000 }, outputSchema: { ok: 'boolean', sessionId: 'string' } },
  { id: 'stop_stream_speech', category: 'vision', kind: 'local', description: 'Stop an active stream_speech audio session', argsTemplate: { busId: 'default' }, outputSchema: { ok: 'boolean', busId: 'string' } },
  { id: 'play_audio', category: 'vision', kind: 'local', description: 'Play an audio file (MP3, WAV, etc.)', argsTemplate: { path: '', block: true }, outputSchema: { ok: 'boolean', played: 'string', method: 'string', error: 'string' } },
  { id: 'ffmpeg_status', category: 'vision', kind: 'local', description: 'Check if FFmpeg is available locally (downloaded or system-installed).', argsTemplate: {}, outputSchema: { ok: 'boolean', available: 'boolean', source: 'string', ffmpegPath: 'string', ffprobePath: 'string', meta: 'any' } },
  { id: 'ffmpeg_setup', category: 'vision', kind: 'local', description: 'Ensure FFmpeg is available locally (auto-downloads if needed).', argsTemplate: {}, outputSchema: { ok: 'boolean', available: 'boolean', source: 'string', ffmpegPath: 'string', ffprobePath: 'string', meta: 'any', error: 'string', message: 'string' } },
  { id: 'ffmpeg_run', category: 'vision', kind: 'local', description: 'Run FFmpeg with custom arguments. Use for advanced conversions and edits.', argsTemplate: { inputs: ['C:/input_1.mp4', 'C:/input_2.mp4'], extraArgs: ['-filter_complex', '...'], output: 'C:/output.mp4', overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string', outputFilePath: 'string' } },
  { id: 'ffmpeg_convert_media', category: 'vision', kind: 'local', description: 'Convert media from one format to another using FFmpeg. Output format is inferred from outputPath\'s extension; extraArgs is optional (one token per element) — omit it entirely for a plain format change, never pass [""].', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/output.mp3', overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_extract_audio', category: 'vision', kind: 'local', description: 'Extract audio from a media file into an audio-only output (e.g. mp3, wav).', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/output.mp3', overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_trim_media', category: 'vision', kind: 'local', description: 'Trim a media file to a time range (fast copy mode).', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/clip.mp4', startSeconds: 0, durationSeconds: 10, overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_probe_media', category: 'vision', kind: 'local', description: 'Inspect a media file using ffprobe and return JSON metadata.', argsTemplate: { inputPath: 'C:/input.mp4', timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', data: 'any', stdout: 'string', stderr: 'string', ffprobePath: 'string' } },
  { id: 'ffmpeg_extract_frames', category: 'vision', kind: 'local', description: 'Extract image frames from a video to a numbered file pattern.', argsTemplate: { inputPath: 'C:/input.mp4', outputPattern: 'C:/frames/%04d.jpg', overwrite: true, fps: 1, startSeconds: 0, durationSeconds: 5, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },

  // --- MEDIAPIPE (Computer Vision) ---
  { id: 'mediapipe_pose', category: 'vision', kind: 'local', description: 'Detect body pose landmarks (33 points) in an image using MediaPipe. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', drawLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }, outputSchema: { ok: 'boolean', poseDetected: 'boolean', landmarks: 'any[]', landmarkCount: 'number', outputPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_hands', category: 'vision', kind: 'local', description: 'Detect hand landmarks (21 points per hand) in an image using MediaPipe. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', drawLandmarks: true, maxNumHands: 2, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }, outputSchema: { ok: 'boolean', hands: 'any[]', handCount: 'number', outputPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_face_detection', category: 'vision', kind: 'local', description: 'Detect faces with bounding boxes and keypoints using MediaPipe. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', drawDetections: true, minDetectionConfidence: 0.5 }, outputSchema: { ok: 'boolean', faces: 'any[]', faceCount: 'number', outputPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_face_mesh', category: 'vision', kind: 'local', description: 'Detect 478 face mesh landmarks using MediaPipe. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', drawLandmarks: true, maxNumFaces: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }, outputSchema: { ok: 'boolean', faces: 'any[]', faceCount: 'number', outputPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_segmentation', category: 'vision', kind: 'local', description: 'Segment person from background (selfie segmentation) using MediaPipe. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', threshold: 0.5, backgroundColor: '', blurBackground: false, blurStrength: 21 }, outputSchema: { ok: 'boolean', outputPath: 'string', maskPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_holistic', category: 'vision', kind: 'local', description: 'Detect pose + hands + face in one pass using MediaPipe Holistic. Accepts file path or base64 data URL.', argsTemplate: { imagePath: '', imageData: '', outputFormat: 'base64', outputPath: '', drawLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }, outputSchema: { ok: 'boolean', pose: 'any', leftHand: 'any', rightHand: 'any', face: 'any', outputPath: 'string', outputDataUrl: 'string' } },
  { id: 'mediapipe_process_video', category: 'vision', kind: 'local', description: 'Process video frames with MediaPipe (pose/hands/face/holistic)', argsTemplate: { videoPath: '', outputPath: '', task: 'pose', drawLandmarks: true, maxFrames: 0, sampleEveryN: 1, minDetectionConfidence: 0.5 }, outputSchema: { ok: 'boolean', frameCount: 'number', processedFrames: 'number', framesWithDetection: 'number', outputPath: 'string', frameLandmarks: 'any[]' } },

  // --- OLLAMA (Local AI) ---
  { id: 'ollama_status', category: 'ollama', kind: 'local', description: 'Check if Ollama is running locally and list available models', argsTemplate: {}, outputSchema: { ok: 'boolean', available: 'boolean', host: 'string', modelCount: 'number', models: 'any[]', runningCount: 'number', running: 'any[]', error: 'string' } },
  { id: 'ollama_agent', category: 'ollama', kind: 'local', description: 'Run a local Ollama model like a workflow AI agent. Combines prompt/chat/image input, memory injected into the system prompt, and smart workflow tool access.', argsTemplate: { model: 'llama3.2', prompt: '', context: '', systemPrompt: '', outputMode: 'text', toolMode: 'curated', maxSteps: 8, timeoutMs: 300000, injectMemory: false, stream: false, think: false, temperature: 0.7, num_predict: 2048 }, outputSchema: { ok: 'boolean', model: 'string', text: 'string', json: 'any', thinking: 'string', toolCalls: 'number', usedTools: 'string[]', streamed: 'boolean', streamId: 'string', totalDuration: 'number', evalCount: 'number', error: 'string' } },
  { id: 'ollama_chat', category: 'ollama', kind: 'local', description: 'Multi-turn chat with a local LLM via Ollama. Supports system prompts, temperature, JSON mode, streaming, thinking (reasoning models), and tool calling.', argsTemplate: { model: 'llama3.2', messages: [{ role: 'user', content: '' }], system: '', stream: false, think: false, tools: [], temperature: 0.7, num_predict: 2048, json_mode: false }, outputSchema: { ok: 'boolean', model: 'string', message: 'object', text: 'string', thinking: 'string', toolCalls: 'any[]', streamed: 'boolean', streamId: 'string', totalDuration: 'number', evalCount: 'number', error: 'string' } },
  { id: 'ollama_generate', category: 'ollama', kind: 'local', description: 'Single-prompt text completion with a local LLM. Simpler than chat for one-shot tasks. Supports thinking mode for reasoning models.', argsTemplate: { model: 'llama3.2', prompt: '', system: '', stream: false, think: false, temperature: 0.7, num_predict: 2048, json_mode: false }, outputSchema: { ok: 'boolean', model: 'string', text: 'string', thinking: 'string', streamed: 'boolean', streamId: 'string', totalDuration: 'number', evalCount: 'number', error: 'string' } },
  { id: 'ollama_vision', category: 'ollama', kind: 'local', description: 'Analyze images using a local multimodal model (e.g. llava). Reads local files — no cloud upload.', argsTemplate: { model: 'llava', prompt: 'Describe this image in detail.', imagePath: '', temperature: 0.7, num_predict: 2048 }, outputSchema: { ok: 'boolean', model: 'string', text: 'string', totalDuration: 'number', imageCount: 'number', error: 'string' } },
  { id: 'ollama_embeddings', category: 'ollama', kind: 'local', description: 'Generate vector embeddings using a local model for semantic search and RAG.', argsTemplate: { model: 'nomic-embed-text', input: '' }, outputSchema: { ok: 'boolean', model: 'string', embeddings: 'any[]', dimensions: 'number', count: 'number', error: 'string' } },
  { id: 'ollama_models', category: 'ollama', kind: 'local', description: 'Manage local Ollama models: list, pull, delete, show details, see running, or copy.', argsTemplate: { action: 'list', model: '' }, outputSchema: { ok: 'boolean', action: 'string', models: 'any[]', count: 'number', model: 'string', status: 'string', deleted: 'boolean', error: 'string' } },

  { id: 'generate_image', category: 'vision', kind: 'cloud', description: 'Generate images from text or reference images using AI. Supports OpenAI (GPT Image, DALL-E), Google (Nano Banana, Imagen), and xAI (Grok Imagine).', argsTemplate: { prompt: '', input_images: [], model: 'gemini-3.1-flash-image-preview', size: 'auto', aspect_ratio: 'auto', quality: 'auto', n: 1, format: 'png', background: 'auto' }, outputSchema: { ok: 'boolean', images: 'any[]', model: 'string', provider: 'string', error: 'string' } },
  { id: 'text_to_speech', category: 'vision', kind: 'cloud', description: 'Convert text to speech audio. Defaults to ElevenLabs TTS (rich voices, language support); also supports the audio models openai/gpt-audio and openai/gpt-audio-mini — set model_id accordingly with a voice like alloy/echo/nova', argsTemplate: { text: '', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: true, play: false, outputPath: '' }, outputSchema: { ok: 'boolean', filePath: 'string', format: 'string', voice_id: 'string', textLength: 'number', played: 'boolean', error: 'string' } },
  { id: 'list_tts_voices', category: 'vision', kind: 'cloud', description: 'List all available ElevenLabs text-to-speech voices', argsTemplate: {}, outputSchema: { ok: 'boolean', voices: 'any[]' } },
  { id: 'get_tts_models', category: 'vision', kind: 'cloud', description: 'List available ElevenLabs TTS models', argsTemplate: {}, outputSchema: { ok: 'boolean', models: 'any[]' } },
  { id: 'elevenlabs_list_agents', category: 'vision', kind: 'cloud', description: 'List ElevenLabs conversational AI agents for live voice sessions', argsTemplate: { search: '', archived: false, show_only_owned_agents: true, page_size: 20 }, outputSchema: { ok: 'boolean', agents: 'any[]', nextCursor: 'string', hasMore: 'boolean', error: 'string' } },
  { id: 'elevenlabs_get_signed_conversation_url', category: 'vision', kind: 'cloud', description: 'Get a signed ElevenLabs live conversation URL for launching an authenticated voice session', argsTemplate: { agent_id: '', include_conversation_id: true, branch_id: '' }, outputSchema: { ok: 'boolean', agentId: 'string', signedUrl: 'string', includeConversationId: 'boolean', error: 'string' } },
  { id: 'elevenlabs_get_webrtc_token', category: 'vision', kind: 'cloud', description: 'Get an ElevenLabs WebRTC token for low-latency live voice conversations', argsTemplate: { agent_id: '', participant_name: '', branch_id: '' }, outputSchema: { ok: 'boolean', agentId: 'string', token: 'string', participantName: 'string', error: 'string' } },
  { id: 'elevenlabs_list_conversations', category: 'vision', kind: 'cloud', description: 'List ElevenLabs live conversation sessions for an agent', argsTemplate: { agent_id: '', search: '', branch_id: '', page_size: 20 }, outputSchema: { ok: 'boolean', conversations: 'any[]', nextCursor: 'string', hasMore: 'boolean', error: 'string' } },
  { id: 'elevenlabs_get_conversation', category: 'vision', kind: 'cloud', description: 'Get detailed metadata for an ElevenLabs conversation session', argsTemplate: { conversation_id: '' }, outputSchema: { ok: 'boolean', conversation: 'any', error: 'string' } },

  // --- DATA / AI ---
  { id: 'ai_inference', category: 'data', kind: 'cloud', description: 'Unified AI inference — text, multimodal (image / audio / video / PDF / current screen), structured JSON, or embeddings. Routed via OpenRouter.', argsTemplate: { prompt: '', input: '', sources: [], mode: 'text', schema: {}, model: 'google/gemini-3.1-pro-preview', temperature: 0.3 }, outputSchema: { ok: 'boolean', text: 'string', json: 'any', embedding: 'number[]', model: 'string' } },
  { id: 'web_search', category: 'data', kind: 'cloud', description: 'Search the web using Perplexity AI', argsTemplate: { query: '', max_results: 5, max_tokens_per_page: 1024 }, outputSchema: { results: 'any[]', id: 'string' } },

  // --- MAPS & LOCATION (Google Maps Platform) ---
  { id: 'maps_search_places', category: 'data', kind: 'cloud', description: 'Find businesses & places near a location (Google Maps). Use a text query like "coffee shops in Chicago", or pass a place type + radius for a nearby search. Returns name, address, rating, phone, website, and hours.', argsTemplate: { query: 'coffee shops in Chicago', max_results: 10 }, outputSchema: { ok: 'boolean', mode: 'string', count: 'number', places: 'any[]', error: 'string' } },
  { id: 'maps_place_details', category: 'data', kind: 'cloud', description: 'Get full details for one place by its Place ID (from Find Places) — phone, website, full weekly hours, and recent reviews.', argsTemplate: { place_id: '', include_reviews: true }, outputSchema: { ok: 'boolean', place: 'object', error: 'string' } },
  { id: 'maps_distance_matrix', category: 'data', kind: 'cloud', description: 'Get travel distance and time between one or more starting points and destinations (Google Maps). Addresses, place names, or "lat,lng" all work.', argsTemplate: { origins: ['Chicago, IL'], destinations: ['Milwaukee, WI'], mode: 'driving', units: 'imperial' }, outputSchema: { ok: 'boolean', origin_addresses: 'any[]', destination_addresses: 'any[]', rows: 'any[]', error: 'string' } },
  { id: 'maps_static_map', category: 'data', kind: 'cloud', description: 'Render a map image of a place or set of markers (Google Maps). Saves to the media gallery so it can be shown or attached.', argsTemplate: { center: 'Willis Tower, Chicago', zoom: 14, size: '640x400', maptype: 'roadmap' }, outputSchema: { ok: 'boolean', images: 'any[]', error: 'string' } },

  // --- UI ---
  { id: 'custom_ui', category: 'ui', kind: 'local', description: 'Show a custom desktop UI built with React JSX. Best for forms, overlays, live status panels, and mini-app flows. Supports Tailwind, Framer Motion, workflow data via useVar(), and Stuard APIs like submit, callTool, and callNode. Explicit window x/y and stuard.moveTo use the same screen coordinates as mouse tools.', argsTemplate: { id: 'my-panel', title: 'My Custom UI', component: '', css: '', data: {}, window: { width: 400, height: 500, position: 'center', alwaysOnTop: false, frameless: true, borderRadius: 12, resizable: false, draggable: true, minimizable: true, backgroundType: 'color', backgroundColor: '#1a1a2e', contentPadding: 24, shadow: { enabled: true, color: '#00000040', blur: 20, spread: 0, x: 0, y: 8 }, animation: { open: 'fade', close: 'fade', duration: 300, easing: 'ease-out' }, invisible: false, translucent: { color: '#1a1a2e', opacity: 0.7, blur: 12 } }, blocking: true }, outputSchema: { ok: 'boolean', action: 'string', data: 'object' } },
  { id: 'update_custom_ui', category: 'ui', kind: 'local', description: 'Update existing custom_ui window with new content', argsTemplate: { id: 'my-panel', title: '', html: '', css: '', data: {}, window: {} }, outputSchema: { ok: 'boolean', action: 'string', data: 'object' } },
  { id: 'close_custom_ui', category: 'ui', kind: 'local', description: 'Close a UI window', argsTemplate: { id: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'ask_confirmation', category: 'ui', kind: 'local', description: 'Show a confirmation dialog to the user', argsTemplate: { title: 'Confirm Action', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', variant: 'warning' }, outputSchema: { confirmed: 'boolean' } },
  { id: 'show_choices', category: 'ui', kind: 'local', description: 'Present multiple choice options to the user', argsTemplate: { title: '', choices: [] }, outputSchema: { selectedId: 'string' } },
  { id: 'pick_date', category: 'ui', kind: 'local', description: 'Show a calendar date picker', argsTemplate: { label: '', minDate: '' }, outputSchema: { date: 'string' } },
  { id: 'request_files', category: 'ui', kind: 'local', description: 'Show a file dropzone for file selection', argsTemplate: { label: '', accept: '.pdf,.png,.jpg', maxFiles: 5 }, outputSchema: { files: 'any[]' } },
  { id: 'show_table', category: 'ui', kind: 'local', description: 'Display data in an interactive table', argsTemplate: { title: '', columns: [], data: [], pageSize: 5, expandable: true }, outputSchema: { action: 'string', row: 'object' } },
  { id: 'show_info', category: 'ui', kind: 'local', description: 'Display key-value pairs in a clean grid', argsTemplate: { title: '', items: [], columns: 2 }, outputSchema: { ok: 'boolean' } },
  { id: 'show_details', category: 'ui', kind: 'local', description: 'Show expandable/collapsible sections', argsTemplate: { sections: [], allowMultiple: false, variant: 'default' }, outputSchema: { ok: 'boolean' } },
  { id: 'show_files', category: 'ui', kind: 'local', description: 'Display a file/folder tree structure', argsTemplate: { title: '', nodes: [] }, outputSchema: { action: 'string', node: 'object' } },
  { id: 'show_command', category: 'ui', kind: 'local', description: 'Display a terminal command block', argsTemplate: { command: '', title: 'Terminal', autoRun: false, expanded: false }, outputSchema: { executed: 'boolean', output: 'string' } },
  { id: 'show_json', category: 'ui', kind: 'local', description: 'Display JSON data in a collapsible tree viewer', argsTemplate: { title: '', data: {}, expanded: true, maxDepth: 5 }, outputSchema: { ok: 'boolean' } },
  { id: 'show_link', category: 'ui', kind: 'local', description: 'Display a rich link preview card', argsTemplate: { url: '', title: '', description: '', image: '', siteName: '', variant: 'large' }, outputSchema: { action: 'string', url: 'string' } },
  { id: 'show_colors', category: 'ui', kind: 'local', description: 'Display a color palette with clickable swatches', argsTemplate: { title: '', colors: [] }, outputSchema: { ok: 'boolean' } },
  { id: 'show_info_card', category: 'ui', kind: 'local', description: 'Display a rich information card with optional action', argsTemplate: { title: 'Info', message: '', variant: 'info', actionLabel: '', footer: '' }, outputSchema: { action: 'string' } },
  { id: 'show_progress', category: 'ui', kind: 'local', description: 'Display a progress bar for long-running tasks', argsTemplate: { progress: 50, label: '', sublabel: '', variant: 'download', status: 'active', color: 'blue' }, outputSchema: { ok: 'boolean' } },
  { id: 'show_form', category: 'ui', kind: 'local', description: 'Display a multi-page form/wizard to collect structured user input. Supports select, multiselect, text, textarea, toggle, number, slider fields.', argsTemplate: { title: 'User Input', description: '', pages: [{ id: 'page1', title: 'Page 1', fields: [] }], submitLabel: 'Submit', cancelLabel: 'Cancel', showProgress: true }, outputSchema: { submitted: 'boolean', cancelled: 'boolean', data: 'object' } },

  // --- CLOUD STORAGE ---
  { id: 'cloud_storage_upload', category: 'cloud_storage', kind: 'cloud', description: 'Upload a local file to cloud storage with public or private visibility', argsTemplate: { path: '', folder: '', visibility: 'private', filename: '' }, outputSchema: { ok: 'boolean', objectName: 'string', url: 'string', visibility: 'string', bytesWritten: 'number', contentType: 'string' } },
  { id: 'cloud_storage_get_url', category: 'cloud_storage', kind: 'cloud', description: 'Get a download URL for a file in cloud storage (public or signed)', argsTemplate: { objectName: '', visibility: 'private' }, outputSchema: { ok: 'boolean', url: 'string', visibility: 'string', objectName: 'string' } },
  { id: 'cloud_storage_list', category: 'cloud_storage', kind: 'cloud', description: 'List files in your cloud storage', argsTemplate: { prefix: '', limit: 100 }, outputSchema: { ok: 'boolean', files: 'any[]', count: 'number' } },
  { id: 'cloud_storage_delete', category: 'cloud_storage', kind: 'cloud', description: 'Delete a file from cloud storage', argsTemplate: { objectName: '' }, outputSchema: { ok: 'boolean', deleted: 'string' } },
  { id: 'cloud_storage_set_visibility', category: 'cloud_storage', kind: 'cloud', description: 'Change file visibility between public and private', argsTemplate: { objectName: '', visibility: 'public' }, outputSchema: { ok: 'boolean', visibility: 'string', url: 'string', objectName: 'string' } },

  // --- INTEGRATIONS ---
  { id: 'google_get_userinfo', category: 'integrations', kind: 'cloud', description: 'Get Google account profile via oauth2 v3 userinfo (Current user profile info).', argsTemplate: { profile: 'default' }, outputSchema: { me: 'object' } },
  { id: 'google_list_profiles', category: 'integrations', kind: 'cloud', description: 'List all connected Google profiles/accounts for the current user. Returns profile labels and emails. Call this first when the user has multiple Google accounts to determine which profile label to pass to other Google tools.', argsTemplate: {}, outputSchema: { profiles: 'any[]' } },
  { id: 'gmail_send_message', category: 'integrations', kind: 'cloud', description: 'Send an email via Gmail with optional file attachments', argsTemplate: { to: [], subject: '', body: '', contentType: 'text/plain', from: '', cc: [], bcc: [], attachments: [], profile: '' }, outputSchema: { message: 'object', attachmentCount: 'number' } },
  // ── Disabled pending Google CASA verification (restricted Gmail/Drive scopes) ──
  // { id: 'gmail_list_messages', category: 'integrations', kind: 'cloud', description: 'List Gmail messages', argsTemplate: { q: '', labelIds: [], maxResults: 10, includeSpamTrash: false, profile: '' }, outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' } },
  // { id: 'gmail_search_messages', category: 'integrations', kind: 'cloud', description: 'Search Gmail messages', argsTemplate: { query: '', labelIds: [], maxResults: 10, includeSpamTrash: false, profile: '' }, outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' } },
  // { id: 'gmail_get_message_brief', category: 'integrations', kind: 'cloud', description: 'Get a Gmail message brief', argsTemplate: { id: '', profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'gmail_get_message_full', category: 'integrations', kind: 'cloud', description: 'Get a Gmail message with full content', argsTemplate: { id: '', profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'gmail_modify_message', category: 'integrations', kind: 'cloud', description: 'Modify Gmail message labels', argsTemplate: { id: '', addLabelIds: [], removeLabelIds: [], profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'gmail_delete_message', category: 'integrations', kind: 'cloud', description: 'Delete a Gmail message permanently', argsTemplate: { id: '', profile: '' }, outputSchema: { ok: 'boolean' } },
  // { id: 'gmail_archive_message', category: 'integrations', kind: 'cloud', description: 'Archive a Gmail message', argsTemplate: { id: '', profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'gmail_mark_as_read', category: 'integrations', kind: 'cloud', description: 'Mark a Gmail message as read', argsTemplate: { id: '', profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'gmail_mark_as_unread', category: 'integrations', kind: 'cloud', description: 'Mark a Gmail message as unread', argsTemplate: { id: '', profile: '' }, outputSchema: { message: 'object' } },
  // { id: 'drive_list_files', category: 'integrations', kind: 'cloud', description: 'List Google Drive files', argsTemplate: { query: '', pageSize: 20, orderBy: '', profile: '' }, outputSchema: { files: 'any[]', count: 'number', nextPageToken: 'string' } },
  { id: 'calendar_list_events', category: 'integrations', kind: 'cloud', description: 'List Google Calendar events', argsTemplate: { calendarId: 'primary', timeMin: '', timeMax: '', maxResults: 10, profile: '' }, outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' } },
  { id: 'calendar_create_event', category: 'integrations', kind: 'cloud', description: 'Create a Google Calendar event', argsTemplate: { calendarId: 'primary', summary: '', description: '', start: '', end: '', timeZone: '', profile: '' }, outputSchema: { event: 'object' } },
  { id: 'sheets_read_range', category: 'integrations', kind: 'cloud', description: 'Read a range from Google Sheets', argsTemplate: { spreadsheetId: '', range: '', profile: '' }, outputSchema: { values: 'any[]', range: 'string' } },
  { id: 'docs_get_document', category: 'integrations', kind: 'cloud', description: 'Get a Google Docs document', argsTemplate: { documentId: '', profile: '' }, outputSchema: { document: 'object' } },
  { id: 'docs_create_document', category: 'integrations', kind: 'cloud', description: 'Create a new Google Doc', argsTemplate: { title: '', profile: '' }, outputSchema: { document: 'object' } },
  { id: 'docs_write_text', category: 'integrations', kind: 'cloud', description: 'Write text to a Google Doc', argsTemplate: { documentId: '', text: '', profile: '' }, outputSchema: { result: 'object' } },
  { id: 'tasks_list', category: 'integrations', kind: 'cloud', description: 'List Google Tasks', argsTemplate: { tasklist: '', maxResults: 10, profile: '' }, outputSchema: { items: 'any[]', count: 'number' } },
  // Disabled — Meta integrations temporarily hidden (see shared/integration-flags.ts)
  // { id: 'facebook_get_me', category: 'integrations', kind: 'cloud', description: 'Get the connected Facebook profile and managed Pages', argsTemplate: { profile: '' }, outputSchema: { me: 'object', pages: 'any[]', count: 'number' } },
  // { id: 'facebook_list_pages', category: 'integrations', kind: 'cloud', description: 'List Facebook Pages the connected user can manage', argsTemplate: { profile: '' }, outputSchema: { pages: 'any[]', count: 'number' } },
  // { id: 'facebook_list_page_posts', category: 'integrations', kind: 'cloud', description: 'List posts from a Facebook Page', argsTemplate: { page_id: '', limit: 10, profile: '' }, outputSchema: { page: 'object', posts: 'any[]', count: 'number', paging: 'object' } },
  // { id: 'facebook_create_page_post', category: 'integrations', kind: 'cloud', description: 'Create a post on a Facebook Page', argsTemplate: { page_id: '', message: '', link: '', published: true, profile: '' }, outputSchema: { ok: 'boolean', id: 'string', page: 'object', permalink_url: 'string' } },
  // { id: 'instagram_get_me', category: 'integrations', kind: 'cloud', description: 'Get the connected Instagram professional account profile', argsTemplate: { profile: '' }, outputSchema: { me: 'object', userId: 'string' } },
  // { id: 'instagram_list_media', category: 'integrations', kind: 'cloud', description: 'List media from the connected Instagram professional account', argsTemplate: { limit: 10, profile: '' }, outputSchema: { items: 'any[]', count: 'number', paging: 'object' } },
  // { id: 'instagram_publish_media', category: 'integrations', kind: 'cloud', description: 'Publish IMAGE, VIDEO, or REELS media to Instagram from a public URL', argsTemplate: { media_type: 'IMAGE', image_url: '', video_url: '', caption: '', alt_text: '', thumb_offset: 0, profile: '' }, outputSchema: { ok: 'boolean', creation_id: 'string', id: 'string', media_type: 'string' } },
  // { id: 'threads_get_me', category: 'integrations', kind: 'cloud', description: 'Get the connected Threads profile', argsTemplate: { profile: '' }, outputSchema: { me: 'object', userId: 'string' } },
  // { id: 'threads_list_posts', category: 'integrations', kind: 'cloud', description: 'List recent posts from the connected Threads profile', argsTemplate: { limit: 10, profile: '' }, outputSchema: { items: 'any[]', count: 'number', paging: 'object' } },
  // { id: 'threads_publish_post', category: 'integrations', kind: 'cloud', description: 'Publish a text post to Threads', argsTemplate: { text: '', reply_control: 'everyone', profile: '' }, outputSchema: { ok: 'boolean', creation_id: 'string', id: 'string', text: 'string' } },
  // X / Twitter
  { id: 'x_search_tweets', category: 'integrations', kind: 'cloud', description: 'Search recent tweets/posts on X/Twitter matching a query', argsTemplate: { query: '', max_results: 20, profile: '' }, outputSchema: { items: 'any[]', count: 'number', next_token: 'string' } },
  { id: 'x_get_user_timeline', category: 'integrations', kind: 'cloud', description: 'Fetch recent tweets/posts from a specific X/Twitter user timeline by username or user_id', argsTemplate: { username: '', user_id: '', max_results: 20, exclude_replies: false, exclude_retweets: false, profile: '' }, outputSchema: { user_id: 'string', items: 'any[]', count: 'number', next_token: 'string' } },
  { id: 'x_get_tweet', category: 'integrations', kind: 'cloud', description: 'Fetch a single X/Twitter tweet/post by id with author info and metrics', argsTemplate: { id: '', profile: '' }, outputSchema: { id: 'string', text: 'string', author_id: 'string', author: 'object', created_at: 'string', metrics: 'object', lang: 'string', referenced: 'any[]', url: 'string' } },
  { id: 'x_get_comments', category: 'integrations', kind: 'cloud', description: 'Get X/Twitter comments/replies with filters for a post, conversation, or account mentions', argsTemplate: { post_id: '', username: '', query: '', from_username: '', to_username: '', mentioned_username: '', lang: '', only_direct_replies: false, exclude_retweets: true, max_results: 20, since_id: '', profile: '' }, outputSchema: { mode: 'string', items: 'any[]', count: 'number', next_token: 'string', result_count: 'number' } },
  { id: 'x_comment_on_post', category: 'integrations', kind: 'cloud', description: 'Comment on an X/Twitter post by post id', argsTemplate: { post_id: '', text: '', profile: '' }, outputSchema: { id: 'string', text: 'string', in_reply_to_tweet_id: 'string', url: 'string' } },
  { id: 'x_reply_to_comment', category: 'integrations', kind: 'cloud', description: 'Reply to an X/Twitter comment/reply by comment id', argsTemplate: { comment_id: '', text: '', profile: '' }, outputSchema: { id: 'string', text: 'string', in_reply_to_tweet_id: 'string', url: 'string' } },
  { id: 'x_like_comment', category: 'integrations', kind: 'cloud', description: 'Like an X/Twitter comment/reply by id', argsTemplate: { comment_id: '', profile: '' }, outputSchema: { liked: 'boolean', comment_id: 'string', user_id: 'string' } },
  { id: 'x_post_tweet', category: 'integrations', kind: 'cloud', description: 'Post a new tweet/post on X/Twitter. Optionally reply to an existing tweet by passing reply_to_tweet_id', argsTemplate: { text: '', reply_to_tweet_id: '', profile: '' }, outputSchema: { id: 'string', text: 'string', url: 'string' } },
  { id: 'x_delete_tweet', category: 'integrations', kind: 'cloud', description: 'Delete one of your X/Twitter tweets/posts by id', argsTemplate: { id: '', profile: '' }, outputSchema: { deleted: 'boolean' } },
  { id: 'x_send_dm', category: 'integrations', kind: 'cloud', description: 'Send a direct message (DM) on X/Twitter to another user', argsTemplate: { recipient_id: '', recipient_username: '', text: '', profile: '' }, outputSchema: { dm_event_id: 'string', conversation_id: 'string' } },
  { id: 'x_list_dms', category: 'integrations', kind: 'cloud', description: 'List recent X/Twitter direct message (DM) events from the inbox, a conversation, or a 1:1 participant', argsTemplate: { conversation_id: '', participant_id: '', participant_username: '', max_results: 20, pagination_token: '', profile: '' }, outputSchema: { events: 'any[]', count: 'number', result_count: 'number', next_token: 'string', pagination_token: 'string' } },
  { id: 'x_get_user', category: 'integrations', kind: 'cloud', description: 'Look up an X/Twitter user profile by username or user_id', argsTemplate: { username: '', user_id: '', profile: '' }, outputSchema: { id: 'string', username: 'string', name: 'string', description: 'string', verified: 'boolean', location: 'string', profile_image_url: 'string', created_at: 'string', metrics: 'object', url: 'string' } },
  { id: 'x_list_followers', category: 'integrations', kind: 'cloud', description: 'List followers of an X/Twitter user', argsTemplate: { username: '', user_id: '', max_results: 100, profile: '' }, outputSchema: { user_id: 'string', items: 'any[]', count: 'number', next_token: 'string' } },
  { id: 'x_list_following', category: 'integrations', kind: 'cloud', description: 'List the accounts an X/Twitter user is following', argsTemplate: { username: '', user_id: '', max_results: 100, profile: '' }, outputSchema: { user_id: 'string', items: 'any[]', count: 'number', next_token: 'string' } },
  // Telnyx (SMS / Voice — verified number only)
  { id: 'telnyx_send_sms', category: 'integrations', kind: 'cloud', description: 'Send an SMS to the user\'s verified phone number', argsTemplate: { message: '' }, outputSchema: { ok: 'boolean', messageId: 'string', to: 'string', error: 'string' } },
  { id: 'telnyx_call_control', category: 'integrations', kind: 'cloud', description: 'Send a control action (hangup, hold, unhold, speak, playback_stop) to an active Telnyx call', argsTemplate: { call_control_id: '', action: 'hangup' }, outputSchema: { ok: 'boolean', error: 'string' } },
  { id: 'telnyx_phone_status', category: 'integrations', kind: 'cloud', description: 'Check if the user has a verified phone number', argsTemplate: {}, outputSchema: { ok: 'boolean', verified: 'boolean', phone: 'string', error: 'string' } },
  { id: 'telnyx_send_mms', category: 'integrations', kind: 'cloud', description: 'Send an MMS with an image or media file to the user\'s verified phone', argsTemplate: { media_url: '', message: '' }, outputSchema: { ok: 'boolean', messageId: 'string', to: 'string', error: 'string' } },
  { id: 'telnyx_send_voice_note', category: 'integrations', kind: 'cloud', description: 'Generate a voice note with ElevenLabs TTS and send as MMS audio', argsTemplate: { message: '', voice_id: '', model_id: 'eleven_turbo_v2_5' }, outputSchema: { ok: 'boolean', messageId: 'string', audioUrl: 'string', to: 'string', error: 'string' } },
  { id: 'telnyx_voice_call', category: 'integrations', kind: 'cloud', description: 'Make a real-time AI voice call with a selected provider (ElevenLabs, OpenAI Realtime)', argsTemplate: { provider: 'auto', agent_id: '', voice_id: '', initial_message: '', system_prompt: '' }, outputSchema: { ok: 'boolean', callControlId: 'string', to: 'string', provider: 'string', error: 'string' } },
  { id: 'telnyx_list_voice_providers', category: 'integrations', kind: 'cloud', description: 'List available voice providers and their configuration status', argsTemplate: {}, outputSchema: { ok: 'boolean', providers: 'any[]', defaultProvider: 'string' } },
  { id: 'telnyx_list_active_calls', category: 'integrations', kind: 'cloud', description: 'List currently active voice calls with status and duration', argsTemplate: {}, outputSchema: { ok: 'boolean', calls: 'any[]' } },
  { id: 'telnyx_hangup_call', category: 'integrations', kind: 'cloud', description: 'Hang up an active voice call', argsTemplate: { call_control_id: '' }, outputSchema: { ok: 'boolean', error: 'string' } },
  // Disabled — WhatsApp integration temporarily hidden (see shared/integration-flags.ts)
  // { id: 'whatsapp_send_message', category: 'integrations', kind: 'cloud', description: 'Send a WhatsApp text message to the connected number', argsTemplate: { message: '', preview_url: false }, outputSchema: { ok: 'boolean', messageId: 'string', to: 'string', error: 'string' } },
  // { id: 'whatsapp_send_media', category: 'integrations', kind: 'cloud', description: 'Send media to the connected WhatsApp number', argsTemplate: { type: 'image', url: '', caption: '', filename: '' }, outputSchema: { ok: 'boolean', messageId: 'string', to: 'string', error: 'string' } },
  // { id: 'whatsapp_send_reaction', category: 'integrations', kind: 'cloud', description: 'React to a WhatsApp message with an emoji', argsTemplate: { message_id: '', emoji: '👍' }, outputSchema: { ok: 'boolean', error: 'string' } },
  // { id: 'whatsapp_mark_read', category: 'integrations', kind: 'cloud', description: 'Mark a WhatsApp message as read', argsTemplate: { message_id: '' }, outputSchema: { ok: 'boolean', error: 'string' } },
  // { id: 'whatsapp_upload_media', category: 'integrations', kind: 'cloud', description: 'Upload media to WhatsApp servers and get a reusable media ID', argsTemplate: { url: '', mime_type: '' }, outputSchema: { ok: 'boolean', mediaId: 'string', error: 'string' } },
  // { id: 'whatsapp_status', category: 'integrations', kind: 'cloud', description: 'Check whether WhatsApp is connected for the current user', argsTemplate: {}, outputSchema: { ok: 'boolean', connected: 'boolean', phone: 'string', error: 'string' } },
  // { id: 'whatsapp_get_media_url', category: 'integrations', kind: 'cloud', description: 'Get the temporary download URL and metadata for a received WhatsApp media message by its media_id', argsTemplate: { media_id: '' }, outputSchema: { ok: 'boolean', url: 'string', mimeType: 'string', fileSize: 'number', error: 'string' } },
  // { id: 'whatsapp_download_media', category: 'integrations', kind: 'cloud', description: 'Download a received WhatsApp media file (image, audio, video, document) to a local temp file', argsTemplate: { media_id: '', filename: '' }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', fileSize: 'number', error: 'string' } },
  // { id: 'whatsapp_send_voice_note', category: 'integrations', kind: 'cloud', description: 'Generate a voice note with ElevenLabs TTS and send via WhatsApp', argsTemplate: { message: '', voice_id: '', model_id: 'eleven_turbo_v2_5' }, outputSchema: { ok: 'boolean', messageId: 'string', audioUrl: 'string', to: 'string', error: 'string' } },
  // { id: 'whatsapp_transcribe_voice_note', category: 'integrations', kind: 'cloud', description: 'Download and transcribe a received WhatsApp voice note using Whisper', argsTemplate: { media_id: '', language: '' }, outputSchema: { ok: 'boolean', transcript: 'string', language: 'string', duration: 'number', error: 'string' } },
  // { id: 'whatsapp_send_template', category: 'integrations', kind: 'cloud', description: 'Send a pre-approved WhatsApp template message', argsTemplate: { template_name: '', language_code: 'en_US' }, outputSchema: { ok: 'boolean', messageId: 'string', to: 'string', error: 'string' } },
  // { id: 'whatsapp_voice_call', category: 'integrations', kind: 'cloud', description: 'Make a real-time AI voice call to the WhatsApp phone number with provider selection', argsTemplate: { provider: 'auto', agent_id: '', voice_id: '', initial_message: '', system_prompt: '' }, outputSchema: { ok: 'boolean', callControlId: 'string', to: 'string', provider: 'string', error: 'string' } },
  // { id: 'whatsapp_make_call', category: 'integrations', kind: 'cloud', description: 'Call the WhatsApp phone number and speak a message via basic TTS', argsTemplate: { message: '', voice: 'female' }, outputSchema: { ok: 'boolean', callControlId: 'string', to: 'string', error: 'string' } },
  // Disabled — Discord integration temporarily hidden (see shared/integration-flags.ts)
  // { id: 'discord_list_guilds', category: 'integrations', kind: 'cloud', description: 'List Discord servers the user is in', argsTemplate: {}, outputSchema: { guilds: 'any[]', count: 'number' } },
  // { id: 'discord_list_channels', category: 'integrations', kind: 'cloud', description: 'List text channels in a Discord server', argsTemplate: { guild_id: '' }, outputSchema: { channels: 'any[]', count: 'number' } },
  // { id: 'discord_list_dms', category: 'integrations', kind: 'cloud', description: 'List Discord DM conversations', argsTemplate: {}, outputSchema: { dms: 'any[]', count: 'number' } },
  // { id: 'discord_read_messages', category: 'integrations', kind: 'cloud', description: 'Read messages from a Discord channel or DM', argsTemplate: { channel_id: '', limit: 25 }, outputSchema: { messages: 'any[]', count: 'number' } },
  // { id: 'discord_send_dm', category: 'integrations', kind: 'cloud', description: 'Send a direct message on Discord', argsTemplate: { channel_id: '', content: '' }, outputSchema: { sent: 'boolean', id: 'string', content: 'string' } },
  // { id: 'discord_add_reaction', category: 'integrations', kind: 'cloud', description: 'React to a Discord message with an emoji', argsTemplate: { channel_id: '', message_id: '', emoji: '👍' }, outputSchema: { success: 'boolean' } },
  // Disabled — Reddit integration temporarily hidden (see shared/integration-flags.ts)
  // { id: 'reddit_search', category: 'integrations', kind: 'cloud', description: 'Search Reddit for posts globally or within a specific subreddit', argsTemplate: { query: '', subreddit: '', sort: 'relevance', time: 'all', limit: 25, profile: '' }, outputSchema: { items: 'any[]', count: 'number' } },
  // { id: 'reddit_view_subreddit', category: 'integrations', kind: 'cloud', description: 'Browse posts from a subreddit sorted by hot, new, top, or rising', argsTemplate: { subreddit: '', sort: 'hot', time: 'day', limit: 25, profile: '' }, outputSchema: { items: 'any[]', count: 'number' } },
  // { id: 'reddit_view_comments', category: 'integrations', kind: 'cloud', description: 'View comments on a Reddit post with sorting options', argsTemplate: { subreddit: '', post_id: '', sort: 'confidence', limit: 25, profile: '' }, outputSchema: { post: 'object', comments: 'any[]' } },
  // { id: 'reddit_create_post', category: 'integrations', kind: 'cloud', description: 'Create a text or link post on a subreddit', argsTemplate: { subreddit: '', title: '', kind: 'self', text: '', url: '', profile: '' }, outputSchema: { success: 'boolean', id: 'string', url: 'string', errors: 'any[]' } },
  // { id: 'reddit_comment', category: 'integrations', kind: 'cloud', description: 'Comment on a Reddit post or reply to a comment (use t3_id for posts, t1_id for comments)', argsTemplate: { thing_id: '', text: '', profile: '' }, outputSchema: { success: 'boolean', id: 'string', errors: 'any[]' } },
  // YouTube
  { id: 'youtube_get_video', category: 'integrations', kind: 'cloud', description: 'Get detailed information about a YouTube video', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', video: 'object', error: 'string' } },
  { id: 'youtube_get_channel', category: 'integrations', kind: 'cloud', description: 'Get information about a YouTube channel', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', channel: 'object', error: 'string' } },
  { id: 'youtube_get_playlist', category: 'integrations', kind: 'cloud', description: 'Get information about a YouTube playlist', argsTemplate: { url: '', maxVideos: 10 }, outputSchema: { ok: 'boolean', playlist: 'object', videos: 'any[]', error: 'string' } },
  { id: 'youtube_search', category: 'integrations', kind: 'cloud', description: 'Search YouTube for videos, channels, or playlists', argsTemplate: { query: '', type: 'video', maxResults: 5 }, outputSchema: { ok: 'boolean', results: 'any[]', error: 'string' } },
  { id: 'youtube_parse_url', category: 'integrations', kind: 'cloud', description: 'Parse a YouTube URL and identify content type', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', type: 'string', id: 'string' } },
  { id: 'search_marketplace', category: 'integrations', kind: 'cloud', description: 'Search the Stuard workflow marketplace', argsTemplate: { query: '', category: '', limit: 10 }, outputSchema: { ok: 'boolean', results: 'any[]', count: 'number' } },
  { id: 'get_marketplace_workflow', category: 'integrations', kind: 'cloud', description: 'Retrieve a workflow from the marketplace by slug', argsTemplate: { slug: '' }, outputSchema: { ok: 'boolean', workflow: 'object' } },
  { id: 'list_popular_workflows', category: 'integrations', kind: 'cloud', description: 'List popular workflows from the marketplace', argsTemplate: { category: '', sort_by: 'downloads', limit: 10 }, outputSchema: { ok: 'boolean', workflows: 'any[]', count: 'number' } },
  { id: 'list_marketplace_categories', category: 'integrations', kind: 'cloud', description: 'List all available workflow categories', argsTemplate: {}, outputSchema: { ok: 'boolean', categories: 'any[]' } },

  // --- DATA / TASKS ---
  { id: 'task_crud', category: 'data', kind: 'local', description: 'Create/Read/Update/Delete tasks', argsTemplate: { action: 'create', task: {} }, outputSchema: { ok: 'boolean', task: 'object' } },
  { id: 'task_reminders', category: 'data', kind: 'local', description: 'Schedule/List reminders', argsTemplate: { action: 'schedule', taskId: '', time: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'planner_list_items', category: 'data', kind: 'local', description: 'Get unified list of tasks/reminders', argsTemplate: { start: '', end: '' }, outputSchema: { items: 'any[]' } },
  { id: 'agent_todo', category: 'data', kind: 'local', description: 'Agent internal todo list for tracking long-running tasks (session-scoped)', argsTemplate: { action: 'list', sessionId: '', data: {} }, outputSchema: { ok: 'boolean', items: 'any[]', todo: 'object', progress: 'object', count: 'number' } },

  // --- VARIABLES ---
  { id: 'set_variable', category: 'data', kind: 'local', description: 'Set a variable. workflow.* variables are shared across all stuard files in the current workflow. local.* variables are scoped to this stuard file only.', argsTemplate: { name: '', value: '', scope: 'workflow', notifyUi: true }, outputSchema: { ok: 'boolean' } },
  { id: 'get_variable', category: 'data', kind: 'local', description: 'Get a variable value. workflow.* variables are shared across the workflow, local.* variables are file-scoped.', argsTemplate: { name: '', default: '' }, outputSchema: { ok: 'boolean', value: 'any' } },
  { id: 'delete_variable', category: 'data', kind: 'local', description: 'Delete a stored variable', argsTemplate: { name: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'toggle_variable', category: 'data', kind: 'local', description: 'Toggle a boolean variable (workflow.* for workflow-scoped, local.* for file-scoped)', argsTemplate: { name: '', notifyUi: true }, outputSchema: { ok: 'boolean', value: 'boolean' } },
  { id: 'increment_variable', category: 'data', kind: 'local', description: 'Increment a numeric variable (workflow.* for workflow-scoped, local.* for file-scoped)', argsTemplate: { name: '', amount: 1, notifyUi: true }, outputSchema: { ok: 'boolean', value: 'number' } },
  { id: 'append_to_list', category: 'data', kind: 'local', description: 'Append an item to a list variable (workflow.* for workflow-scoped, local.* for file-scoped)', argsTemplate: { name: '', item: '', notifyUi: true }, outputSchema: { ok: 'boolean', value: 'any[]' } },

  // --- DATABASE ---
  { id: 'db_store', category: 'data', kind: 'local', description: 'Save a document (JSON data) into a collection. Auto-creates the collection if needed.', argsTemplate: { table: 'my_collection', id: '', data: { name: '', value: '' } }, outputSchema: { ok: 'boolean', id: 'string', table: 'string', error: 'string' } },
  { id: 'db_retrieve', category: 'data', kind: 'local', description: 'Get a single document by its ID from a collection.', argsTemplate: { table: 'my_collection', id: '' }, outputSchema: { ok: 'boolean', result: 'any', created_at: 'string', updated_at: 'string', error: 'string' } },
  { id: 'db_search', category: 'data', kind: 'local', description: 'Search for documents in a collection. Optionally filter by field values.', argsTemplate: { table: 'my_collection', filters: {}, limit: 100 }, outputSchema: { ok: 'boolean', results: 'any[]', count: 'number', error: 'string' } },
  { id: 'db_delete', category: 'data', kind: 'local', description: 'Delete a document by its ID from a collection.', argsTemplate: { table: 'my_collection', id: '' }, outputSchema: { ok: 'boolean', deleted: 'boolean', error: 'string' } },
  { id: 'db_query', category: 'data', kind: 'local', description: 'Run a raw SQL query against the local workflow database. Use ? for parameter placeholders.', argsTemplate: { query: 'SELECT * FROM my_table LIMIT 10', params: [] }, outputSchema: { ok: 'boolean', results: 'any[]', count: 'number', affected_rows: 'number', error: 'string' } },
  { id: 'db_list_tables', category: 'data', kind: 'local', description: 'List all tables and collections in the workflow database.', argsTemplate: {}, outputSchema: { ok: 'boolean', tables: 'string[]', count: 'number', error: 'string' } },

  // --- MEMORY / KNOWLEDGE ---
  { id: 'memory_retrieval', category: 'data', kind: 'cloud', description: 'Retrieve stored memories and facts', argsTemplate: { query: '' }, outputSchema: { ok: 'boolean', memories: 'any[]', facts: 'any[]' } },

  // --- HTTP ---
  { id: 'http_request', category: 'data', kind: 'local', description: 'Make HTTP requests to APIs and web services', argsTemplate: { url: 'https://httpbin.org/anything', method: 'GET', headers: {}, query: {}, body: '', bearer_token: '', timeout: 30, follow_redirects: true, verify_ssl: true, retries: 0 }, outputSchema: { ok: 'boolean', status: 'number', statusText: 'string', headers: 'object', body: 'any', elapsed: 'number' } },

  // --- MATH ---
  { id: 'math_add', category: 'core', kind: 'local', description: 'Add two numbers (a + b)', argsTemplate: { a: 0, b: 0 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_subtract', category: 'core', kind: 'local', description: 'Subtract two numbers (a - b)', argsTemplate: { a: 0, b: 0 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_multiply', category: 'core', kind: 'local', description: 'Multiply two numbers (a × b)', argsTemplate: { a: 0, b: 0 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_divide', category: 'core', kind: 'local', description: 'Divide two numbers (a ÷ b)', argsTemplate: { a: 0, b: 1 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_power', category: 'core', kind: 'local', description: 'Raise a to the power of b', argsTemplate: { a: 2, b: 2 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_sqrt', category: 'core', kind: 'local', description: 'Square root of x', argsTemplate: { x: 4 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_abs', category: 'core', kind: 'local', description: 'Absolute value of x', argsTemplate: { x: -5 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_random', category: 'core', kind: 'local', description: 'Generate a random number between min and max', argsTemplate: { min: 1, max: 10 }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_sum', category: 'core', kind: 'local', description: 'Sum all numbers in a list', argsTemplate: { x: [1, 2, 3] }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_mean', category: 'core', kind: 'local', description: 'Average of numbers in a list', argsTemplate: { x: [1, 2, 3] }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_max', category: 'core', kind: 'local', description: 'Maximum value in a list', argsTemplate: { x: [1, 5, 3] }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_min', category: 'core', kind: 'local', description: 'Minimum value in a list', argsTemplate: { x: [1, 5, 3] }, outputSchema: { ok: 'boolean', result: 'number' } },
  { id: 'math_compare', category: 'core', kind: 'local', description: 'Compare two numbers', argsTemplate: { a: 5, b: 3, op: 'gt' }, outputSchema: { ok: 'boolean', result: 'boolean' } },
  { id: 'math_range', category: 'core', kind: 'local', description: 'Generate a range of numbers', argsTemplate: { start: 1, stop: 10 }, outputSchema: { ok: 'boolean', result: 'number[]' } },

  // --- STREAMING (Advanced — most streaming via stream:true on AI/HTTP/Script tools) ---
  { id: 'stream_create', category: 'data', kind: 'local', description: 'Create a new data stream for manual stream control', argsTemplate: { kind: 'bytes', bufferSize: 500 }, outputSchema: { ok: 'boolean', streamId: 'string' } },
  { id: 'stream_close', category: 'data', kind: 'local', description: 'Close a stream and signal end-of-data', argsTemplate: { streamId: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'stream_list', category: 'data', kind: 'local', description: 'List all active streams', argsTemplate: {}, outputSchema: { ok: 'boolean', streams: 'any[]' } },
  { id: 'stream_get_status', category: 'data', kind: 'local', description: 'Get stream status and stats', argsTemplate: { streamId: '' }, outputSchema: { ok: 'boolean', stream: 'object' } },

  // --- VISION (cloud) ---
  { id: 'cloud_ai_vision', category: 'vision', kind: 'cloud', description: 'Analyze an image with AI vision and return structured JSON', argsTemplate: { prompt: '', imagePath: '', schema: {} }, outputSchema: { ok: 'boolean', json: 'any', text: 'string' } },

  // --- BROWSER (Stuard Browser automation) ---
  { id: 'browser_use_status', category: 'system', kind: 'local', description: 'Check if Stuard Browser is installed and the browser server is running', argsTemplate: {}, outputSchema: { ok: 'boolean', installed: 'boolean', running: 'boolean', serverAlive: 'boolean', mode: 'string', profile: 'string', profileDir: 'string', currentUrl: 'string', title: 'string', sessionId: 'string', hasPython: 'boolean', error: 'string' } },
  { id: 'browser_use_configure', category: 'system', kind: 'local', description: 'Configure browser mode (headed or headless)', argsTemplate: { mode: 'headed', profile: 'default' }, outputSchema: { ok: 'boolean', mode: 'string', profile: 'string', restarted: 'boolean', error: 'string' } },
  { id: 'browser_use_navigate', category: 'system', kind: 'local', description: 'Navigate the browser to a URL and wait for the page to load', argsTemplate: { url: 'https://example.com', wait_until: 'domcontentloaded', timeout: 30000, wait_for_selector: '' }, outputSchema: { ok: 'boolean', url: 'string', title: 'string', error: 'string' } },
  { id: 'browser_use_click', category: 'system', kind: 'local', description: 'Click an element on the page by CSS selector or visible text', argsTemplate: { selector: '', text: '', exact: false, timeout: 5000 }, outputSchema: { ok: 'boolean', clicked: 'string', method: 'string', error: 'string' } },
  { id: 'browser_use_type', category: 'system', kind: 'local', description: 'Type text into an input field or the active element. Works with React, Vue, Angular.', argsTemplate: { selector: '', text: '', clear: true, timeout: 5000 }, outputSchema: { ok: 'boolean', typed: 'number', method: 'string', error: 'string' } },
  { id: 'browser_use_press_key', category: 'system', kind: 'local', description: 'Press a keyboard key in the browser (Enter, Tab, Escape, ArrowDown, etc.)', argsTemplate: { key: 'Enter', selector: '' }, outputSchema: { ok: 'boolean', key: 'string', error: 'string' } },
  { id: 'browser_use_screenshot', category: 'system', kind: 'local', description: 'Take a screenshot of the current browser page', argsTemplate: { full_page: false }, outputSchema: { ok: 'boolean', image_path: 'string', screenshot_path: 'string', format: 'string', url: 'string', width: 'number', height: 'number', error: 'string' } },
  { id: 'browser_use_content', category: 'system', kind: 'local', description: 'Get the text or HTML content visible in the current viewport', argsTemplate: { mode: 'text', max_length: 15000, wait_for_selector: '', wait_timeout: 5000 }, outputSchema: { ok: 'boolean', url: 'string', title: 'string', content: 'string', mode: 'string', error: 'string' } },
  { id: 'browser_use_scroll', category: 'system', kind: 'local', description: 'Scroll the page or a specific element in any direction', argsTemplate: { direction: 'down', amount: 500, selector: '' }, outputSchema: { ok: 'boolean', direction: 'string', amount: 'number', error: 'string' } },
  { id: 'browser_use_tabs', category: 'system', kind: 'local', description: 'Manage browser tabs: list, open new, switch, or close tabs', argsTemplate: { action: 'list', index: 0, url: '' }, outputSchema: { ok: 'boolean', tabs: 'array', count: 'number', url: 'string', title: 'string', closed: 'number', remaining: 'number', error: 'string' } },
  { id: 'browser_use_cookies', category: 'system', kind: 'local', description: 'Manage browser cookies: get, set, clear, export, or import cookies', argsTemplate: { action: 'get', cookies: [], urls: [], path: '' }, outputSchema: { ok: 'boolean', cookies: 'array', count: 'number', set: 'number', cleared: 'boolean', exported: 'number', imported: 'number', error: 'string' } },
  { id: 'browser_use_execute_script', category: 'system', kind: 'local', description: 'Execute JavaScript in the browser page context. Best for DOM extraction or complex page logic.', argsTemplate: { script: 'return document.title;', args: {}, wait_for_selector: '', wait_timeout: 5000, timeout: 30000 }, outputSchema: { ok: 'boolean', result: 'any', url: 'string', title: 'string', elapsedMs: 'number', error: 'string' } },
  { id: 'browser_use_hover', category: 'system', kind: 'local', description: 'Hover over an element to reveal tooltips, menus, or hover-triggered content', argsTemplate: { selector: '', text: '', timeout: 5000 }, outputSchema: { ok: 'boolean', hovered: 'string', method: 'string', error: 'string' } },
  { id: 'browser_use_select_option', category: 'system', kind: 'local', description: 'Select an option from a dropdown, including native <select> and many custom combobox/listbox controls', argsTemplate: { selector: '', value: '', label: '', index: 0, timeout: 5000 }, outputSchema: { ok: 'boolean', selected: 'any', text: 'string', method: 'string', error: 'string' } },
  { id: 'browser_use_get_dropdown_options', category: 'system', kind: 'local', description: 'Read all available options from a dropdown or select element without selecting anything. Use before select_option to see what choices exist.', argsTemplate: { selector: '', timeout: 5000 }, outputSchema: { ok: 'boolean', type: 'string', options: 'array', optionCount: 'number', selectedIndex: 'number', selectedText: 'string', error: 'string' } },
  { id: 'browser_use_get_interactive_elements', category: 'system', kind: 'local', description: 'Get all interactive elements on the page, including dropdowns and file inputs. Returns selectors, control types, labels, values, and form associations.', argsTemplate: { wait_for_selector: '', wait_timeout: 3000 }, outputSchema: { ok: 'boolean', url: 'string', title: 'string', elements: 'array', forms: 'array', elementCount: 'number', formCount: 'number', error: 'string' } },
  { id: 'browser_use_fill_form', category: 'system', kind: 'local', description: 'Fill multiple form fields at once and optionally submit. Supports text fields, dropdowns, toggles, and file paths when type is "file".', argsTemplate: { fields: {}, submit: false, form_selector: '' }, outputSchema: { ok: 'boolean', filled: 'number', total: 'number', submitted: 'boolean', errors: 'array', error: 'string' } },
  { id: 'browser_use_upload_file', category: 'system', kind: 'local', description: 'Upload a local file from disk into a browser file input', argsTemplate: { selector: '', filePath: '', timeout: 5000 }, outputSchema: { ok: 'boolean', uploaded: 'boolean', filePath: 'string', fileName: 'string', selector: 'string', method: 'string', error: 'string' } },
  { id: 'browser_use_wait_for', category: 'system', kind: 'local', description: 'Wait for an element, text, or URL change before proceeding. Essential for SPAs and dynamic pages.', argsTemplate: { selector: '', text: '', url_pattern: '', state: 'visible', timeout: 10000 }, outputSchema: { ok: 'boolean', matched: 'boolean', url: 'string', type: 'string', error: 'string' } },
];

const TRIGGER_DEFINITIONS = [
  { type: 'manual', description: 'Manual trigger - user clicks run. Supports inputParams for user input forms.', argsTemplate: {}, inputParams: [] },
  { type: 'app_start', description: 'Application startup trigger - fires once when Stuard launches after the local Python agent is ready.', argsTemplate: {} },
  { type: 'function', description: 'Function trigger - allows this workflow to be called from other workflows with input parameters', argsTemplate: {}, inputParams: [] },
  { type: 'webhook', description: 'Webhook trigger - receive HTTP POST requests to trigger this workflow', argsTemplate: { mode: 'cloud' } },
  { type: 'webhook.local', description: 'Local webhook trigger (legacy)', argsTemplate: { mode: 'local' } },
  { type: 'webhook.cloud', description: 'Cloud webhook trigger (legacy)', argsTemplate: { mode: 'cloud' } },
  { type: 'gmail.new_email', description: 'Native Gmail push trigger for new emails (Google watch/PubSub)', argsTemplate: { profile: 'default', labelIds: ['INBOX'] } },
  { type: 'drive.new_file', description: 'Native Google Drive push trigger for newly uploaded files', argsTemplate: { profile: 'default', onlyNew: true, includeFolders: false } },
  { type: 'x.new_mention', description: 'Native X (Twitter) webhook trigger — fires when someone @-mentions you', argsTemplate: { profile: 'default' } },
  { type: 'x.new_comment', description: 'Native X (Twitter) webhook trigger — fires when someone replies to your post (no @-mention required)', argsTemplate: { profile: 'default', post_id: '', only_direct_post_replies: false, from_username: '', contains_text: '' } },
  { type: 'x.new_dm', description: 'Native X (Twitter) webhook trigger — fires on a new direct message', argsTemplate: { profile: 'default' } },
  { type: 'x.new_follower', description: 'Native X (Twitter) webhook trigger — fires when you gain a new follower', argsTemplate: { profile: 'default' } },
  { type: 'x.user_post', description: 'Native X (Twitter) webhook trigger — fires when you publish a new post', argsTemplate: { profile: 'default' } },
  { type: 'instagram.new_comment', description: 'Native Instagram webhook trigger — fires on a new comment on your media', argsTemplate: { profile: 'default' } },
  { type: 'instagram.new_mention', description: 'Native Instagram webhook trigger — fires when your account is @-mentioned', argsTemplate: { profile: 'default' } },
  { type: 'instagram.new_message', description: 'Native Instagram webhook trigger — fires on a new direct message (DM)', argsTemplate: { profile: 'default' } },
  { type: 'schedule.cron', description: 'Cron schedule trigger', argsTemplate: { cron: '* * * * *' } },
  { type: 'hotkey', description: 'Global hotkey trigger. Enable hold to fire on both press and release.', argsTemplate: { accelerator: 'Ctrl+Alt+K', passthrough: false, hold: false } },
  { type: 'hotkey.release', description: 'Fires only when the key is released. Pair with a hotkey trigger for hold-to-record patterns.', argsTemplate: { accelerator: 'Ctrl+Alt+K' } },
  { type: 'fs.watch', description: 'File/Folder watch trigger - fires when files are created, modified, or deleted', argsTemplate: { path: '', pattern: '*.*', recursive: true, events: ['add', 'change', 'unlink'] } },
  { type: 'keystroke', description: 'Keystroke sequence trigger (type a word)', argsTemplate: { sequence: 'stuard' } },
];

// ============================================================================
// SCHEMA GENERATION
// ============================================================================

// Common options for select fields
const MOUSE_BUTTON_OPTIONS: ArgOption[] = [
  { value: 'left', label: 'Left', description: 'Primary click' },
  { value: 'right', label: 'Right', description: 'Context menu' },
  { value: 'middle', label: 'Middle', description: 'Scroll wheel click' },
];

const SHELL_OPTIONS: ArgOption[] = [
  { value: 'auto', label: 'Auto', description: 'Detect best shell' },
  { value: 'cmd', label: 'CMD', description: 'Windows Command Prompt' },
  { value: 'powershell', label: 'PowerShell', description: 'Windows PowerShell' },
  { value: 'bash', label: 'Bash', description: 'Unix/Linux Bash' },
];

const TTS_VOICE_OPTIONS: ArgOption[] = [
  { value: 'alloy', label: 'Alloy', description: 'Neutral, balanced voice' },
  { value: 'echo', label: 'Echo', description: 'Male voice' },
  { value: 'fable', label: 'Fable', description: 'British accent' },
  { value: 'onyx', label: 'Onyx', description: 'Deep male voice' },
  { value: 'nova', label: 'Nova', description: 'Female voice' },
  { value: 'shimmer', label: 'Shimmer', description: 'Soft female voice' },
];

const CAPTURE_MODE_OPTIONS: ArgOption[] = [
  { value: 'fixed', label: 'Fixed Duration', description: 'Record for a set time' },
  { value: 'until_stop', label: 'Until Stop', description: 'Record until stop_capture is called' },
  { value: 'silence', label: 'Until Silence', description: 'Record until silence is detected (audio only)' },
  { value: 'stream', label: 'Stream', description: 'Emit live chunks via stream wire' },
];

const MEDIA_KIND_OPTIONS: ArgOption[] = [
  { value: 'photo', label: 'Photo', description: 'Take a still image' },
  { value: 'video', label: 'Video', description: 'Record video only' },
  { value: 'audio', label: 'Audio', description: 'Record audio only' },
  { value: 'audiovideo', label: 'Audio + Video', description: 'Record both audio and video together' },
];

const AUDIO_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'mp3', label: 'MP3', description: 'Compressed audio' },
  { value: 'wav', label: 'WAV', description: 'Uncompressed audio' },
  { value: 'opus', label: 'Opus', description: 'High quality compressed' },
];

const RECORDING_AUDIO_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'wav', label: 'WAV', description: 'Best for editing or transcription' },
  { value: 'mp3', label: 'MP3', description: 'Smaller file size' },
];

const TTS_AUDIO_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'mp3', label: 'MP3', description: 'Small, widely compatible audio' },
  { value: 'wav', label: 'WAV', description: 'Uncompressed audio' },
  { value: 'opus', label: 'Opus', description: 'High quality compressed audio' },
  { value: 'aac', label: 'AAC', description: 'Good for Apple/mobile playback' },
  { value: 'flac', label: 'FLAC', description: 'Lossless compressed audio' },
];

const DATE_TIME_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'dddd, MMMM D [at] h:mm A', label: 'Friendly Date + Time', description: 'Wednesday, May 13 at 9:30 PM' },
  { value: 'dddd, MMMM D, YYYY', label: 'Date in Words', description: 'Wednesday, May 13, 2026' },
  { value: 'YYYY-MM-DD HH:mm:ss', label: 'Sortable Date + Time', description: '2026-05-13 21:30:00' },
  { value: 'YYYY-MM-DD', label: 'Date Only', description: '2026-05-13' },
  { value: 'h:mm A', label: 'Time Only', description: '9:30 PM' },
  { value: 'iso', label: 'Automation Timestamp', description: 'Best for saving, sorting, and comparing' },
];

const ANALYZE_MODE_OPTIONS: ArgOption[] = [
  { value: 'text', label: 'Text', description: 'Return plain text response' },
  { value: 'json', label: 'JSON', description: 'Return structured JSON' },
  { value: 'boolean', label: 'Boolean', description: 'Return true/false' },
];

const AI_INFERENCE_MODE_OPTIONS: ArgOption[] = [
  { value: 'text', label: 'Text', description: 'Return plain text' },
  { value: 'json', label: 'JSON', description: 'Return structured JSON (use with schema)' },
  { value: 'embedding', label: 'Embedding', description: 'Return vector embeddings' },
  { value: 'transcription', label: 'Transcription', description: 'Speech-to-text (Whisper) — audio source → transcript' },
];

// Speech-to-text models for `transcription` mode in ai_inference.
// OpenRouter STT models (everything except `elevenlabs/*`) are fetched live from
// https://openrouter.ai/api/v1/models?output_modalities=transcription — see
// useTranscriptionModelOptions() in SmartArgEditor. The hardcoded list below is
// the fallback shown before the network call resolves AND the source-of-truth for
// ElevenLabs models, which route through a separate direct API (no Scribe v3 yet
// — Scribe v2 batch + Scribe v2 Realtime are the latest as of May 2026).
const TRANSCRIPTION_MODEL_OPTIONS: ArgOption[] = [
  // ─── Tiny seed list (replaced once the OpenRouter fetch returns) ──────
  { value: 'openai/whisper-1', label: 'Whisper v1 (OpenAI)', description: 'Multilingual Whisper — full OpenRouter STT catalog loads live', group: 'OpenRouter STT' },
  // ─── ElevenLabs (direct, requires ELEVENLABS_API_KEY — not on OpenRouter) ──
  { value: 'elevenlabs/scribe_v2', label: 'Scribe v2 (ElevenLabs)', description: 'Most accurate ElevenLabs STT — 90+ languages, word-level timestamps, diarization', group: 'ElevenLabs (direct)' },
  { value: 'elevenlabs/scribe_v1', label: 'Scribe v1 (ElevenLabs)', description: 'Original Scribe — 98%+ accuracy across 99 languages', group: 'ElevenLabs (direct)' },
];

const ANALYZE_MEDIA_MODE_OPTIONS: ArgOption[] = [
  { value: 'fast', label: 'Fast', description: 'Quick analysis, lower cost' },
  { value: 'detailed', label: 'Detailed', description: 'Thorough analysis, higher quality' },
  { value: 'custom', label: 'Custom', description: 'Pick a specific AI model from the full OpenRouter catalog' },
];

const FILE_EDIT_MODE_OPTIONS: ArgOption[] = [
  { value: 'replace', label: 'Replace', description: 'Replace lines in range' },
  { value: 'delete', label: 'Delete', description: 'Delete lines in range' },
  { value: 'add', label: 'Add', description: 'Insert lines at position' },
];

const MODEL_OPTIONS: ArgOption[] = [
  { value: 'fast', label: 'Fast (Gemini Flash)', description: 'Gemini 2.5 Flash — fast and cheap' },
  { value: 'quality', label: 'Quality (GPT-4.1 Mini)', description: 'GPT-4.1 Mini — higher quality' },
  { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'OpenAI GPT-4.1 Mini' },
  { value: 'openai/gpt-4.1', label: 'GPT-4.1', description: 'OpenAI GPT-4.1' },
  { value: 'openai/gpt-4o', label: 'GPT-4o', description: 'OpenAI GPT-4o' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', description: 'OpenAI GPT-4o Mini' },
  { value: 'openai/o3-mini', label: 'o3-mini', description: 'OpenAI o3-mini reasoning' },
  { value: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'OpenAI GPT-5.2 Codex — advanced coding' },
  { value: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'OpenAI GPT-5.3 Codex' },
  { value: 'openai/text-embedding-3-large', label: 'Text Embedding 3 Large', description: 'OpenAI Text Embedding 3 Large' },
  { value: 'openai/text-embedding-3-small', label: 'Text Embedding 3 Small', description: 'OpenAI Text Embedding 3 Small' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Google Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google Gemini 2.5 Pro' },
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: 'Google Gemini 3.1 Pro Preview' },
  { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Anthropic Claude Sonnet 4' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', description: 'Anthropic Claude 3.5 Haiku — fast' },
  { value: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI GPT-5.4' },
  { value: 'openai/gpt-5.2', label: 'GPT-5.2', description: 'OpenAI GPT-5.2' },
];

const SCREEN_TARGET_OPTIONS: ArgOption[] = [
  { value: 'fullscreen', label: 'Full Screen', description: 'Capture all monitors' },
  { value: 'monitor', label: 'Monitor', description: 'Capture a specific monitor' },
  { value: 'window', label: 'Window', description: 'Capture a specific window' },
  { value: 'region', label: 'Region', description: 'Capture a custom region' },
];

const SCREEN_QUALITY_OPTIONS: ArgOption[] = [
  { value: 'low', label: 'Low', description: '720p, lower bitrate' },
  { value: 'medium', label: 'Medium', description: '1080p, balanced' },
  { value: 'high', label: 'High', description: 'Native resolution, high bitrate' },
];

const SEVERITY_OPTIONS: ArgOption[] = [
  { value: 'info', label: 'Info', description: 'Informational notification' },
  { value: 'success', label: 'Success', description: 'Success notification' },
  { value: 'warning', label: 'Warning', description: 'Warning notification' },
  { value: 'error', label: 'Error', description: 'Error notification' },
  { value: 'neutral', label: 'Neutral', description: 'Subtle neutral notification' },
];

const HTTP_METHOD_OPTIONS: ArgOption[] = [
  { value: 'GET', label: 'GET', description: 'Retrieve data' },
  { value: 'POST', label: 'POST', description: 'Send data' },
  { value: 'PUT', label: 'PUT', description: 'Replace data' },
  { value: 'PATCH', label: 'PATCH', description: 'Partial update' },
  { value: 'DELETE', label: 'DELETE', description: 'Delete data' },
  { value: 'HEAD', label: 'HEAD', description: 'Headers only' },
];

const COMPARE_OP_OPTIONS: ArgOption[] = [
  { value: 'eq', label: '= Equal', description: 'a equals b' },
  { value: 'ne', label: '≠ Not Equal', description: 'a not equal to b' },
  { value: 'gt', label: '> Greater Than', description: 'a greater than b' },
  { value: 'gte', label: '≥ Greater or Equal', description: 'a greater than or equal to b' },
  { value: 'lt', label: '< Less Than', description: 'a less than b' },
  { value: 'lte', label: '≤ Less or Equal', description: 'a less than or equal to b' },
];

const VARIABLE_SCOPE_OPTIONS: ArgOption[] = [
  { value: 'workflow', label: 'Workflow', description: 'Shared across all stuard files in this workflow' },
  { value: 'local', label: 'Local', description: 'Scoped to this stuard file only' },
];

const STREAM_KIND_OPTIONS: ArgOption[] = [
  { value: 'bytes', label: 'Bytes', description: 'Raw byte data' },
  { value: 'json', label: 'JSON', description: 'Structured JSON chunks' },
  { value: 'text', label: 'Text', description: 'Plain text chunks' },
];

// Ollama model options - common models users can select
const OLLAMA_CHAT_MODEL_OPTIONS: ArgOption[] = [
  { value: 'llama3.2', label: 'Llama 3.2 (3B)', description: 'Meta Llama 3.2 — fast, good quality', group: 'Chat' },
  { value: 'llama3.2:1b', label: 'Llama 3.2 (1B)', description: 'Smallest Llama — very fast', group: 'Chat' },
  { value: 'llama3.3', label: 'Llama 3.3 (70B)', description: 'Large Llama — highest quality', group: 'Chat' },
  { value: 'mistral', label: 'Mistral (7B)', description: 'Mistral AI — fast and capable', group: 'Chat' },
  { value: 'mixtral', label: 'Mixtral (8x7B)', description: 'Mixture of experts — powerful', group: 'Chat' },
  { value: 'gemma2', label: 'Gemma 2 (9B)', description: 'Google Gemma 2 — balanced', group: 'Chat' },
  { value: 'gemma2:2b', label: 'Gemma 2 (2B)', description: 'Google Gemma 2 — lightweight', group: 'Chat' },
  { value: 'qwen2.5', label: 'Qwen 2.5 (7B)', description: 'Alibaba Qwen — multilingual', group: 'Chat' },
  { value: 'phi3', label: 'Phi-3 (3.8B)', description: 'Microsoft Phi-3 — compact powerhouse', group: 'Chat' },
  { value: 'deepseek-r1', label: 'DeepSeek R1', description: 'Reasoning model — shows thinking process', group: 'Reasoning' },
  { value: 'deepseek-r1:7b', label: 'DeepSeek R1 (7B)', description: 'Smaller reasoning model', group: 'Reasoning' },
  { value: 'deepseek-r1:1.5b', label: 'DeepSeek R1 (1.5B)', description: 'Tiny reasoning model — fast', group: 'Reasoning' },
  { value: 'qwq', label: 'QwQ (32B)', description: 'Alibaba reasoning model', group: 'Reasoning' },
  { value: 'deepseek-coder-v2', label: 'DeepSeek Coder V2', description: 'Coding specialist', group: 'Code' },
  { value: 'codellama', label: 'Code Llama (7B)', description: 'Meta coding model', group: 'Code' },
  { value: 'starcoder2', label: 'StarCoder 2 (3B)', description: 'BigCode coding model', group: 'Code' },
];

const OLLAMA_VISION_MODEL_OPTIONS: ArgOption[] = [
  { value: 'llava', label: 'LLaVA (7B)', description: 'Vision-language model — image understanding', group: 'Vision' },
  { value: 'llava:13b', label: 'LLaVA (13B)', description: 'Larger LLaVA — better quality', group: 'Vision' },
  { value: 'llava-llama3', label: 'LLaVA-Llama3', description: 'LLaVA with Llama 3 backend', group: 'Vision' },
  { value: 'bakllava', label: 'BakLLaVA', description: 'Improved LLaVA variant', group: 'Vision' },
  { value: 'moondream', label: 'Moondream (1.8B)', description: 'Tiny but capable vision model', group: 'Vision' },
];

const OLLAMA_EMBEDDING_MODEL_OPTIONS: ArgOption[] = [
  { value: 'nomic-embed-text', label: 'Nomic Embed Text', description: 'High quality text embeddings (768d)', group: 'Embedding' },
  { value: 'mxbai-embed-large', label: 'MixedBread Large', description: 'Large embedding model (1024d)', group: 'Embedding' },
  { value: 'all-minilm', label: 'All-MiniLM (384d)', description: 'Fast, compact embeddings', group: 'Embedding' },
  { value: 'snowflake-arctic-embed', label: 'Snowflake Arctic', description: 'Snowflake embedding model', group: 'Embedding' },
];

const OLLAMA_MODEL_ACTION_OPTIONS: ArgOption[] = [
  { value: 'list', label: 'List Models', description: 'Show all downloaded models' },
  { value: 'pull', label: 'Pull / Download', description: 'Download a model from Ollama library' },
  { value: 'delete', label: 'Delete', description: 'Remove a model from disk' },
  { value: 'show', label: 'Show Details', description: 'Get model info and parameters' },
  { value: 'running', label: 'List Running', description: 'Show currently loaded models' },
  { value: 'copy', label: 'Copy / Rename', description: 'Duplicate a model with a new name' },
];

// Note: STREAM_API_METHOD_OPTIONS and STREAM_TRANSFORM_TYPE_OPTIONS removed
// — those tools are now engine-internal, not user-facing

const TASK_ACTION_OPTIONS: ArgOption[] = [
  { value: 'create', label: 'Create', description: 'Create a new task' },
  { value: 'read', label: 'Read', description: 'Read a task' },
  { value: 'update', label: 'Update', description: 'Update a task' },
  { value: 'delete', label: 'Delete', description: 'Delete a task' },
  { value: 'list', label: 'List', description: 'List all tasks' },
];

const VARIANT_OPTIONS: ArgOption[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'default', label: 'Default' },
];

const LINK_PREVIEW_VARIANT_OPTIONS: ArgOption[] = [
  { value: 'large', label: 'Large Preview', description: 'Room for image, title, and summary' },
  { value: 'compact', label: 'Compact Preview', description: 'Smaller link card' },
];

const PROGRESS_VARIANT_OPTIONS: ArgOption[] = [
  { value: 'download', label: 'Download', description: 'For download or transfer progress' },
  { value: 'upload', label: 'Upload', description: 'For upload progress' },
  { value: 'sync', label: 'Sync', description: 'For syncing data' },
  { value: 'processing', label: 'Processing', description: 'For background work' },
];

const PROGRESS_STATUS_OPTIONS: ArgOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'success', label: 'Complete' },
  { value: 'warning', label: 'Needs Attention' },
  { value: 'error', label: 'Failed' },
];

const PROGRESS_COLOR_OPTIONS: ArgOption[] = [
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'purple', label: 'Purple' },
  { value: 'orange', label: 'Orange' },
  { value: 'red', label: 'Red' },
];

const INSTAGRAM_MEDIA_TYPE_OPTIONS: ArgOption[] = [
  { value: 'IMAGE', label: 'Image Post', description: 'Publish a single image using a public image URL' },
  { value: 'VIDEO', label: 'Video Post', description: 'Publish a standard video post using a public video URL' },
  { value: 'REELS', label: 'Reel', description: 'Publish a Reel using a public video URL' },
];

const THREADS_REPLY_CONTROL_OPTIONS: ArgOption[] = [
  { value: 'everyone', label: 'Everyone', description: 'Anyone can reply to the post' },
  { value: 'accounts_you_follow', label: 'Accounts You Follow', description: 'Only accounts you follow can reply' },
  { value: 'mentioned_only', label: 'Mentioned Only', description: 'Only mentioned accounts can reply' },
];

const WHATSAPP_MEDIA_TYPE_OPTIONS: ArgOption[] = [
  { value: 'image', label: 'Image', description: 'Send an image from a public URL' },
  { value: 'audio', label: 'Audio / Voice Note', description: 'Send audio from a public URL' },
  { value: 'video', label: 'Video', description: 'Send a video from a public URL' },
  { value: 'document', label: 'Document', description: 'Send a file or document from a public URL' },
];

const WHATSAPP_MIME_TYPE_OPTIONS: ArgOption[] = [
  { value: 'image/jpeg', label: 'JPEG Image', description: 'Standard JPG image upload' },
  { value: 'image/png', label: 'PNG Image', description: 'PNG image upload' },
  { value: 'audio/ogg', label: 'OGG Audio', description: 'Voice-note style audio file' },
  { value: 'audio/mpeg', label: 'MP3 Audio', description: 'MP3 audio file' },
  { value: 'video/mp4', label: 'MP4 Video', description: 'Standard MP4 video upload' },
  { value: 'application/pdf', label: 'PDF Document', description: 'PDF file upload' },
];

const MAPS_TRAVEL_MODE_OPTIONS: ArgOption[] = [
  { value: 'driving', label: 'Driving', description: 'By car' },
  { value: 'walking', label: 'Walking', description: 'On foot' },
  { value: 'bicycling', label: 'Bicycling', description: 'By bike' },
  { value: 'transit', label: 'Transit', description: 'Public transport' },
];

const MAPS_UNITS_OPTIONS: ArgOption[] = [
  { value: 'imperial', label: 'Miles (Imperial)', description: 'Distances in miles/feet' },
  { value: 'metric', label: 'Kilometers (Metric)', description: 'Distances in km/meters' },
];

const MAPS_MAPTYPE_OPTIONS: ArgOption[] = [
  { value: 'roadmap', label: 'Road Map', description: 'Standard street map' },
  { value: 'satellite', label: 'Satellite', description: 'Aerial imagery' },
  { value: 'terrain', label: 'Terrain', description: 'Physical relief + roads' },
  { value: 'hybrid', label: 'Hybrid', description: 'Satellite with street labels' },
];

const TOOL_ARG_SELECT_OPTIONS: Record<string, Record<string, ArgOption[]>> = {
  get_datetime: {
    format: DATE_TIME_FORMAT_OPTIONS,
  },
  maps_distance_matrix: {
    mode: MAPS_TRAVEL_MODE_OPTIONS,
    units: MAPS_UNITS_OPTIONS,
  },
  maps_static_map: {
    maptype: MAPS_MAPTYPE_OPTIONS,
  },
  capture_media: {
    kind: MEDIA_KIND_OPTIONS,
  },
  capture_screen: {
    target: SCREEN_TARGET_OPTIONS,
    quality: SCREEN_QUALITY_OPTIONS,
  },
  capture_system_audio: {
    format: RECORDING_AUDIO_FORMAT_OPTIONS,
  },
  text_to_speech: {
    format: TTS_AUDIO_FORMAT_OPTIONS,
  },
  stream_create: {
    kind: STREAM_KIND_OPTIONS,
  },
  ask_confirmation: {
    variant: VARIANT_OPTIONS,
  },
  show_details: {
    variant: VARIANT_OPTIONS,
  },
  show_link: {
    variant: LINK_PREVIEW_VARIANT_OPTIONS,
  },
  show_info_card: {
    variant: VARIANT_OPTIONS,
  },
  show_progress: {
    variant: PROGRESS_VARIANT_OPTIONS,
    status: PROGRESS_STATUS_OPTIONS,
    color: PROGRESS_COLOR_OPTIONS,
  },
};

const KNOWN_SELECT_OPTIONS: Record<string, ArgOption[]> = {
  'button': MOUSE_BUTTON_OPTIONS,
  'shell': SHELL_OPTIONS,
  'voice': TTS_VOICE_OPTIONS,
  'severity': SEVERITY_OPTIONS,
  'op': COMPARE_OP_OPTIONS,
  'scope': VARIABLE_SCOPE_OPTIONS,
};

function getKnownSelectOptions(toolId: string | undefined, key: string): ArgOption[] | undefined {
  return (toolId ? TOOL_ARG_SELECT_OPTIONS[toolId]?.[key] : undefined) || KNOWN_SELECT_OPTIONS[key];
}

const ADVANCED_ARG_KEYS = new Set([
  'timeoutMs',
  'cwd',
  'shell',
  'background',
  'terminalId',
  'envId',
  'device',
  'filePath',
  'sessionId',
  'maxDurationMs',
  'includeSpamTrash',
  'pageSize',
  'orderBy',
  'maxResults',
  'temperature',
  'model',
]);

const HIDDEN_ARG_KEYS = new Set([
  '_uiDesign',
]);

function inferArgType(key: string, value: any, toolId?: string): ArgType {
  if (key === 'code' || key === 'script') return 'code';
  if (key === 'path' || key === 'filePath' || key === 'imagePath' || key === 'src' || key === 'dest' || key === 'cwd' || key === 'outputPath' || key === 'inputPath' || key === 'outputPattern') return 'path';
  if (key === 'attachments') return 'files';
  if (key === 'keys' && Array.isArray(value)) return 'hotkey';
  if (key === 'accelerator') return 'accelerator';
  if (key === 'schema' || key === 'layout' || key === 'window' || key === 'region' || key === 'bounds' || key === 'headers' || key === 'params' || key === 'data') return 'json';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  if (getKnownSelectOptions(toolId, key)) return 'select';
  return 'string';
}

function keyToLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, str => str.toUpperCase()).trim();
}

function inferLanguage(key: string, toolId: string): 'python' | 'javascript' | 'shell' | 'json' | undefined {
  if (toolId.includes('python')) return 'python';
  if (toolId.includes('node')) return 'javascript';
  if (key === 'command') return 'shell';
  return undefined;
}

// User-friendly descriptions for common argument keys
const KNOWN_DESCRIPTIONS: Record<string, string> = {
  'ms': 'How long to wait (in milliseconds). 1000 = 1 second.',
  'timeoutMs': 'Maximum time to wait before giving up (in milliseconds).',
  'command': 'The command to run in your terminal.',
  'code': 'The code to execute.',
  'text': 'The text content to use.',
  'message': 'The message to display or send.',
  'path': 'The file or folder path.',
  'query': 'What to search for.',
  'url': 'The web address (URL) to use.',
  'target': 'Where to send or what to target.',
  'title': 'A title or name to display.',
  'body': 'The main content or message body.',
  'value': 'The value to set or return.',
  'inputs': 'Data to pass to the workflow (key-value pairs).',
  'workflowId': 'The ID of an external workflow file to call.',
  'triggerId': 'The ID of a function trigger within this workflow to call.',
  'success': 'Whether the operation succeeded.',
  'packages': 'Python packages to install before running.',
  'cwd': 'The folder to run the command in.',
  'shell': 'Which terminal shell to use.',
  'background': 'Run in the background without waiting for completion.',
  'accelerator': 'The keyboard shortcut (e.g., Ctrl+Shift+K).',
  'keys': 'The key combination to press.',
  'x': 'Horizontal position (pixels from left).',
  'y': 'Vertical position (pixels from top).',
  'width': 'Width in pixels.',
  'height': 'Height in pixels.',
  'html': 'The HTML content for your interface.',
  'css': 'Custom styling for your interface.',
  'js': 'JavaScript code to run in the interface.',
  'prompt': 'Instructions for what the AI should do.',
  'cron': 'When to run (cron schedule format).',
  'sequence': 'The text sequence to trigger on.',
  'pattern': 'The pattern to match files.',
  'recursive': 'Also check inside subfolders.',
  'events': 'Which file events to listen for.',
  'passthrough': 'Let the key press continue to other apps.',
  'hold': 'Fire on both key press AND release (for hold-to-record patterns).',
  // Maps & location
  'origins': 'Starting point(s) — an address, place name, or "lat,lng".',
  'destinations': 'Destination(s) — an address, place name, or "lat,lng".',
  'center': 'Map center — an address (e.g. "Eiffel Tower, Paris") or "lat,lng".',
  'place_id': 'The Google Place ID, taken from a Find Places result.',
  'included_type': 'Restrict to one place type, e.g. "restaurant", "lawyer", "gym".',
  'radius_meters': 'How far to search around the location, in meters.',
  'maptype': 'Map style to render.',
  'include_reviews': 'Include recent customer reviews in the result.',
};

// User-friendly labels for argument keys  
const KNOWN_LABELS: Record<string, string> = {
  'ms': 'Wait Time (ms)',
  'timeoutMs': 'Timeout (ms)',
  'cwd': 'Working Folder',
  'js': 'JavaScript',
  'css': 'Styles (CSS)',
  'html': 'Layout (HTML)',
  'url': 'URL',
  'workflowId': 'Workflow',
  'inputs': 'Input Data',
  'place_id': 'Place ID',
  'maptype': 'Map Type',
  'radius_meters': 'Search Radius (meters)',
  'included_type': 'Place Type',
};

function extractOutputKeys(schema: any, prefix = '', depth = 0): string[] {
  if (!schema || depth > 3) return [];
  if (typeof schema !== 'object' || Array.isArray(schema)) return [];

  const out: string[] = [];
  for (const [k, v] of Object.entries(schema)) {
    const key = prefix ? `${prefix}.${k}` : String(k);
    out.push(key);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...extractOutputKeys(v, key, depth + 1));
    }
  }
  return out;
}

function convertDefinition(def: ToolDefinition): ToolSchema {
  const args: Record<string, ArgSchema> = {};

  for (const [key, value] of Object.entries(def.argsTemplate)) {
    const type = inferArgType(key, value, def.id);
    const selectOptions = getKnownSelectOptions(def.id, key);
    const argSchema: ArgSchema = {
      type,
      label: KNOWN_LABELS[key] || keyToLabel(key),
      description: KNOWN_DESCRIPTIONS[key],
      default: value,
      placeholder: typeof value === 'string' ? value : undefined,
      advanced: ADVANCED_ARG_KEYS.has(key),
      hidden: HIDDEN_ARG_KEYS.has(key),
    };

    if (type === 'select' && selectOptions) {
      argSchema.options = selectOptions;
    }

    if (type === 'code') {
      argSchema.language = inferLanguage(key, def.id);
    }

    if (type === 'array' && Array.isArray(value) && value.length > 0) {
      argSchema.itemType = typeof value[0] === 'string' ? 'string' : 'object';
    }

    args[key] = argSchema;
  }

  const runtimeOutputSchema = def.kind === 'cloud'
    ? ({ ok: 'boolean', ...(def.outputSchema || {}) } as any)
    : def.outputSchema;

  const outputs = [...new Set(extractOutputKeys(runtimeOutputSchema))];

  return {
    name: def.id,
    label: keyToLabel(def.id),
    description: def.description,
    category: def.category,
    args,
    outputs,
  };
}

// Build tool schemas
const TOOL_SCHEMAS: Record<string, ToolSchema> = {};

for (const def of TOOL_DEFINITIONS) {
  TOOL_SCHEMAS[def.id] = convertDefinition(def);
}

for (const trigger of TRIGGER_DEFINITIONS) {
  TOOL_SCHEMAS[trigger.type] = {
    name: trigger.type,
    label: keyToLabel(trigger.type),
    description: trigger.description,
    category: 'triggers',
    args: Object.fromEntries(
      Object.entries(trigger.argsTemplate).map(([key, value]) => [
        key,
        { type: inferArgType(key, value, trigger.type), label: keyToLabel(key), default: value } as ArgSchema,
      ])
    ),
    outputs: ['trigger'],
  };
}

// ============================================================================
// SCHEMA OVERRIDES - Explicit field configurations for better UX
// ============================================================================

if (TOOL_SCHEMAS['get_datetime']) {
  TOOL_SCHEMAS['get_datetime'].label = 'Get Current Time';
  TOOL_SCHEMAS['get_datetime'].description = 'Get the current date and time with ready-to-use outputs like date, time, weekday, and a friendly formatted value.';
  TOOL_SCHEMAS['get_datetime'].args = {
    format: {
      type: 'select',
      label: 'Show As',
      description: 'Choose how the formatted time should look. Leave blank if you only need the built-in date and time outputs.',
      options: DATE_TIME_FORMAT_OPTIONS,
      placeholder: 'Choose a display style',
      allowFreeform: true,
    },
    tzOffset: {
      type: 'number',
      label: 'Time Zone',
      description: 'Advanced. Leave blank for this computer\'s local time. Use minutes from UTC only when you need a fixed offset, such as -300 for US Central Standard Time.',
      placeholder: 'Local time',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['launch_application_or_uri']) {
  TOOL_SCHEMAS['launch_application_or_uri'].label = 'Open App, File, or Link';
  TOOL_SCHEMAS['launch_application_or_uri'].args = {
    target: {
      type: 'string',
      label: 'App, File, or URL',
      description: 'What to open. Use a website URL, a file/folder path, or an app command.',
      required: true,
      placeholder: 'https://example.com or C:/Users/name/Documents/report.pdf',
    },
    args: {
      type: 'array',
      label: 'App Arguments',
      description: 'Optional extra arguments for app commands.',
      itemType: 'string',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['open_file']) {
  TOOL_SCHEMAS['open_file'].label = 'Open File';
  TOOL_SCHEMAS['open_file'].description = 'Open a file or folder with the system default app (Photos for PNG, browser for HTML, Explorer for folders, etc.).';
  TOOL_SCHEMAS['open_file'].args = {
    path: {
      type: 'path',
      label: 'File or Folder',
      description: 'Local path to open. Supports templates like {{$workspace.assets}}/report.png.',
      required: true,
      placeholder: 'C:/Users/name/Pictures/photo.png',
    },
  };
  TOOL_SCHEMAS['open_file'].outputs = ['ok', 'opened', 'method', 'error'];
}

// Command tools - explicit approval toggle plus an optional approval description
for (const toolId of ['run_command']) {
  if (TOOL_SCHEMAS[toolId]) {
    TOOL_SCHEMAS[toolId].args = {
      ...TOOL_SCHEMAS[toolId].args,
      isPermissionRequired: {
        type: 'boolean',
        label: 'Needs Approval',
        description: 'Required. Turn this on for commands that write files, install packages, change system state, or could be destructive. Leave it off for read-only inspection commands.',
        required: true,
        default: false,
      },
      description: {
        type: 'string',
        label: 'Explain this step',
        description: 'Required only when approval is needed. This short explanation is shown in the approval dialog.',
        required: false,
        placeholder: 'Example: List the files in my Downloads folder',
        showWhen: { field: 'isPermissionRequired', value: true },
      },
    };
  }
}

// write_file requires a description for approval
if (TOOL_SCHEMAS['write_file']) {
  TOOL_SCHEMAS['write_file'].args = {
    ...TOOL_SCHEMAS['write_file'].args,
    description: {
      type: 'string',
      label: 'Explain this step',
      description: 'A short, non-technical explanation shown to you when approving this step.',
      required: true,
      placeholder: 'Example: Save the meeting notes to notes.txt',
    },
    append: {
      ...(TOOL_SCHEMAS['write_file'].args.append || { type: 'boolean', label: 'Append' }),
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['workspace_write_file']) {
  TOOL_SCHEMAS['workspace_write_file'].args = {
    ...TOOL_SCHEMAS['workspace_write_file'].args,
    description: {
      type: 'string',
      label: 'Explain this step',
      description: 'A short, non-technical explanation shown in the workflow chat approval bar.',
      required: false,
      placeholder: 'Example: Save the generated report to data/report.md',
    },
  };
}

// Desktop Controls - friendlier editors for volume / brightness / wallpaper
if (TOOL_SCHEMAS['set_system_volume']) {
  TOOL_SCHEMAS['set_system_volume'].args = {
    level: {
      type: 'number',
      label: 'Volume Level (0-100)',
      description: 'Absolute output volume. Leave empty to only change mute or apply a delta.',
      required: false,
      default: 50,
    },
    delta: {
      type: 'number',
      label: 'Volume Delta',
      description: 'Relative change (e.g. 10 to raise by 10, -10 to lower). Ignored when Level is set.',
      required: false,
      advanced: true,
    },
    muted: {
      type: 'boolean',
      label: 'Mute',
      description: 'Set to true to mute output, false to unmute. Leave empty to keep current state.',
      required: false,
    },
  };
}

if (TOOL_SCHEMAS['set_display_brightness']) {
  TOOL_SCHEMAS['set_display_brightness'].args = {
    percent: {
      type: 'number',
      label: 'Brightness (0-100)',
      description: 'Display brightness percentage.',
      required: true,
      default: 75,
    },
  };
}

if (TOOL_SCHEMAS['set_desktop_wallpaper']) {
  TOOL_SCHEMAS['set_desktop_wallpaper'].args = {
    path: {
      type: 'path',
      label: 'Image Path',
      description: 'Local image file to use as wallpaper (PNG, JPG, etc.).',
      required: true,
      placeholder: 'C:/Pictures/wallpaper.jpg',
    },
    style: {
      type: 'select',
      label: 'Display Style',
      description: 'How the image is laid out (where supported by the OS).',
      required: false,
      default: 'fill',
      options: [
        { value: 'fill', label: 'Fill' },
        { value: 'fit', label: 'Fit' },
        { value: 'stretch', label: 'Stretch' },
        { value: 'center', label: 'Center' },
        { value: 'tile', label: 'Tile' },
        { value: 'span', label: 'Span (multi-monitor)' },
      ],
    },
  };
}

if (TOOL_SCHEMAS['connect_bluetooth_device']) {
  TOOL_SCHEMAS['connect_bluetooth_device'].args = {
    address: {
      type: 'string',
      label: 'MAC Address',
      description: 'Bluetooth device MAC address (e.g. AA:BB:CC:11:22:33). Use List Bluetooth Devices to discover.',
      required: true,
      placeholder: 'AA:BB:CC:11:22:33',
    },
    openSettings: {
      type: 'boolean',
      label: 'Open Settings (Windows)',
      description: 'Windows only: open Bluetooth settings when no direct connect backend is available.',
      required: false,
      default: false,
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['disconnect_bluetooth_device']) {
  TOOL_SCHEMAS['disconnect_bluetooth_device'].args = {
    address: {
      type: 'string',
      label: 'MAC Address',
      description: 'Bluetooth device MAC address (e.g. AA:BB:CC:11:22:33).',
      required: true,
      placeholder: 'AA:BB:CC:11:22:33',
    },
  };
}

// Schedule Cron Trigger - user-friendly cron editor
if (TOOL_SCHEMAS['schedule.cron']) {
  TOOL_SCHEMAS['schedule.cron'].args = {
    cron: {
      type: 'cron',
      label: 'Schedule',
      description: 'Configure when this workflow should run automatically',
      required: true,
      default: '*/5 * * * *',
    },
  };
}

// Webhook Trigger - unified mode selector
for (const trigType of ['webhook', 'webhook.cloud', 'webhook.local']) {
  if (TOOL_SCHEMAS[trigType]) {
    TOOL_SCHEMAS[trigType].args = {
      mode: {
        type: 'select',
        label: 'Endpoint',
        description: 'Where to receive webhook requests',
        required: true,
        default: trigType === 'webhook.local' ? 'local' : 'cloud',
        options: [
          { value: 'cloud', label: 'Cloud', description: 'Public URL — accessible from the internet' },
          { value: 'local', label: 'Local', description: 'Local network only (localhost)' },
        ],
      },
    };
    TOOL_SCHEMAS[trigType].outputs = [
      'input',
      'args',
      'webhook',
      'trigger',
      'trigger.data',
    ];
  }
}

// Gmail Native Trigger - profile and label selection + output fields for {{trigger.data.X}}
if (TOOL_SCHEMAS['gmail.new_email']) {
  TOOL_SCHEMAS['gmail.new_email'].args = {
    profile: {
      type: 'string',
      label: 'Gmail Profile',
      description: 'Which connected Gmail account to watch',
      default: 'default',
      placeholder: 'default',
    },
    labelIds: {
      type: 'array',
      label: 'Label IDs',
      description: 'Gmail label IDs to watch (e.g. INBOX, UNREAD)',
      default: ['INBOX'],
    },
  };
  // Outputs available in ctx.trigger.data / {{trigger.data.X}}
  TOOL_SCHEMAS['gmail.new_email'].outputs = [
    'messageId',
    'event',
    'historyId',
    'emailAddress',
    'profile',
    'message',
    'message.id',
    'message.threadId',
    'message.snippet',
    'message.from',
    'message.to',
    'message.subject',
    'message.date',
    'message.internalDate',
  ];
}

// Drive Native Trigger - profile and filter options
if (TOOL_SCHEMAS['drive.new_file']) {
  TOOL_SCHEMAS['drive.new_file'].outputs = [
    'fileId',
    'event',
    'profile',
    'changeTime',
    'file',
    'file.id',
    'file.name',
    'file.mimeType',
    'file.webViewLink',
    'file.createdTime',
    'file.modifiedTime',
  ];
  TOOL_SCHEMAS['drive.new_file'].args = {
    profile: {
      type: 'string',
      label: 'Drive Profile',
      description: 'Which connected Google Drive account to watch',
      default: 'default',
      placeholder: 'default',
    },
    onlyNew: {
      type: 'boolean',
      label: 'Only New Files',
      description: 'Only trigger for newly created files (not edits)',
      default: true,
    },
    includeFolders: {
      type: 'boolean',
      label: 'Include Folders',
      description: 'Also trigger when folders are created',
      default: false,
    },
  };
}

// Social webhook triggers (X / Instagram) — account selector + output fields for {{trigger.data.X}}
for (const socialTrigger of ['x.new_mention', 'x.new_dm', 'x.new_follower', 'x.user_post', 'instagram.new_comment', 'instagram.new_mention', 'instagram.new_message']) {
  const schema = TOOL_SCHEMAS[socialTrigger];
  if (!schema) continue;
  const isX = socialTrigger.startsWith('x.');
  schema.args = {
    profile: {
      type: 'string',
      label: isX ? 'X Account' : 'Instagram Account',
      description: `Which connected ${isX ? 'X (Twitter)' : 'Instagram'} account to watch`,
      default: 'default',
      placeholder: 'default',
    },
  };
  schema.outputs = isX
    ? ['event', 'xUserId', 'data']
    : (socialTrigger === 'instagram.new_message'
        ? ['event', 'igAccountId', 'messaging']
        : ['event', 'igAccountId', 'field', 'value']);
}

if (TOOL_SCHEMAS['x.new_comment']) {
  TOOL_SCHEMAS['x.new_comment'].args = {
    profile: {
      type: 'string',
      label: 'X Account',
      description: 'Which connected X (Twitter) account to watch',
      default: 'default',
      placeholder: 'default',
    },
    post_id: {
      type: 'string',
      label: 'Post ID or URL',
      description: 'Only fire for comments on this post. Leave empty to watch replies on all of your posts. Paste a numeric post id or a full x.com status link.',
      placeholder: '2065123456789 or https://x.com/user/status/2065123456789',
      allowFreeform: true,
    },
    only_direct_post_replies: {
      type: 'boolean',
      label: 'Direct replies only',
      description: 'When a post is set, only fire for top-level replies to that post — not nested replies to other comments in the thread.',
      default: false,
      advanced: true,
    },
    from_username: {
      type: 'string',
      label: 'From username',
      description: 'Only fire when this account authored the comment. Leave empty for any commenter.',
      placeholder: 'Jacob_Rhodes_',
      advanced: true,
    },
    contains_text: {
      type: 'string',
      label: 'Contains text',
      description: 'Only fire when the comment text includes this phrase (case-insensitive).',
      placeholder: 'McLaren',
      advanced: true,
    },
  };
  TOOL_SCHEMAS['x.new_comment'].outputs = [
    'event',
    'xUserId',
    'data',
    'data.id_str',
    'data.id',
    'data.text',
    'data.in_reply_to_status_id_str',
    'data.in_reply_to_user_id_str',
    'data.conversation_id',
    'data.user.id_str',
    'data.user.username',
    'data.user.screen_name',
    'data.user.name',
  ];
}

// Gmail Send Message - Enhanced email composition
if (TOOL_SCHEMAS['gmail_send_message']) {
  TOOL_SCHEMAS['gmail_send_message'].args = {
    to: {
      type: 'array',
      label: 'To',
      description: 'Recipient email addresses',
      required: true,
      itemType: 'string',
      placeholder: 'email@example.com',
    },
    subject: {
      type: 'string',
      label: 'Subject',
      description: 'Email subject line',
      required: true,
      placeholder: 'Enter subject...',
    },
    body: {
      type: 'string',
      label: 'Body',
      description: 'Email body content. Can be plain text or HTML depending on content type.',
      required: true,
      placeholder: 'Enter your message...',
    },
    contentType: {
      type: 'select',
      label: 'Content Type',
      description: 'Format of the email body',
      default: 'text/plain',
      options: [
        { value: 'text/plain', label: 'Plain Text', description: 'Simple text email' },
        { value: 'text/html', label: 'HTML', description: 'Rich HTML formatted email' },
      ],
    },
    cc: {
      type: 'array',
      label: 'CC',
      description: 'Carbon copy recipients',
      itemType: 'string',
      placeholder: 'email@example.com',
    },
    from: {
      type: 'string',
      label: 'From Name',
      description: 'Sender display name shown to recipients (e.g., "Stuard AI"). Leave empty to use default.',
      placeholder: 'Stuard AI',
    },
    bcc: {
      type: 'array',
      label: 'BCC',
      description: 'Blind carbon copy recipients (hidden from other recipients)',
      itemType: 'string',
      placeholder: 'email@example.com',
    },
    attachments: {
      type: 'files',
      label: 'Attachments',
      description: 'Files to attach to the email. Select local files to include.',
    },
    profile: {
      type: 'string',
      label: 'Google Profile',
      description: 'OAuth profile label to use (e.g. "work", "personal"). Leave empty to use the default profile.',
      placeholder: 'default',
    },
  };
}

/*
// Disabled — Meta integrations temporarily hidden (see shared/integration-flags.ts)
if (TOOL_SCHEMAS['facebook_get_me']) {
  TOOL_SCHEMAS['facebook_get_me'].args = {
    profile: {
      type: 'string',
      label: 'Facebook Profile',
      description: 'Which connected Facebook profile to use. Leave empty to use the default connected profile.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['facebook_list_pages']) {
  TOOL_SCHEMAS['facebook_list_pages'].args = {
    profile: {
      type: 'string',
      label: 'Facebook Profile',
      description: 'Which connected Facebook profile to use when listing manageable Pages.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['facebook_list_page_posts']) {
  TOOL_SCHEMAS['facebook_list_page_posts'].args = {
    page_id: {
      type: 'string',
      label: 'Facebook Page ID',
      description: 'Page to read posts from. Leave empty if this profile only manages one Page. If multiple Pages exist, call facebook_list_pages first and pass the selected Page ID.',
      placeholder: '{{facebook_list_pages.pages[0].id}}',
    },
    limit: {
      type: 'number',
      label: 'Number of Posts',
      description: 'How many recent Page posts to fetch (1-100).',
      default: 10,
    },
    profile: {
      type: 'string',
      label: 'Facebook Profile',
      description: 'Which connected Facebook profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['facebook_create_page_post']) {
  TOOL_SCHEMAS['facebook_create_page_post'].args = {
    page_id: {
      type: 'string',
      label: 'Facebook Page ID',
      description: 'Page to publish to. Leave empty if this profile only manages one Page.',
      placeholder: '{{facebook_list_pages.pages[0].id}}',
    },
    message: {
      type: 'string',
      label: 'Post Message',
      description: 'Main text content for the Facebook Page post.',
      required: true,
      placeholder: 'Announcing our new launch today...',
    },
    link: {
      type: 'string',
      label: 'Optional Link',
      description: 'Optional URL to attach to the post.',
      placeholder: 'https://example.com/blog-post',
    },
    published: {
      type: 'boolean',
      label: 'Publish Immediately',
      description: 'Turn off to create the post in an unpublished state if supported by the API/account.',
      default: true,
    },
    profile: {
      type: 'string',
      label: 'Facebook Profile',
      description: 'Which connected Facebook profile to use for publishing.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['instagram_get_me']) {
  TOOL_SCHEMAS['instagram_get_me'].args = {
    profile: {
      type: 'string',
      label: 'Instagram Profile',
      description: 'Which connected Instagram professional profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['instagram_list_media']) {
  TOOL_SCHEMAS['instagram_list_media'].args = {
    limit: {
      type: 'number',
      label: 'Number of Media Items',
      description: 'How many recent Instagram media items to fetch (1-100).',
      default: 10,
    },
    profile: {
      type: 'string',
      label: 'Instagram Profile',
      description: 'Which connected Instagram professional profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['instagram_publish_media']) {
  TOOL_SCHEMAS['instagram_publish_media'].args = {
    media_type: {
      type: 'select',
      label: 'Post Type',
      description: 'Choose whether you want to publish an image post, video post, or Reel.',
      options: INSTAGRAM_MEDIA_TYPE_OPTIONS,
      default: 'IMAGE',
    },
    image_url: {
      type: 'string',
      label: 'Image URL',
      description: 'Publicly accessible image URL for image posts.',
      placeholder: 'https://cdn.example.com/post-image.jpg',
      showWhen: { field: 'media_type', value: 'IMAGE' },
    },
    video_url: {
      type: 'string',
      label: 'Video URL',
      description: 'Publicly accessible video URL for video posts or Reels.',
      placeholder: 'https://cdn.example.com/reel.mp4',
      showWhen: { field: 'media_type', values: ['VIDEO', 'REELS'] },
    },
    caption: {
      type: 'string',
      label: 'Caption',
      description: 'Caption text that will appear with the Instagram post.',
      placeholder: 'Behind the scenes of our latest release ✨',
    },
    alt_text: {
      type: 'string',
      label: 'Alt Text',
      description: 'Accessibility description for image posts.',
      placeholder: 'A product photo on a wooden desk beside a coffee mug',
      showWhen: { field: 'media_type', value: 'IMAGE' },
    },
    thumb_offset: {
      type: 'number',
      label: 'Thumbnail Offset (ms)',
      description: 'Choose the preview frame for video posts/Reels by providing the offset in milliseconds.',
      default: 0,
      advanced: true,
      showWhen: { field: 'media_type', values: ['VIDEO', 'REELS'] },
    },
    profile: {
      type: 'string',
      label: 'Instagram Profile',
      description: 'Which connected Instagram professional profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['threads_get_me']) {
  TOOL_SCHEMAS['threads_get_me'].args = {
    profile: {
      type: 'string',
      label: 'Threads Profile',
      description: 'Which connected Threads profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['threads_list_posts']) {
  TOOL_SCHEMAS['threads_list_posts'].args = {
    limit: {
      type: 'number',
      label: 'Number of Posts',
      description: 'How many recent Threads posts to fetch (1-100).',
      default: 10,
    },
    profile: {
      type: 'string',
      label: 'Threads Profile',
      description: 'Which connected Threads profile to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['threads_publish_post']) {
  TOOL_SCHEMAS['threads_publish_post'].args = {
    text: {
      type: 'string',
      label: 'Post Text',
      description: 'Text content for the Threads post. Keep it concise and conversational.',
      required: true,
      placeholder: 'Shipping a new feature today. Here is what changed...',
    },
    reply_control: {
      type: 'select',
      label: 'Who Can Reply',
      description: 'Control who is allowed to reply to the Threads post.',
      options: THREADS_REPLY_CONTROL_OPTIONS,
      default: 'everyone',
    },
    profile: {
      type: 'string',
      label: 'Threads Profile',
      description: 'Which connected Threads profile to use for publishing.',
      placeholder: 'default',
    },
  };
}
*/

// ── Reddit smart args ──

const REDDIT_SEARCH_SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance', description: 'Best match for the query (default)' },
  { value: 'hot', label: 'Hot', description: 'Trending posts right now' },
  { value: 'top', label: 'Top', description: 'Highest scored posts' },
  { value: 'new', label: 'New', description: 'Most recently posted' },
  { value: 'comments', label: 'Most Comments', description: 'Posts with the most discussion' },
];

const REDDIT_TIME_FILTER_OPTIONS = [
  { value: 'all', label: 'All Time', description: 'No time restriction' },
  { value: 'hour', label: 'Past Hour' },
  { value: 'day', label: 'Past 24 Hours' },
  { value: 'week', label: 'Past Week' },
  { value: 'month', label: 'Past Month' },
  { value: 'year', label: 'Past Year' },
];

const REDDIT_SUBREDDIT_SORT_OPTIONS = [
  { value: 'hot', label: 'Hot', description: 'Trending posts (default)' },
  { value: 'new', label: 'New', description: 'Most recently posted' },
  { value: 'top', label: 'Top', description: 'Highest scored posts' },
  { value: 'rising', label: 'Rising', description: 'Gaining traction quickly' },
];

const REDDIT_COMMENT_SORT_OPTIONS = [
  { value: 'confidence', label: 'Best', description: 'Highest confidence score (default)' },
  { value: 'top', label: 'Top', description: 'Highest voted comments' },
  { value: 'new', label: 'New', description: 'Most recent comments' },
  { value: 'controversial', label: 'Controversial', description: 'Most divisive comments' },
  { value: 'old', label: 'Old', description: 'Oldest comments first' },
  { value: 'qa', label: 'Q&A', description: 'Q&A style ordering' },
];

const REDDIT_POST_KIND_OPTIONS = [
  { value: 'self', label: 'Text Post', description: 'A text/self post with a body' },
  { value: 'link', label: 'Link Post', description: 'A post linking to an external URL' },
];

/*
// Disabled — Reddit integration temporarily hidden (see shared/integration-flags.ts)
if (TOOL_SCHEMAS['reddit_search']) {
  TOOL_SCHEMAS['reddit_search'].args = {
    query: {
      type: 'string',
      label: 'Search Query',
      description: 'What to search for on Reddit.',
      required: true,
      placeholder: 'best mechanical keyboards 2025',
    },
    subreddit: {
      type: 'string',
      label: 'Subreddit',
      description: 'Limit search to a specific subreddit. Leave empty to search all of Reddit.',
      placeholder: 'MechanicalKeyboards',
    },
    sort: {
      type: 'select',
      label: 'Sort By',
      description: 'How to sort search results.',
      options: REDDIT_SEARCH_SORT_OPTIONS,
      default: 'relevance',
    },
    time: {
      type: 'select',
      label: 'Time Filter',
      description: 'Only show posts from this time period.',
      options: REDDIT_TIME_FILTER_OPTIONS,
      default: 'all',
    },
    limit: {
      type: 'number',
      label: 'Max Results',
      description: 'Number of posts to return (1-100).',
      default: 25,
    },
    profile: {
      type: 'string',
      label: 'Reddit Profile',
      description: 'Which connected Reddit account to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['reddit_view_subreddit']) {
  TOOL_SCHEMAS['reddit_view_subreddit'].args = {
    subreddit: {
      type: 'string',
      label: 'Subreddit',
      description: 'Name of the subreddit to browse (without the r/ prefix).',
      required: true,
      placeholder: 'programming',
    },
    sort: {
      type: 'select',
      label: 'Sort By',
      description: 'How to sort the subreddit feed.',
      options: REDDIT_SUBREDDIT_SORT_OPTIONS,
      default: 'hot',
    },
    time: {
      type: 'select',
      label: 'Time Filter',
      description: 'Time filter (only applies when sorting by Top).',
      options: REDDIT_TIME_FILTER_OPTIONS,
      default: 'day',
      showWhen: { field: 'sort', value: 'top' },
    },
    limit: {
      type: 'number',
      label: 'Max Posts',
      description: 'Number of posts to return (1-100).',
      default: 25,
    },
    profile: {
      type: 'string',
      label: 'Reddit Profile',
      description: 'Which connected Reddit account to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['reddit_view_comments']) {
  TOOL_SCHEMAS['reddit_view_comments'].args = {
    subreddit: {
      type: 'string',
      label: 'Subreddit',
      description: 'The subreddit the post is in (without r/ prefix).',
      required: true,
      placeholder: 'AskReddit',
    },
    post_id: {
      type: 'string',
      label: 'Post ID',
      description: 'The Reddit post ID to view comments on. Usually from a previous reddit_search or reddit_view_subreddit step.',
      required: true,
      placeholder: '{{previous_step.items[0].id}}',
    },
    sort: {
      type: 'select',
      label: 'Comment Sort',
      description: 'How to sort the comments.',
      options: REDDIT_COMMENT_SORT_OPTIONS,
      default: 'confidence',
    },
    limit: {
      type: 'number',
      label: 'Max Comments',
      description: 'Number of top-level comments to return (1-100).',
      default: 25,
    },
    profile: {
      type: 'string',
      label: 'Reddit Profile',
      description: 'Which connected Reddit account to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['reddit_create_post']) {
  TOOL_SCHEMAS['reddit_create_post'].args = {
    subreddit: {
      type: 'string',
      label: 'Subreddit',
      description: 'Which subreddit to post in (without r/ prefix).',
      required: true,
      placeholder: 'SideProject',
    },
    title: {
      type: 'string',
      label: 'Post Title',
      description: 'Title for the post (max 300 characters).',
      required: true,
      placeholder: 'Just launched my new project — feedback welcome!',
    },
    kind: {
      type: 'select',
      label: 'Post Type',
      description: 'Whether this is a text post or a link to an external URL.',
      options: REDDIT_POST_KIND_OPTIONS,
      default: 'self',
    },
    text: {
      type: 'string',
      label: 'Post Body',
      description: 'Body text for a text post. Supports Markdown formatting.',
      placeholder: 'Here is what I built and why...',
      showWhen: { field: 'kind', value: 'self' },
    },
    url: {
      type: 'string',
      label: 'Link URL',
      description: 'External URL for a link post.',
      placeholder: 'https://example.com/my-project',
      showWhen: { field: 'kind', value: 'link' },
    },
    profile: {
      type: 'string',
      label: 'Reddit Profile',
      description: 'Which connected Reddit account to use.',
      placeholder: 'default',
    },
  };
}

if (TOOL_SCHEMAS['reddit_comment']) {
  TOOL_SCHEMAS['reddit_comment'].args = {
    thing_id: {
      type: 'string',
      label: 'Reply To (Thing ID)',
      description: 'The fullname of the post or comment to reply to. Use "t3_<postId>" for posts, "t1_<commentId>" for comments. Usually from a previous Reddit step.',
      required: true,
      placeholder: '{{previous_step.items[0].id}}',
    },
    text: {
      type: 'string',
      label: 'Comment Text',
      description: 'The comment body. Supports Reddit Markdown (bold, links, lists, etc.).',
      required: true,
      placeholder: 'Great post! Here are my thoughts...',
    },
    profile: {
      type: 'string',
      label: 'Reddit Profile',
      description: 'Which connected Reddit account to use.',
      placeholder: 'default',
    },
  };
}
*/

if (TOOL_SCHEMAS['whatsapp_send_message']) {
  TOOL_SCHEMAS['whatsapp_send_message'].args = {
    message: {
      type: 'string',
      label: 'Message Text',
      description: 'Text to send to the connected WhatsApp number.',
      required: true,
      placeholder: 'Your workflow finished successfully.',
    },
    preview_url: {
      type: 'boolean',
      label: 'Show Link Preview',
      description: 'Enable this if the message contains a URL and you want WhatsApp to render a preview.',
      default: false,
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_send_media']) {
  TOOL_SCHEMAS['whatsapp_send_media'].args = {
    type: {
      type: 'select',
      label: 'Media Type',
      description: 'Choose what kind of media to send.',
      options: WHATSAPP_MEDIA_TYPE_OPTIONS,
      default: 'image',
    },
    url: {
      type: 'string',
      label: 'Public Media URL',
      description: 'Publicly accessible file URL that WhatsApp can download.',
      required: true,
      placeholder: 'https://cdn.example.com/file.png',
    },
    caption: {
      type: 'string',
      label: 'Caption',
      description: 'Optional caption for images, videos, or documents.',
      placeholder: 'Here is the latest report.',
      showWhen: { field: 'type', values: ['image', 'video', 'document'] },
    },
    filename: {
      type: 'string',
      label: 'Document Filename',
      description: 'Optional filename shown to the recipient for documents.',
      placeholder: 'monthly-report.pdf',
      showWhen: { field: 'type', value: 'document' },
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_send_reaction']) {
  TOOL_SCHEMAS['whatsapp_send_reaction'].args = {
    message_id: {
      type: 'string',
      label: 'Target Message ID',
      description: 'The WhatsApp message ID to react to. Usually comes from a previous WhatsApp step output.',
      required: true,
      placeholder: '{{previous_whatsapp_step.messageId}}',
    },
    emoji: {
      type: 'string',
      label: 'Emoji Reaction',
      description: 'Emoji to react with, like 👍, ✅, 🎉, or ❤️.',
      required: true,
      placeholder: '👍',
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_mark_read']) {
  TOOL_SCHEMAS['whatsapp_mark_read'].args = {
    message_id: {
      type: 'string',
      label: 'Message ID',
      description: 'The WhatsApp message ID to mark as read.',
      required: true,
      placeholder: '{{previous_whatsapp_step.messageId}}',
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_upload_media']) {
  TOOL_SCHEMAS['whatsapp_upload_media'].args = {
    url: {
      type: 'string',
      label: 'Public File URL',
      description: 'Publicly accessible file URL to upload into WhatsApp media storage.',
      required: true,
      placeholder: 'https://cdn.example.com/invoice.pdf',
    },
    mime_type: {
      type: 'select',
      label: 'MIME Type',
      description: 'Choose a common MIME type or type your own custom value.',
      options: WHATSAPP_MIME_TYPE_OPTIONS,
      allowFreeform: true,
      placeholder: 'application/pdf',
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_status']) {
  TOOL_SCHEMAS['whatsapp_status'].description = 'Check whether the current user has a WhatsApp number connected and ready for workflow messages.';
}

// --- New voice / media tool overrides ---

const VOICE_PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto (Best Available)', description: 'Automatically pick the best configured voice provider' },
  { value: 'elevenlabs', label: 'ElevenLabs', description: 'ElevenLabs Conversational AI — natural, expressive voices' },
  { value: 'openai-realtime', label: 'OpenAI Realtime', description: 'OpenAI Realtime API — GPT-4o with voice' },
  { value: 'grok-realtime', label: 'Grok Voice (xAI)', description: 'xAI Grok Voice Agent — fast, with web & X search' },
  { value: 'gemini-live', label: 'Gemini Live (Google)', description: 'Google Gemini Live — multimodal voice conversations' },
];

const ELEVENLABS_MODEL_OPTIONS = [
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (Fastest)' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (Best quality)' },
  { value: 'eleven_turbo_v2', label: 'Turbo v2' },
  { value: 'eleven_monolingual_v1', label: 'Monolingual v1 (English only)' },
];

if (TOOL_SCHEMAS['text_to_speech']) {
  TOOL_SCHEMAS['text_to_speech'].label = 'Text to Speech';
  TOOL_SCHEMAS['text_to_speech'].args = {
    ...TOOL_SCHEMAS['text_to_speech'].args,
    text: {
      ...TOOL_SCHEMAS['text_to_speech'].args.text,
      type: 'string',
      label: 'Text to Read',
      description: 'The words to turn into audio.',
      required: true,
      placeholder: 'Hello! This is your workflow speaking.',
    },
    voice_id: {
      ...TOOL_SCHEMAS['text_to_speech'].args.voice_id,
      type: 'string',
      label: 'Voice',
      description: 'ElevenLabs voice ID. Leave the default if you do not need a specific voice.',
      placeholder: 'JBFqnCBsd6RMkjVDRZzb',
    },
    model_id: {
      ...TOOL_SCHEMAS['text_to_speech'].args.model_id,
      type: 'select',
      label: 'Voice Model',
      description: 'Speech model to use.',
      options: ELEVENLABS_MODEL_OPTIONS,
      default: 'eleven_multilingual_v2',
      advanced: true,
    },
    format: {
      ...TOOL_SCHEMAS['text_to_speech'].args.format,
      type: 'select',
      label: 'Audio File Type',
      description: 'Choose the saved audio format.',
      options: TTS_AUDIO_FORMAT_OPTIONS,
      default: 'mp3',
    },
    language_code: {
      ...TOOL_SCHEMAS['text_to_speech'].args.language_code,
      label: 'Language Hint',
      description: 'Optional language code if you want to guide pronunciation.',
      placeholder: 'en',
      advanced: true,
    },
    speed: {
      ...TOOL_SCHEMAS['text_to_speech'].args.speed,
      type: 'number',
      label: 'Speed',
      description: 'Speech speed. 1 is normal.',
      default: 1,
      advanced: true,
    },
    save: {
      ...TOOL_SCHEMAS['text_to_speech'].args.save,
      type: 'boolean',
      label: 'Save Audio File',
      description: 'Save the generated audio to disk.',
      default: true,
    },
    play: {
      ...TOOL_SCHEMAS['text_to_speech'].args.play,
      type: 'boolean',
      label: 'Play When Done',
      description: 'Open the audio after it is generated.',
      default: false,
    },
    outputPath: {
      ...TOOL_SCHEMAS['text_to_speech'].args.outputPath,
      type: 'path',
      label: 'Save As',
      description: 'Optional path for the generated audio file.',
      placeholder: 'C:/Users/name/Music/voice.mp3',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['telnyx_send_mms']) {
  TOOL_SCHEMAS['telnyx_send_mms'].args = {
    media_url: {
      type: 'string',
      label: 'Media URL',
      description: 'Public URL of the image or media file to send.',
      required: true,
      placeholder: 'https://cdn.example.com/image.jpg',
    },
    message: {
      type: 'string',
      label: 'Text Message',
      description: 'Optional text to include with the MMS.',
      placeholder: 'Check out this image!',
    },
  };
}

if (TOOL_SCHEMAS['telnyx_send_voice_note']) {
  TOOL_SCHEMAS['telnyx_send_voice_note'].args = {
    message: {
      type: 'string',
      label: 'Voice Message Text',
      description: 'Text to convert to speech and send as an audio MMS.',
      required: true,
      placeholder: 'Hey, just wanted to let you know...',
    },
    voice_id: {
      type: 'string',
      label: 'ElevenLabs Voice ID',
      description: 'Voice to use for speech synthesis. Use list_tts_voices to browse.',
      placeholder: 'JBFqnCBsd6RMkjVDRZzb',
      advanced: true,
    },
    model_id: {
      type: 'select',
      label: 'TTS Model',
      description: 'ElevenLabs model for speech generation.',
      options: ELEVENLABS_MODEL_OPTIONS,
      default: 'eleven_turbo_v2_5',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['telnyx_voice_call']) {
  TOOL_SCHEMAS['telnyx_voice_call'].args = {
    provider: {
      type: 'select',
      label: 'Voice Provider',
      description: 'Select the AI voice provider for the real-time call.',
      options: VOICE_PROVIDER_OPTIONS,
      default: 'auto',
    },
    agent_id: {
      type: 'string',
      label: 'Agent ID',
      description: 'Agent ID (required for ElevenLabs, optional for OpenAI).',
      placeholder: 'agent_abc123',
      showWhen: { field: 'provider', values: ['elevenlabs', 'auto'] },
    },
    voice_id: {
      type: 'string',
      label: 'Voice',
      description: 'Voice ID or name. For OpenAI: alloy, echo, fable, onyx, nova, shimmer.',
      placeholder: 'alloy',
    },
    initial_message: {
      type: 'string',
      label: 'Initial Message',
      description: 'First thing the AI says when the call connects.',
      placeholder: 'Hello! I\'m calling about your appointment...',
    },
    system_prompt: {
      type: 'string',
      label: 'System Prompt',
      description: 'System prompt for the AI conversation (OpenAI Realtime).',
      placeholder: 'You are a helpful assistant calling to...',
      showWhen: { field: 'provider', values: ['openai-realtime', 'grok-realtime', 'gemini-live'] },
      advanced: true,
    },
    model: {
      type: 'string',
      label: 'Model',
      description: 'Model override for the voice provider.',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['telnyx_hangup_call']) {
  TOOL_SCHEMAS['telnyx_hangup_call'].args = {
    call_control_id: {
      type: 'string',
      label: 'Call Control ID',
      description: 'The call control ID of the active call to hang up.',
      required: true,
      placeholder: '{{voice_call_step.callControlId}}',
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_send_voice_note']) {
  TOOL_SCHEMAS['whatsapp_send_voice_note'].args = {
    message: {
      type: 'string',
      label: 'Voice Message Text',
      description: 'Text to convert to speech and send as a WhatsApp audio message.',
      required: true,
      placeholder: 'Hey, just wanted to share a quick update...',
    },
    voice_id: {
      type: 'string',
      label: 'ElevenLabs Voice ID',
      description: 'Voice to use for speech synthesis.',
      placeholder: 'JBFqnCBsd6RMkjVDRZzb',
      advanced: true,
    },
    model_id: {
      type: 'select',
      label: 'TTS Model',
      description: 'ElevenLabs model for speech generation.',
      options: ELEVENLABS_MODEL_OPTIONS,
      default: 'eleven_turbo_v2_5',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_transcribe_voice_note']) {
  TOOL_SCHEMAS['whatsapp_transcribe_voice_note'].args = {
    media_id: {
      type: 'string',
      label: 'Media ID',
      description: 'WhatsApp media ID of the voice note to transcribe.',
      required: true,
      placeholder: '{{trigger.mediaId}}',
    },
    language: {
      type: 'string',
      label: 'Language Hint',
      description: 'ISO 639-1 language code for better transcription accuracy.',
      placeholder: 'en',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_send_template']) {
  TOOL_SCHEMAS['whatsapp_send_template'].args = {
    template_name: {
      type: 'string',
      label: 'Template Name',
      description: 'Name of the pre-approved WhatsApp message template.',
      required: true,
      placeholder: 'hello_world',
    },
    language_code: {
      type: 'string',
      label: 'Language Code',
      description: 'Template language code.',
      default: 'en_US',
      placeholder: 'en_US',
    },
  };
}

if (TOOL_SCHEMAS['whatsapp_voice_call']) {
  TOOL_SCHEMAS['whatsapp_voice_call'].args = {
    provider: {
      type: 'select',
      label: 'Voice Provider',
      description: 'Select the AI voice provider for the real-time call.',
      options: VOICE_PROVIDER_OPTIONS,
      default: 'auto',
    },
    agent_id: {
      type: 'string',
      label: 'Agent ID',
      description: 'Agent ID (required for ElevenLabs).',
      placeholder: 'agent_abc123',
      showWhen: { field: 'provider', values: ['elevenlabs', 'auto'] },
    },
    voice_id: {
      type: 'string',
      label: 'Voice',
      description: 'Voice ID or name.',
      placeholder: 'alloy',
    },
    initial_message: {
      type: 'string',
      label: 'Initial Message',
      description: 'First thing the AI says when the call connects.',
      placeholder: 'Hello! I am calling about...',
    },
    system_prompt: {
      type: 'string',
      label: 'System Prompt',
      description: 'System prompt for the AI conversation.',
      advanced: true,
    },
  };
}

// --- Cloud Storage tool args ---
const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private (Signed URL)', description: 'Time-limited signed URL — secure, expires in 1 hour' },
  { value: 'public', label: 'Public (Permanent URL)', description: 'Permanent public URL — anyone with the link can access' },
];

if (TOOL_SCHEMAS['cloud_storage_upload']) {
  TOOL_SCHEMAS['cloud_storage_upload'].args = {
    path: {
      type: 'string',
      label: 'File Path',
      description: 'Local file path to upload.',
      required: true,
      placeholder: 'C:\\Users\\me\\photo.jpg',
    },
    folder: {
      type: 'string',
      label: 'Folder',
      description: 'Subfolder in cloud storage.',
      placeholder: 'instagram',
    },
    visibility: {
      type: 'select',
      label: 'Visibility',
      description: 'Public files get a permanent URL (useful for Instagram). Private files get a signed URL.',
      options: VISIBILITY_OPTIONS,
      default: 'private',
    },
    filename: {
      type: 'string',
      label: 'Filename Override',
      description: 'Override the filename in storage. Defaults to the original filename.',
      placeholder: 'my-photo.jpg',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['cloud_storage_get_url']) {
  TOOL_SCHEMAS['cloud_storage_get_url'].args = {
    objectName: {
      type: 'string',
      label: 'Object Name',
      description: 'The file path in cloud storage.',
      required: true,
      placeholder: 'instagram/photo.jpg',
    },
    visibility: {
      type: 'select',
      label: 'URL Type',
      description: 'Public returns a permanent URL. Private returns a time-limited signed URL.',
      options: VISIBILITY_OPTIONS,
      default: 'private',
    },
  };
}

if (TOOL_SCHEMAS['cloud_storage_list']) {
  TOOL_SCHEMAS['cloud_storage_list'].args = {
    prefix: {
      type: 'string',
      label: 'Folder Prefix',
      description: 'Filter files by folder prefix.',
      placeholder: 'instagram/',
    },
    limit: {
      type: 'number',
      label: 'Max Results',
      description: 'Maximum number of files to return.',
      default: 100,
    },
  };
}

if (TOOL_SCHEMAS['cloud_storage_delete']) {
  TOOL_SCHEMAS['cloud_storage_delete'].args = {
    objectName: {
      type: 'string',
      label: 'Object Name',
      description: 'The file path to delete from cloud storage.',
      required: true,
      placeholder: 'instagram/photo.jpg',
    },
  };
}

if (TOOL_SCHEMAS['cloud_storage_set_visibility']) {
  TOOL_SCHEMAS['cloud_storage_set_visibility'].args = {
    objectName: {
      type: 'string',
      label: 'Object Name',
      description: 'The file path in cloud storage.',
      required: true,
      placeholder: 'instagram/photo.jpg',
    },
    visibility: {
      type: 'select',
      label: 'Visibility',
      description: 'Set the file to public or private.',
      options: VISIBILITY_OPTIONS,
      default: 'public',
    },
  };
}

// --- Tool-specific 'mode' overrides ---
// (mode was removed from generic KNOWN_SELECT_OPTIONS to avoid capture_media modes leaking into AI tools)

// Capture tools: fixed / until_stop
for (const toolId of ['capture_media', 'capture_screen', 'capture_system_audio']) {
  if (TOOL_SCHEMAS[toolId]?.args?.mode) {
    TOOL_SCHEMAS[toolId].args.mode = {
      ...TOOL_SCHEMAS[toolId].args.mode,
      type: 'select',
      options: CAPTURE_MODE_OPTIONS,
    };
  }
}

// capture_media: mirror toggle for selfie-cam
if (TOOL_SCHEMAS['capture_media']) {
  TOOL_SCHEMAS['capture_media'].args.kind = {
    ...TOOL_SCHEMAS['capture_media'].args.kind,
    type: 'select',
    label: 'Capture Type',
    description: 'Choose what to record.',
    options: MEDIA_KIND_OPTIONS,
    default: 'audio',
  };
  TOOL_SCHEMAS['capture_media'].args.mirror = {
    type: 'boolean' as any,
    label: 'Mirror (Flip Horizontal)',
    description: 'Flip the video horizontally for a selfie-cam / webcam mirror effect. Only applies to video captures.',
    default: false,
  };
  // Silence detection parameters (for mode="silence")
  TOOL_SCHEMAS['capture_media'].args.silenceThreshold = {
    type: 'number' as any,
    label: 'Silence Threshold (%)',
    description: 'Volume percentage (0-100). Audio below this level is considered silence. Default: 5%',
    default: 5,
    showWhen: { field: 'mode', value: 'silence' },
  };
  TOOL_SCHEMAS['capture_media'].args.silenceDuration = {
    type: 'number' as any,
    label: 'Silence Duration (s)',
    description: 'Seconds of continuous silence required to stop recording. Default: 2',
    default: 2,
    showWhen: { field: 'mode', value: 'silence' },
  };
}

if (TOOL_SCHEMAS['capture_screen']) {
  TOOL_SCHEMAS['capture_screen'].args.target = {
    ...TOOL_SCHEMAS['capture_screen'].args.target,
    type: 'select',
    label: 'What to Record',
    description: 'Choose the part of the screen to record.',
    options: SCREEN_TARGET_OPTIONS,
    default: 'fullscreen',
  };
  TOOL_SCHEMAS['capture_screen'].args.quality = {
    ...TOOL_SCHEMAS['capture_screen'].args.quality,
    type: 'select',
    label: 'Video Quality',
    description: 'Higher quality creates larger files.',
    options: SCREEN_QUALITY_OPTIONS,
    default: 'medium',
  };
}

// capture_system_audio: silence mode support
if (TOOL_SCHEMAS['capture_system_audio']) {
  TOOL_SCHEMAS['capture_system_audio'].args.format = {
    ...TOOL_SCHEMAS['capture_system_audio'].args.format,
    type: 'select',
    label: 'Audio File Type',
    description: 'Choose the saved recording format.',
    options: RECORDING_AUDIO_FORMAT_OPTIONS,
    default: 'wav',
  };
  TOOL_SCHEMAS['capture_system_audio'].args.silenceThreshold = {
    type: 'number' as any,
    label: 'Silence Threshold (%)',
    description: 'Volume percentage (0-100). Audio below this level is considered silence. Default: 5%',
    default: 5,
    showWhen: { field: 'mode', value: 'silence' },
  };
  TOOL_SCHEMAS['capture_system_audio'].args.silenceDuration = {
    type: 'number' as any,
    label: 'Silence Duration (s)',
    description: 'Seconds of continuous silence required to stop recording. Default: 2',
    default: 2,
    showWhen: { field: 'mode', value: 'silence' },
  };
}

// Analyze current screen: text / json / boolean
if (TOOL_SCHEMAS['analyze_current_screen']?.args?.mode) {
  TOOL_SCHEMAS['analyze_current_screen'].args.mode = {
    ...TOOL_SCHEMAS['analyze_current_screen'].args.mode,
    type: 'select',
    options: ANALYZE_MODE_OPTIONS,
  };
}

// Analyze media: fast / detailed
if (TOOL_SCHEMAS['analyze_media']?.args?.mode) {
  TOOL_SCHEMAS['analyze_media'].args.mode = {
    ...TOOL_SCHEMAS['analyze_media'].args.mode,
    type: 'select',
    options: ANALYZE_MEDIA_MODE_OPTIONS,
  };
}

// AI inference: full smart-args schema with memory and conditional visibility
if (TOOL_SCHEMAS['ai_inference']) {
  TOOL_SCHEMAS['ai_inference'].args = {
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'Instruction or question for the AI. With media sources, describe what to extract or analyze (e.g. "Describe this screen", "Summarize this video"). For embedding mode, this is the text to embed.',
      required: true,
      placeholder: 'Summarize this text / Describe the screen / Extract key details',
      showWhen: { field: 'mode', values: ['text', 'json', 'embedding'] },
    },
    input: {
      type: 'string',
      label: 'Input Data',
      description: 'Optional text to process. Can also reference previous step output: {{step_id.text}}',
      placeholder: '{{previous_step.text}} or paste text here',
      showWhen: { field: 'mode', values: ['text', 'json'] },
    },
    sources: {
      type: 'array',
      label: 'Media Sources',
      description: 'Media inputs — images, audio, video, PDFs, YouTube URLs, or "Capture current screen". Wire in upstream paths with {{step_id.filePath}}. Required for transcription mode; for text/json modes, requires a vision-capable model when used.',
      itemType: 'object' as ArgType,
      default: [],
      showWhen: { field: 'mode', values: ['text', 'json', 'transcription'] },
    },
    mode: {
      type: 'select',
      label: 'Output Mode',
      description: 'What the AI should return',
      options: AI_INFERENCE_MODE_OPTIONS,
      default: 'text',
    },
    model: {
      type: 'select',
      label: 'Model',
      description: 'AI model to use. Pick a vision-capable model when supplying media sources. Embedding mode uses a separate embedding model automatically.',
      // Catalog is populated after AGENT_MODEL_OPTIONS is built (see override below).
      options: MODEL_OPTIONS,
      default: 'google/gemini-3.1-pro-preview',
      allowFreeform: true,
      placeholder: 'Search for a model...',
      showWhen: { field: 'mode', values: ['text', 'json', 'embedding'] },
    },
    transcriptionModel: {
      type: 'select',
      label: 'Transcription Model',
      description: 'Speech-to-text model. OpenAI/Google/Mistral/Qwen route via OpenRouter; ElevenLabs Scribe routes through ElevenLabs direct API.',
      options: TRANSCRIPTION_MODEL_OPTIONS,
      default: 'openai/whisper-1',
      allowFreeform: true,
      placeholder: 'Search transcription models...',
      showWhen: { field: 'mode', value: 'transcription' },
    },
    language: {
      type: 'string',
      label: 'Language',
      description: 'Optional ISO-639-1 code (e.g. "en", "ja", "es"). Auto-detected when omitted.',
      placeholder: 'en',
      showWhen: { field: 'mode', value: 'transcription' },
    },
    audioStreamId: {
      type: 'string',
      label: 'Live Audio Stream',
      description: 'Real-time speech-to-text from a live mic stream. Easiest: draw a STREAM wire from capture_media (stream mode) into this node and leave this blank — the audio stream is injected automatically. Or set it explicitly with a flow wire, e.g. {{record.streamId}}. Audio is windowed and transcribed continuously. Turn on "Stream Output" to emit a live transcript stream; leave it off to get the full transcript when the stream ends. Leave blank (and no stream wire) to transcribe a file via Media Sources instead.',
      placeholder: '{{record.streamId}}  (or just draw a stream wire)',
      showWhen: { field: 'mode', value: 'transcription' },
    },
    windowMs: {
      type: 'number',
      label: 'Transcription Window (ms)',
      description: 'Streaming only: max length of each transcribed window. Windows also flush early at natural pauses (silence) so utterances stay intact. Default 8000.',
      default: 8000,
      advanced: true,
      showWhen: { field: 'mode', value: 'transcription' },
    },
    maxDurationMs: {
      type: 'number',
      label: 'Max Duration (ms)',
      description: 'Streaming only: stop after this much audio (0 = until the audio stream closes). Pair with "Stop Session ID" to auto-stop the mic and end the workflow.',
      default: 0,
      advanced: true,
      showWhen: { field: 'mode', value: 'transcription' },
    },
    stopSessionId: {
      type: 'string',
      label: 'Stop Session ID',
      description: 'Streaming only: the capture_media sessionId to stop when Max Duration elapses, so the run ends cleanly.',
      placeholder: 'rec',
      advanced: true,
      showWhen: { field: 'mode', value: 'transcription' },
    },
    schema: {
      type: 'json',
      label: 'Output Schema',
      description: 'Define the expected JSON output shape. Keys = field names, values = types. Example: {"category": "string", "score": "number", "tags": "string[]"}',
      showWhen: { field: 'mode', value: 'json' },
    },
    memory: {
      type: 'memory' as ArgType,
      label: 'Memory',
      description: 'Configure what the AI remembers about you — identity, preferences, conversation history, and custom facts.',
      default: { enabled: false, lenses: { identity: true, directives: true, bio: true, relatedMemories: true, entities: true }, maxFacts: 6, conversationHistory: [], customFacts: [] },
      showWhen: { field: 'mode', values: ['text', 'json'] },
    },
    systemPrompt: {
      type: 'string',
      label: 'System Prompt',
      description: 'Custom persona or behavior instructions for the AI (e.g. "You are a helpful data analyst")',
      placeholder: 'You are a helpful assistant that...',
      advanced: true,
      showWhen: { field: 'mode', values: ['text', 'json'] },
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      description: 'Controls creativity. 0 = focused and deterministic, 1+ = more creative and varied.',
      default: 0.3,
      advanced: true,
      showWhen: { field: 'mode', values: ['text', 'json'] },
    },
  };
  TOOL_SCHEMAS['ai_inference'].outputs = ['ok', 'text', 'json', 'embedding', 'model', 'streamId', 'error'];
}

// File edit: replace / delete / add
if (TOOL_SCHEMAS['file_edit']?.args?.mode) {
  TOOL_SCHEMAS['file_edit'].args.mode = {
    ...TOOL_SCHEMAS['file_edit'].args.mode,
    type: 'select',
    options: FILE_EDIT_MODE_OPTIONS,
  };
}

// ============================================================================
// HTTP REQUEST — Full schema with proper select/json types
// ============================================================================

if (TOOL_SCHEMAS['http_request']) {
  TOOL_SCHEMAS['http_request'].args = {
    url: {
      type: 'string',
      label: 'URL',
      description: 'The URL to send the request to',
      required: true,
      placeholder: 'https://api.example.com/data',
    },
    method: {
      type: 'select',
      label: 'Method',
      description: 'HTTP method to use',
      options: HTTP_METHOD_OPTIONS,
      default: 'GET',
    },
    headers: {
      type: 'json',
      label: 'Headers',
      description: 'HTTP headers as key-value pairs. Example: {"Authorization": "Bearer ...", "Content-Type": "application/json"}',
    },
    query: {
      type: 'json',
      label: 'Query Parameters',
      description: 'URL query parameters as key-value pairs. Example: {"page": 1, "limit": 10}',
    },
    body: {
      type: 'string',
      label: 'Request Body',
      description: 'Request body content (for POST/PUT/PATCH). Use JSON string or {{variable}} references.',
      placeholder: '{"key": "value"}',
    },
    bearer_token: {
      type: 'string',
      label: 'Bearer Token',
      description: 'Shortcut: sets Authorization: Bearer <token> header',
      placeholder: 'your-api-token',
      advanced: true,
    },
    timeout: {
      type: 'number',
      label: 'Timeout (seconds)',
      description: 'Maximum time to wait for a response',
      default: 30,
      advanced: true,
    },
    follow_redirects: {
      type: 'boolean',
      label: 'Follow Redirects',
      default: true,
      advanced: true,
    },
    verify_ssl: {
      type: 'boolean',
      label: 'Verify SSL',
      default: true,
      advanced: true,
    },
    retries: {
      type: 'number',
      label: 'Retries',
      description: 'Number of retry attempts on failure',
      default: 0,
      advanced: true,
    },
  };
}

// ============================================================================
// SEND NOTIFICATION — severity dropdown
// ============================================================================

if (TOOL_SCHEMAS['send_notification']) {
  TOOL_SCHEMAS['send_notification'].args.severity = {
    ...TOOL_SCHEMAS['send_notification'].args.severity,
    type: 'select',
    label: 'Severity',
    description: 'Notification urgency level',
    options: SEVERITY_OPTIONS,
  };
  TOOL_SCHEMAS['send_notification'].args.title = {
    ...TOOL_SCHEMAS['send_notification'].args.title,
    label: 'Title',
    description: 'Short notification heading',
    placeholder: 'Stuard AI',
  };
  TOOL_SCHEMAS['send_notification'].args.body = {
    ...TOOL_SCHEMAS['send_notification'].args.body,
    label: 'Message',
    description: 'Main notification body text. Markdown and inline images in the text are supported.',
    placeholder: 'Something happened!',
  };
  TOOL_SCHEMAS['send_notification'].args.imagePath = {
    type: 'path',
    label: 'Image',
    description: 'Optional local image path, file URL, web URL, or data URI to display beside the notification.',
    placeholder: 'C:/Users/you/Pictures/preview.png',
  };
  TOOL_SCHEMAS['send_notification'].args.durationMs = {
    ...TOOL_SCHEMAS['send_notification'].args.durationMs,
    type: 'number',
    label: 'Auto Close (ms)',
    description: 'How long the notification stays visible. Set to 0 to keep it open until dismissed.',
  };
  TOOL_SCHEMAS['send_notification'].args.showInput = {
    ...TOOL_SCHEMAS['send_notification'].args.showInput,
    type: 'boolean',
    label: 'Show Input Bar',
    description: 'Display a reply/input field inside the notification.',
  };
  TOOL_SCHEMAS['send_notification'].args.waitForInput = {
    ...TOOL_SCHEMAS['send_notification'].args.waitForInput,
    type: 'boolean',
    label: 'Wait For Reply',
    description: 'Pause the workflow until the user submits, cancels, dismisses, or the notification times out.',
    showWhen: { field: 'showInput', value: true },
  };
  TOOL_SCHEMAS['send_notification'].args.inputPlaceholder = {
    ...TOOL_SCHEMAS['send_notification'].args.inputPlaceholder,
    label: 'Input Placeholder',
    description: 'Placeholder text shown inside the reply bar.',
    showWhen: { field: 'showInput', value: true },
  };
  TOOL_SCHEMAS['send_notification'].args.inputDefaultValue = {
    ...TOOL_SCHEMAS['send_notification'].args.inputDefaultValue,
    label: 'Default Input Value',
    description: 'Optional pre-filled value for the input bar.',
    showWhen: { field: 'showInput', value: true },
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.inputSubmitText = {
    ...TOOL_SCHEMAS['send_notification'].args.inputSubmitText,
    label: 'Submit Button',
    description: 'Label for the input submit button.',
    showWhen: { field: 'showInput', value: true },
  };
  TOOL_SCHEMAS['send_notification'].args.inputCancelText = {
    ...TOOL_SCHEMAS['send_notification'].args.inputCancelText,
    label: 'Cancel Button',
    description: 'Optional cancel button text shown under the input.',
    showWhen: { field: 'showInput', value: true },
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.inputType = {
    ...TOOL_SCHEMAS['send_notification'].args.inputType,
    type: 'select',
    label: 'Input Type',
    description: 'Choose the keyboard/input mode for the reply field.',
    options: [
      { value: 'text', label: 'Text' },
      { value: 'email', label: 'Email' },
      { value: 'number', label: 'Number' },
      { value: 'password', label: 'Password' },
    ],
    showWhen: { field: 'showInput', value: true },
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.keepAfterSubmit = {
    ...TOOL_SCHEMAS['send_notification'].args.keepAfterSubmit,
    type: 'boolean',
    label: 'Keep Open After Submit',
    description: 'Leave the notification open after the user submits text.',
    showWhen: { field: 'showInput', value: true },
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.timeoutMs = {
    ...TOOL_SCHEMAS['send_notification'].args.timeoutMs,
    type: 'number',
    label: 'Reply Timeout (ms)',
    description: 'Maximum time to wait for a reply when Wait For Reply is enabled.',
    showWhen: { field: 'showInput', value: true },
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.progress = {
    ...TOOL_SCHEMAS['send_notification'].args.progress,
    type: 'number',
    label: 'Progress (%)',
    description: 'Optional progress bar value from 0 to 100.',
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.taskId = {
    ...TOOL_SCHEMAS['send_notification'].args.taskId,
    advanced: true,
  };
  TOOL_SCHEMAS['send_notification'].args.workflowRunId = {
    ...TOOL_SCHEMAS['send_notification'].args.workflowRunId,
    advanced: true,
  };
 }

// ============================================================================
// SET WINDOW BOUNDS — bounds as JSON with clear description
// ============================================================================

if (TOOL_SCHEMAS['set_window_bounds']) {
  TOOL_SCHEMAS['set_window_bounds'].args.bounds = {
    type: 'json',
    label: 'Window Bounds',
    description: 'Position and size: { x, y, width, height } in pixels',
    default: { x: 0, y: 0, width: 800, height: 600 },
  };
}

// ============================================================================
// TAKE SCREENSHOT — region as JSON
// ============================================================================

if (TOOL_SCHEMAS['take_screenshot']) {
  TOOL_SCHEMAS['take_screenshot'].args.region = {
    ...TOOL_SCHEMAS['take_screenshot'].args.region,
    type: 'json',
    label: 'Region',
    description: 'Optional capture area: { x, y, width, height }. Leave empty for full screen.',
  };
}

// ============================================================================
// MATH COMPARE — op as dropdown
// ============================================================================

if (TOOL_SCHEMAS['math_compare']) {
  TOOL_SCHEMAS['math_compare'].args.op = {
    type: 'select',
    label: 'Operator',
    description: 'Comparison operator',
    options: COMPARE_OP_OPTIONS,
    required: true,
    default: 'gt',
  };
}

// ============================================================================
// MATH LIST TOOLS — x as array of numbers
// ============================================================================

for (const toolId of ['math_sum', 'math_mean', 'math_max', 'math_min']) {
  if (TOOL_SCHEMAS[toolId]?.args?.x) {
    TOOL_SCHEMAS[toolId].args.x = {
      type: 'array',
      label: 'Numbers',
      description: 'List of numbers to process. Use {{variable}} for dynamic values.',
      itemType: 'number' as any,
      default: [1, 2, 3],
    };
  }
}

// ============================================================================
// STREAM TOOLS — only the 4 user-facing advanced tools
// ============================================================================

if (TOOL_SCHEMAS['stream_create']?.args?.kind) {
  TOOL_SCHEMAS['stream_create'].args.kind = {
    type: 'select',
    label: 'Stream Kind',
    description: 'Type of data the stream carries',
    options: STREAM_KIND_OPTIONS,
    default: 'bytes',
  };
}

// ============================================================================
// CLOUD AI VISION — schema as JSON editor
// ============================================================================

if (TOOL_SCHEMAS['cloud_ai_vision']) {
  TOOL_SCHEMAS['cloud_ai_vision'].args = {
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'What to analyze in the image',
      required: true,
      placeholder: 'Detect people and summarize the scene.',
    },
    imagePath: {
      type: 'path',
      label: 'Image Path',
      description: 'Path to the image file to analyze',
      placeholder: 'C:/path/to/image.png',
    },
    schema: {
      type: 'json',
      label: 'Output Schema',
      description: 'Define expected JSON output structure. Example: {"person_present": {"type": "boolean"}, "summary": {"type": "string"}}',
    },
  };
}

// ============================================================================
// TASK CRUD — action as dropdown
// ============================================================================

if (TOOL_SCHEMAS['task_crud']?.args?.action) {
  TOOL_SCHEMAS['task_crud'].args.action = {
    type: 'select',
    label: 'Action',
    description: 'What operation to perform on tasks',
    options: TASK_ACTION_OPTIONS,
    default: 'create',
  };
  TOOL_SCHEMAS['task_crud'].args.task = {
    type: 'json',
    label: 'Task Data',
    description: 'Task object with title, description, status, etc.',
  };
}

// ============================================================================
// SET VARIABLE — scope as dropdown (workflow vs local)
// ============================================================================

if (TOOL_SCHEMAS['set_variable']) {
  if (TOOL_SCHEMAS['set_variable'].args.scope) {
    TOOL_SCHEMAS['set_variable'].args.scope = {
      type: 'select',
      label: 'Scope',
      description: 'Workflow = shared across all stuard files in this workflow. Local = scoped to this stuard file only.',
      options: VARIABLE_SCOPE_OPTIONS,
      default: 'workflow',
    };
  }
  TOOL_SCHEMAS['set_variable'].args.name = {
    type: 'string',
    label: 'Variable Name',
    description: 'Name of the variable. Workflow-scoped vars are accessible across all stuard files. Local vars are file-scoped.',
    placeholder: 'streamed_frame',
  };
  TOOL_SCHEMAS['set_variable'].args.value = {
    type: 'string',
    label: 'Value',
    description: 'The value to store. Use template variables like {{stepId.field}} to reference other step outputs. For stream wiring: {{stepId.chunk}} gives the current frame/chunk.',
    placeholder: '{{capture.chunk}} or {{pose.outputDataUrl}}',
  };
}

// ============================================================================
// VARIABLE TOOLS — notifyUi toggle (live-push to open custom_ui windows)
// ============================================================================

const NOTIFY_UI_SCHEMA = {
  type: 'boolean' as const,
  label: 'Live Update Custom UI',
  description: 'When enabled, any open custom_ui window using useVar() for this variable will re-render automatically when the value changes.',
  default: true,
};

for (const toolId of ['set_variable', 'toggle_variable', 'increment_variable', 'append_to_list']) {
  if (TOOL_SCHEMAS[toolId]) {
    TOOL_SCHEMAS[toolId].args.notifyUi = { ...NOTIFY_UI_SCHEMA };
  }
}

// ============================================================================
// COMPUTER USE — action as dropdown
// ============================================================================

const COMPUTER_USE_ACTION_OPTIONS: ArgOption[] = [
  { value: 'mouse_move', label: 'Move Mouse' },
  { value: 'left_click', label: 'Left Click' },
  { value: 'right_click', label: 'Right Click' },
  { value: 'double_click', label: 'Double Click' },
  { value: 'type', label: 'Type Text' },
  { value: 'key', label: 'Press Key' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'scroll_up', label: 'Scroll Up' },
  { value: 'scroll_down', label: 'Scroll Down' },
];

if (TOOL_SCHEMAS['computer_use']?.args?.action) {
  TOOL_SCHEMAS['computer_use'].args.action = {
    type: 'select',
    label: 'Action',
    description: 'What GUI action to perform',
    options: COMPUTER_USE_ACTION_OPTIONS,
    default: 'mouse_move',
  };
}

// ============================================================================
// ANALYZE MEDIA — sources as array, task as string
// ============================================================================

if (TOOL_SCHEMAS['analyze_media']) {
  TOOL_SCHEMAS['analyze_media'].args.task = {
    type: 'string',
    label: 'Task',
    description: 'What to do with the media. Use "transcribe" for transcription, or describe what to analyze.',
    placeholder: 'Summarize this media',
  };
  TOOL_SCHEMAS['analyze_media'].args.sources = {
    type: 'array',
    label: 'Media Sources',
    description: 'Add the media files to analyze. You can use template variables like {{step_N.filePath}} to reference outputs from previous steps.',
    itemType: 'object' as ArgType,
    required: true,
  };
  TOOL_SCHEMAS['analyze_media'].outputs = ['ok', 'summary'];
}

// ============================================================================
// GENERATE_IMAGE — Rich UI overrides
// ============================================================================

if (TOOL_SCHEMAS['generate_image']) {
  TOOL_SCHEMAS['generate_image'].label = 'Generate Image';
  TOOL_SCHEMAS['generate_image'].args = {
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'Text description of the image to generate. Be detailed and specific for best results.',
      required: true,
      placeholder: 'A futuristic city skyline at sunset with flying cars...',
    },
    input_images: {
      type: 'files',
      label: 'Input Images',
      description: 'Optional reference/source images for image-to-image or editing. Supported by the Gemini image models.',
      default: [],
    },
    model: {
      type: 'select',
      label: 'Model',
      description: 'Image model. You can also type any supported image model ID.',
      default: 'google/gemini-3.1-flash-image-preview',
      allowFreeform: true,
      options: [
        // Google — Nano Banana family
        { value: 'google/gemini-3.1-flash-image-preview', label: 'Nano Banana 2', description: 'Latest — fast + high quality (Google)', group: 'Google' },
        { value: 'google/gemini-3-pro-image-preview', label: 'Nano Banana Pro', description: 'Pro quality, up to 4K, best text rendering (Google)', group: 'Google' },
        { value: 'google/gemini-2.5-flash-image', label: 'Nano Banana', description: 'Fast & efficient (Google)', group: 'Google' },
        // OpenAI
        { value: 'openai/gpt-5-image', label: 'GPT-5 Image', description: 'High quality (OpenAI)', group: 'OpenAI' },
        { value: 'openai/gpt-5-image-mini', label: 'GPT-5 Image Mini', description: 'Fast & cheap (OpenAI)', group: 'OpenAI' },
      ],
    },
    aspect_ratio: {
      type: 'select',
      label: 'Aspect Ratio',
      description: 'Aspect ratio hint. auto = model default.',
      default: 'auto',
      allowFreeform: true,
      options: [
        { value: 'auto', label: 'Auto (1:1)', description: 'Default square' },
        { value: '1:1', label: '1:1', description: 'Square' },
        { value: '3:2', label: '3:2', description: 'Landscape' },
        { value: '2:3', label: '2:3', description: 'Portrait' },
        { value: '4:3', label: '4:3', description: 'Standard landscape' },
        { value: '3:4', label: '3:4', description: 'Standard portrait' },
        { value: '16:9', label: '16:9', description: 'Widescreen' },
        { value: '9:16', label: '9:16', description: 'Vertical / mobile' },
        { value: '21:9', label: '21:9', description: 'Ultra-wide' },
      ],
    },
    n: {
      type: 'number',
      label: 'Count',
      description: 'Number of images to generate (1-4).',
      default: 1,
      advanced: true,
    },
    format: {
      type: 'select',
      label: 'Format',
      description: 'Preferred output format hint. Actual format follows the model output.',
      default: 'png',
      advanced: true,
      options: [
        { value: 'png', label: 'PNG', description: 'Lossless, supports transparency' },
        { value: 'webp', label: 'WebP', description: 'Smaller file, supports transparency' },
        { value: 'jpeg', label: 'JPEG', description: 'Smallest file, no transparency' },
      ],
    },
  };
  TOOL_SCHEMAS['generate_image'].outputs = ['ok', 'images', 'model', 'provider', 'error'];
}

// ============================================================================
// SHOW_CHOICES — choices as JSON
// ============================================================================

if (TOOL_SCHEMAS['show_choices']) {
  TOOL_SCHEMAS['show_choices'].args.choices = {
    type: 'json',
    label: 'Choices',
    description: 'Array of choice objects: [{"id": "opt1", "label": "Option 1"}, ...]',
  };
}

// SHOW_TABLE — columns and data as JSON
if (TOOL_SCHEMAS['show_table']) {
  TOOL_SCHEMAS['show_table'].args.columns = {
    type: 'json',
    label: 'Columns',
    description: 'Column definitions: [{"key": "name", "label": "Name"}, ...]',
  };
  TOOL_SCHEMAS['show_table'].args.data = {
    type: 'json',
    label: 'Data',
    description: 'Array of row objects matching the column keys',
  };
}

// SHOW_INFO — items as JSON
if (TOOL_SCHEMAS['show_info']) {
  TOOL_SCHEMAS['show_info'].args.items = {
    type: 'json',
    label: 'Items',
    description: 'Array of key-value pairs: [{"label": "Name", "value": "John"}, ...]',
  };
}

// SHOW_DETAILS — sections as JSON
if (TOOL_SCHEMAS['show_details']) {
  TOOL_SCHEMAS['show_details'].args.sections = {
    type: 'json',
    label: 'Sections',
    description: 'Expandable sections: [{"title": "...", "content": "..."}, ...]',
  };
  TOOL_SCHEMAS['show_details'].args.variant = {
    ...TOOL_SCHEMAS['show_details'].args.variant,
    type: 'select',
    label: 'Style',
    description: 'Visual tone for the details panel.',
    options: VARIANT_OPTIONS,
    default: 'default',
    advanced: true,
  };
}

if (TOOL_SCHEMAS['show_link']) {
  TOOL_SCHEMAS['show_link'].args.variant = {
    ...TOOL_SCHEMAS['show_link'].args.variant,
    type: 'select',
    label: 'Preview Size',
    description: 'Choose how much space the link preview should use.',
    options: LINK_PREVIEW_VARIANT_OPTIONS,
    default: 'large',
  };
}

if (TOOL_SCHEMAS['show_info_card']) {
  TOOL_SCHEMAS['show_info_card'].args.variant = {
    ...TOOL_SCHEMAS['show_info_card'].args.variant,
    type: 'select',
    label: 'Tone',
    description: 'Visual tone for the card.',
    options: VARIANT_OPTIONS,
    default: 'info',
  };
}

if (TOOL_SCHEMAS['show_progress']) {
  TOOL_SCHEMAS['show_progress'].args.variant = {
    ...TOOL_SCHEMAS['show_progress'].args.variant,
    type: 'select',
    label: 'Progress Type',
    description: 'Pick the kind of work this progress represents.',
    options: PROGRESS_VARIANT_OPTIONS,
    default: 'download',
  };
  TOOL_SCHEMAS['show_progress'].args.status = {
    ...TOOL_SCHEMAS['show_progress'].args.status,
    type: 'select',
    label: 'Status',
    description: 'Current state of the work.',
    options: PROGRESS_STATUS_OPTIONS,
    default: 'active',
  };
  TOOL_SCHEMAS['show_progress'].args.color = {
    ...TOOL_SCHEMAS['show_progress'].args.color,
    type: 'select',
    label: 'Color',
    description: 'Accent color for the progress bar.',
    options: PROGRESS_COLOR_OPTIONS,
    default: 'blue',
    advanced: true,
  };
}

// SHOW_FILES — nodes as JSON
if (TOOL_SCHEMAS['show_files']) {
  TOOL_SCHEMAS['show_files'].args.nodes = {
    type: 'json',
    label: 'File Tree',
    description: 'Tree structure: [{"name": "src", "type": "folder", "children": [...]}, ...]',
  };
}

// SHOW_COLORS — colors as array
if (TOOL_SCHEMAS['show_colors']) {
  TOOL_SCHEMAS['show_colors'].args.colors = {
    type: 'array',
    label: 'Colors',
    description: 'List of color hex values',
    itemType: 'string',
  };
}

// ============================================================================
// DATABASE TOOLS — Simplified, non-technical schemas
// ============================================================================

if (TOOL_SCHEMAS['db_store']) {
  TOOL_SCHEMAS['db_store'].label = 'Save Document';
  TOOL_SCHEMAS['db_store'].description = 'Save a document (any JSON data) into a collection. Collections are like folders — they group related documents together. The collection is created automatically if it doesn\'t exist yet. If a document with the same ID already exists, it gets updated.';
  TOOL_SCHEMAS['db_store'].args = {
    table: {
      type: 'string',
      label: 'Collection',
      description: 'The name of the collection to save into. Think of it like a folder name — e.g. "contacts", "notes", "orders". Created automatically if new.',
      required: true,
      placeholder: 'my_collection',
    },
    id: {
      type: 'string',
      label: 'Document ID',
      description: 'A unique identifier for this document. Leave empty to auto-generate one. If you provide an existing ID, the document will be updated.',
      placeholder: 'Leave empty for auto-ID',
    },
    data: {
      type: 'json',
      label: 'Data',
      description: 'The fields and values to save. Use the + button to add fields, or switch to JSON mode. You can store any kind of data — text, numbers, yes/no, or nested objects.',
      required: true,
    },
  };
}

if (TOOL_SCHEMAS['db_retrieve']) {
  TOOL_SCHEMAS['db_retrieve'].label = 'Get Document';
  TOOL_SCHEMAS['db_retrieve'].description = 'Fetch a single document from a collection by its ID. Returns the full document with all its fields, plus when it was created and last updated.';
  TOOL_SCHEMAS['db_retrieve'].args = {
    table: {
      type: 'string',
      label: 'Collection',
      description: 'Which collection to look in.',
      required: true,
      placeholder: 'my_collection',
    },
    id: {
      type: 'string',
      label: 'Document ID',
      description: 'The ID of the document to get. Tip: use {{step_id.id}} to reference an ID from a previous step.',
      required: true,
      placeholder: 'document-id-here',
    },
  };
}

if (TOOL_SCHEMAS['db_search']) {
  TOOL_SCHEMAS['db_search'].label = 'Search Documents';
  TOOL_SCHEMAS['db_search'].description = 'Find documents in a collection. Add filters to narrow results — e.g. find all contacts where city is "London". Leave filters empty to get all documents.';
  TOOL_SCHEMAS['db_search'].args = {
    table: {
      type: 'string',
      label: 'Collection',
      description: 'Which collection to search in.',
      required: true,
      placeholder: 'my_collection',
    },
    filters: {
      type: 'json',
      label: 'Filters',
      description: 'Match documents by field values. Add a field name and the value it should equal. Leave empty to return all documents.',
    },
    limit: {
      type: 'number',
      label: 'Max Results',
      description: 'Maximum number of documents to return.',
      default: 100,
    },
  };
}

if (TOOL_SCHEMAS['db_delete']) {
  TOOL_SCHEMAS['db_delete'].label = 'Delete Document';
  TOOL_SCHEMAS['db_delete'].description = 'Permanently remove a document from a collection. This cannot be undone.';
  TOOL_SCHEMAS['db_delete'].args = {
    table: {
      type: 'string',
      label: 'Collection',
      description: 'Which collection to delete from.',
      required: true,
      placeholder: 'my_collection',
    },
    id: {
      type: 'string',
      label: 'Document ID',
      description: 'The ID of the document to remove. Tip: use {{step_id.id}} to reference an ID from a previous step.',
      required: true,
      placeholder: 'document-id-here',
    },
  };
}

if (TOOL_SCHEMAS['db_query']) {
  TOOL_SCHEMAS['db_query'].label = 'Table Query';
  TOOL_SCHEMAS['db_query'].description = 'Find, add, edit, or remove rows in a table. Use the visual builder to pick what you want to do — no coding needed. For flexible document storage, use Save/Get/Search Document instead.';
  TOOL_SCHEMAS['db_query'].args = {
    query: {
      type: 'string',
      label: 'Query',
      description: 'Choose an action above and fill in the fields. The query is built automatically.',
      required: true,
    },
    params: {
      type: 'array',
      label: 'Parameters',
      description: 'Extra values for the query. Usually not needed — the builder handles this.',
      itemType: 'string',
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['db_list_tables']) {
  TOOL_SCHEMAS['db_list_tables'].label = 'List All Data';
  TOOL_SCHEMAS['db_list_tables'].description = 'See every collection and table in your workflow database. Collections hold documents (from Save Document), tables hold structured rows (from Create Table).';
}

// ============================================================================
// EMBEDDINGS TOOLS — Simplified for non-technical users
// ============================================================================

if (TOOL_SCHEMAS['embed_text']) {
  TOOL_SCHEMAS['embed_text'].label = 'Embed Text';
  TOOL_SCHEMAS['embed_text'].description = 'Convert text into a numeric vector so you can search for similar content later. You can embed up to 100 texts at once.';
  TOOL_SCHEMAS['embed_text'].args = {
    texts: {
      type: 'array',
      label: 'Texts to Embed',
      description: 'The text strings to convert into vectors. Each text gets its own vector.',
      itemType: 'string',
      required: true,
    },
  };
}

if (TOOL_SCHEMAS['vector_similarity']) {
  TOOL_SCHEMAS['vector_similarity'].label = 'Find Similar';
  TOOL_SCHEMAS['vector_similarity'].description = 'Compare a query vector against a list of candidates and return the most similar ones, ranked by score.';
  TOOL_SCHEMAS['vector_similarity'].args = {
    query: {
      type: 'json',
      label: 'Query Vector',
      description: 'The embedding vector to search with. Usually from a previous Embed Text step: {{embed_step.embeddings.0}}',
      required: true,
    },
    candidates: {
      type: 'json',
      label: 'Candidates',
      description: 'Array of items to compare against. Each needs: { "id": "...", "vector": [...] }. Optionally include "metadata" for extra info.',
      required: true,
    },
    topK: {
      type: 'number',
      label: 'Max Results',
      description: 'How many of the best matches to return.',
      default: 10,
    },
    threshold: {
      type: 'number',
      label: 'Min Score',
      description: 'Only return results with a similarity score above this value (0 to 1). 0 = return everything, 0.8 = very similar only.',
      default: 0.5,
    },
  };
}

if (TOOL_SCHEMAS['embed_and_store']) {
  TOOL_SCHEMAS['embed_and_store'].label = 'Embed & Prepare';
  TOOL_SCHEMAS['embed_and_store'].description = 'Embed a single text and package it for storage. The result includes the vector and can be saved with "Save Document".';
  TOOL_SCHEMAS['embed_and_store'].args = {
    text: {
      type: 'string',
      label: 'Text',
      description: 'The text to embed and prepare for storage.',
      required: true,
      placeholder: 'Enter the text to embed...',
    },
    id: {
      type: 'string',
      label: 'Document ID',
      description: 'Optional unique ID. Leave empty to auto-generate.',
      placeholder: 'Leave empty for auto-ID',
    },
    metadata: {
      type: 'json',
      label: 'Extra Info',
      description: 'Optional extra data to attach. Example: { "source": "email", "date": "2025-01-15" }',
    },
  };
}

// ============================================================================
// AI AGENT NODES — Full smart-arg schemas
// ============================================================================

// Dynamically generate model options from models.json — single source of truth.
// When models.json is updated, these options update automatically at build time.
import modelsData from '../../../../../cloud-ai/src/models.json';

interface ModelEntry {
  id: string;
  name: string;
  category: string;
  contextWindow?: number;
  pricing: { in: number; out: number; cached?: number };
}

function formatCtx(ctx?: number): string {
  if (!ctx) return '';
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(ctx % 1000000 === 0 ? 0 : 1)}M ctx`;
  return `${Math.round(ctx / 1000)}K ctx`;
}

function buildModelOptions(models: ModelEntry[]): ArgOption[] {
  const categoryLabel: Record<string, string> = {
    smart: 'Smart',
    balanced: 'Balanced',
    fast: 'Fast',
    research: 'Research',
  };
  const categoryOrder = ['smart', 'balanced', 'fast', 'research'];

  const sorted = [...models].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return sorted.map(m => ({
    value: m.id,
    label: m.name,
    description: `${categoryLabel[m.category] || m.category} · $${m.pricing.in}/$${m.pricing.out} per 1M tokens · ${formatCtx(m.contextWindow)}`,
  }));
}

const AGENT_MODEL_OPTIONS: ArgOption[] = buildModelOptions(modelsData as ModelEntry[]);

// ANALYZE MEDIA — model picker (uses full AGENT_MODEL_OPTIONS, shown only when mode=custom)
if (TOOL_SCHEMAS['analyze_media']) {
  TOOL_SCHEMAS['analyze_media'].args.model = {
    type: 'select',
    label: 'Model',
    description: 'Choose any model from the OpenRouter catalog to use for media analysis.',
    options: AGENT_MODEL_OPTIONS,
    default: '',
    allowFreeform: true,
    placeholder: 'Search for a model...',
    showWhen: { field: 'mode', value: 'custom' },
  };
}

// AI INFERENCE — replace placeholder MODEL_OPTIONS with the full curated Stuard catalog
// (same list used by the main Stuard agent). Done here because AGENT_MODEL_OPTIONS is
// built later in this file.
if (TOOL_SCHEMAS['ai_inference']?.args?.model) {
  TOOL_SCHEMAS['ai_inference'].args.model = {
    ...TOOL_SCHEMAS['ai_inference'].args.model,
    type: 'select',
    options: AGENT_MODEL_OPTIONS,
    allowFreeform: true,
    placeholder: 'Search for a model...',
  };
}

const AGENT_OUTPUT_MODE_OPTIONS: ArgOption[] = [
  { value: 'text', label: 'Text', description: 'Free-form text response' },
  { value: 'json', label: 'JSON', description: 'Structured JSON output (use with Output Schema)' },
];

const AGENT_MAX_STEPS_OPTIONS: ArgOption[] = [
  { value: 1, label: '1 step', description: 'Single response, no tool use' },
  { value: 5, label: '5 steps', description: 'Light tool use' },
  { value: 10, label: '10 steps', description: 'Default — moderate reasoning' },
  { value: 20, label: '20 steps', description: 'Complex tasks with multiple tool calls' },
  { value: 50, label: '50 steps', description: 'Maximum — very complex multi-step tasks' },
];

// Agent tools are now loaded dynamically from the desktop TOOL_REGISTRY via IPC.
// This empty array serves as the initial/fallback value — SmartArgEditor will
// replace it with the live tool list fetched from workflows:getAgentToolOptions.
const AGENT_AVAILABLE_TOOLS: ArgOption[] = [];

// agent_node — Full AI Agent step
TOOL_SCHEMAS['agent_node'] = {
  name: 'agent_node',
  label: 'AI Agent',
  description: 'Run an AI agent as a workflow step. Can use tools, reason, and return text or JSON.',
  category: 'agent',
  args: {
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'The instruction for the agent. Be specific. Use {{step_id.field}} to reference previous step outputs.',
      required: true,
      placeholder: 'Analyze the input and provide a summary...',
    },
    context: {
      type: 'string',
      label: 'Context',
      description: 'Additional data to feed the agent (previous step output, file contents, etc.)',
      placeholder: '{{previous_step.text}}',
    },
    model: {
      type: 'select',
      label: 'Model',
      description: 'Which AI model to use',
      options: AGENT_MODEL_OPTIONS,
      default: 'google/gemini-3.1-pro-preview',
    },
    outputMode: {
      type: 'select',
      label: 'Output Mode',
      description: 'What format the agent should return',
      options: AGENT_OUTPUT_MODE_OPTIONS,
      default: 'text',
    },
    tools: {
      type: 'multiselect',
      label: 'Tools',
      description: 'Pick which tools the agent can use. Leave empty = all default tools.',
      options: AGENT_AVAILABLE_TOOLS,
    },
    maxSteps: {
      type: 'select',
      label: 'Max Steps',
      description: 'Maximum tool-use iterations before forcing a final answer',
      options: AGENT_MAX_STEPS_OPTIONS,
      default: 10,
    },
    memory: {
      type: 'memory' as ArgType,
      label: 'Memory',
      description: 'Configure what the agent remembers about you — identity, preferences, conversation history, and custom facts.',
      default: { enabled: false, lenses: { identity: true, directives: true, bio: true, relatedMemories: true, entities: true }, maxFacts: 6, conversationHistory: [], customFacts: [] },
    },
    outputSchema: {
      type: 'json',
      label: 'Output Schema',
      description: 'For JSON mode: define expected fields. Keys = field names, values = types. Example: {"category": "string", "score": "number"}',
      advanced: true,
      showWhen: { field: 'outputMode', value: 'json' },
    },
    systemPrompt: {
      type: 'string',
      label: 'System Prompt',
      description: 'Custom persona or behavior instructions for the agent',
      placeholder: 'You are a helpful data analyst...',
      advanced: true,
    },
    timeoutMs: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Maximum time in milliseconds (default 5 min = 300000)',
      default: 300000,
      placeholder: '300000',
      advanced: true,
    },
  },
  outputs: ['ok', 'text', 'json', 'model', 'toolCalls', 'durationMs', 'error'],
};

// ============================================================================
// MEDIAPIPE TOOLS — Input source, output format, and advanced grouping
// ============================================================================

const MEDIAPIPE_OUTPUT_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'base64', label: 'Base64 (Data URL)', description: 'Return annotated image as a base64 data URL — fast, no disk I/O' },
  { value: 'file', label: 'File (Save to Disk)', description: 'Save annotated image to a file path on disk' },
];

const MEDIAPIPE_VIDEO_TASK_OPTIONS: ArgOption[] = [
  { value: 'pose', label: 'Pose', description: 'Body pose landmarks (33 points)' },
  { value: 'hands', label: 'Hands', description: 'Hand landmarks (21 points per hand)' },
  { value: 'face_detection', label: 'Face Detection', description: 'Face bounding boxes + keypoints' },
  { value: 'face_mesh', label: 'Face Mesh', description: '468 face mesh landmarks' },
];

const MEDIAPIPE_IMAGE_TOOLS = [
  'mediapipe_pose', 'mediapipe_hands', 'mediapipe_face_detection',
  'mediapipe_face_mesh', 'mediapipe_segmentation', 'mediapipe_holistic',
];

for (const toolId of MEDIAPIPE_IMAGE_TOOLS) {
  if (!TOOL_SCHEMAS[toolId]) continue;
  const s = TOOL_SCHEMAS[toolId];

  // Input: imagePath as path picker, imageData as string for base64
  s.args.imagePath = {
    type: 'path',
    label: 'Image File',
    description: 'Path to an image file on disk. Use this OR Base64 Input below.',
    placeholder: 'C:/path/to/image.png',
  };
  s.args.imageData = {
    type: 'string',
    label: 'Base64 Input',
    description: 'Base64 data URL or template variable. For stream wiring: use {{stepId.chunk}} to receive frames from a capture_media stream. For previous step output: use {{stepId.outputDataUrl}}.',
    placeholder: '{{capture.chunk}} or {{step.outputDataUrl}}',
  };

  // Output format toggle
  s.args.outputFormat = {
    type: 'select',
    label: 'Output Format',
    description: 'How to return the annotated image. Base64 is faster (no disk), File saves to disk.',
    options: MEDIAPIPE_OUTPUT_FORMAT_OPTIONS,
    default: 'base64',
  };

  // Output path — only relevant when outputFormat=file
  s.args.outputPath = {
    type: 'path',
    label: 'Output File Path',
    description: 'Where to save the annotated image (only used when Output Format = File). Leave empty for auto-generated path.',
    placeholder: 'C:/output/annotated.png',
    advanced: true,
  };

  // Mark confidence/tracking as advanced
  if (s.args.minDetectionConfidence) {
    s.args.minDetectionConfidence = { ...s.args.minDetectionConfidence, type: 'number', label: 'Min Detection Confidence', description: 'Minimum confidence threshold for initial detection (0.0 - 1.0)', advanced: true };
  }
  if (s.args.minTrackingConfidence) {
    s.args.minTrackingConfidence = { ...s.args.minTrackingConfidence, type: 'number', label: 'Min Tracking Confidence', description: 'Minimum confidence threshold for landmark tracking (0.0 - 1.0)', advanced: true };
  }
  if (s.args.modelComplexity) {
    s.args.modelComplexity = {
      type: 'select', label: 'Model Complexity',
      description: 'Higher = more accurate but slower',
      options: [
        { value: 0, label: 'Lite', description: 'Fastest, least accurate' },
        { value: 1, label: 'Full', description: 'Balanced (default)' },
        { value: 2, label: 'Heavy', description: 'Most accurate, slowest' },
      ],
      default: 1, advanced: true,
    };
  }
  if (s.args.modelSelection) {
    s.args.modelSelection = {
      type: 'select', label: 'Model',
      options: toolId === 'mediapipe_segmentation'
        ? [{ value: 0, label: 'General', description: 'General selfie model' }, { value: 1, label: 'Landscape', description: 'Landscape-optimized' }]
        : [{ value: 0, label: 'Short Range', description: 'Within 2 meters' }, { value: 1, label: 'Full Range', description: 'Up to 5 meters' }],
      default: 0, advanced: true,
    };
  }
}

// Segmentation-specific overrides
if (TOOL_SCHEMAS['mediapipe_segmentation']) {
  TOOL_SCHEMAS['mediapipe_segmentation'].args.blurStrength = {
    ...TOOL_SCHEMAS['mediapipe_segmentation'].args.blurStrength,
    type: 'number', label: 'Blur Strength', description: 'Blur intensity (odd number, higher = more blur)', advanced: true,
  };
  TOOL_SCHEMAS['mediapipe_segmentation'].args.threshold = {
    ...TOOL_SCHEMAS['mediapipe_segmentation'].args.threshold,
    type: 'number', label: 'Segmentation Threshold', description: 'Confidence threshold for person/background split (0.0 - 1.0)', advanced: true,
  };
}

// Video tool — task as select, no imageData/outputFormat (video only)
if (TOOL_SCHEMAS['mediapipe_process_video']) {
  TOOL_SCHEMAS['mediapipe_process_video'].args.task = {
    type: 'select', label: 'Detection Task',
    description: 'Which MediaPipe detection to run on each frame',
    options: MEDIAPIPE_VIDEO_TASK_OPTIONS,
    default: 'pose',
  };
  TOOL_SCHEMAS['mediapipe_process_video'].args.videoPath = {
    type: 'path', label: 'Video File',
    description: 'Path to the input video file',
    required: true, placeholder: 'C:/path/to/video.mp4',
  };
  TOOL_SCHEMAS['mediapipe_process_video'].args.outputPath = {
    type: 'path', label: 'Output Video Path',
    description: 'Where to save the annotated output video. Leave empty for auto-generated path.',
    placeholder: 'C:/output/annotated.mp4',
  };
  TOOL_SCHEMAS['mediapipe_process_video'].args.maxFrames = {
    type: 'number', label: 'Max Frames',
    description: 'Maximum frames to process (0 = all frames)',
    default: 0, advanced: true,
  };
  TOOL_SCHEMAS['mediapipe_process_video'].args.sampleEveryN = {
    type: 'number', label: 'Sample Every N',
    description: 'Process every Nth frame (1 = every frame, 2 = skip half, etc.)',
    default: 1, advanced: true,
  };
  if (TOOL_SCHEMAS['mediapipe_process_video'].args.minDetectionConfidence) {
    TOOL_SCHEMAS['mediapipe_process_video'].args.minDetectionConfidence = {
      type: 'number', label: 'Min Detection Confidence',
      description: 'Minimum detection confidence (0.0 - 1.0)',
      advanced: true,
    };
  }
}

// ============================================================================
// STREAM TOGGLE — Add "Stream output" toggle to tools that support it
// Must be AFTER all schema definitions (agent_node is defined last)
// ============================================================================

for (const toolId of ['agent_node', 'ai_inference', 'http_request', 'run_python_script', 'capture_media', 'capture_screen', 'capture_system_audio', 'ollama_agent']) {
  if (TOOL_SCHEMAS[toolId]) {
    TOOL_SCHEMAS[toolId].args.stream = {
      type: 'boolean' as any,
      label: 'Stream Output',
      description: 'Stream output in real-time. Connect a stream wire (dashed) to the next step — it runs once per chunk.',
      default: false,
    };
  }
}

// Override stream description for capture tools with video-specific guidance
for (const toolId of ['capture_media', 'capture_screen']) {
  if (TOOL_SCHEMAS[toolId]?.args?.stream) {
    TOOL_SCHEMAS[toolId].args.stream = {
      ...TOOL_SCHEMAS[toolId].args.stream,
      description: 'Stream live chunks to the next step. Access each chunk via {{stepId.chunk}}, {{stepId.text}}, {{stepId.chunkIndex}}, or {{stepId.fullText}}. Audio-enabled captures also expose {{stepId.volumePercent}} when available.',
    };
  }
}

if (TOOL_SCHEMAS['capture_system_audio']?.args?.stream) {
  TOOL_SCHEMAS['capture_system_audio'].args.stream = {
    ...TOOL_SCHEMAS['capture_system_audio'].args.stream,
    description: 'Stream live audio chunks to the next step. Access data via {{stepId.chunk}}, {{stepId.text}}, {{stepId.chunkIndex}}, {{stepId.fullText}}, and {{stepId.volumePercent}} when volume metadata is available.',
  };
}

// ============================================================================
// OLLAMA TOOLS — User-friendly local AI model integration
// ============================================================================

// ollama_status — no args needed, just check status
if (TOOL_SCHEMAS['ollama_status']) {
  TOOL_SCHEMAS['ollama_status'].label = 'Check Ollama Status';
  TOOL_SCHEMAS['ollama_status'].description = 'Check if Ollama is running locally and list available models. No configuration needed.';
}

// ollama_chat — multi-turn conversation
if (TOOL_SCHEMAS['ollama_agent']) {
  TOOL_SCHEMAS['ollama_agent'].label = 'Ollama Agent';
  TOOL_SCHEMAS['ollama_agent'].description = 'One combined local AI node for prompt/chat/image tasks. It can inject local memory into the system prompt and use a curated set of workflow tools through one smart bridge.';
  TOOL_SCHEMAS['ollama_agent'].args = {
    model: {
      type: 'select',
      label: 'Model',
      description: 'Which local Ollama model to use. Pick a preset or type your own model name.',
      options: OLLAMA_CHAT_MODEL_OPTIONS,
      default: 'llama3.2',
      required: true,
      allowFreeform: true,
      placeholder: 'e.g. llama3.2, qwen3, mistral',
    },
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'Main task for the local agent. You can reference previous step outputs with {{step.field}}.',
      placeholder: 'Summarize these notes and draft a reply...',
    },
    context: {
      type: 'string',
      label: 'Extra Context',
      description: 'Optional extra text appended after the main prompt.',
      placeholder: 'Additional background, constraints, or raw data...',
    },
    messages: {
      type: 'array',
      label: 'Conversation History',
      description: 'Optional prior chat messages for multi-turn local conversations.',
      itemType: 'object',
      advanced: true,
    },
    systemPrompt: {
      type: 'string',
      label: 'System Prompt',
      description: 'Additional instructions that shape the agent behavior.',
      placeholder: 'You are a careful code reviewer...',
    },
    outputMode: {
      type: 'select',
      label: 'Output Mode',
      description: 'Return plain text or parse the final answer as JSON.',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'json', label: 'JSON' },
      ],
      default: 'text',
    },
    outputSchema: {
      type: 'json',
      label: 'Target JSON Schema',
      description: 'Optional schema hint for the final JSON answer.',
      placeholder: '{ "summary": "string", "priority": "number" }',
      showWhen: { field: 'outputMode', value: 'json' },
      advanced: true,
    },
    toolMode: {
      type: 'select',
      label: 'Tool Access',
      description: 'Choose whether the local agent gets the built-in curated tools, only selected tools, or no tools.',
      options: [
        { value: 'curated', label: 'Curated Default' },
        { value: 'selected', label: 'Selected Only' },
        { value: 'none', label: 'No Tools' },
      ],
      default: 'curated',
    },
    tools: {
      type: 'array',
      label: 'Selected Tools',
      description: 'The exact workflow tools the local agent may use when Tool Access is set to Selected Only.',
      itemType: 'string',
      advanced: true,
      showWhen: { field: 'toolMode', value: 'selected' },
    },
    maxSteps: {
      type: 'number',
      label: 'Max Tool Steps',
      description: 'Maximum number of tool rounds before the local agent stops.',
      default: 8,
    },
    timeoutMs: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Total timeout for the full local agent run.',
      default: 300000,
      advanced: true,
    },
    injectMemory: {
      type: 'boolean',
      label: 'Inject Memory',
      description: 'Add local identity, directives, bio, and related memories to the system prompt.',
      default: false,
    },
    memory: {
      type: 'object',
      label: 'Advanced Memory Config',
      description: 'Optional granular memory settings, custom facts, and conversation history.',
      advanced: true,
    },
    imagePath: {
      type: 'path',
      label: 'Image File',
      description: 'Optional image for multimodal local models.',
      placeholder: 'C:/images/reference.png',
      advanced: true,
    },
    images: {
      type: 'array',
      label: 'Image Inputs',
      description: 'Optional multiple images, each with { path } or { data }.',
      itemType: 'object',
      advanced: true,
    },
    stream: {
      type: 'boolean',
      label: 'Stream Result',
      description: 'Write the final result into a workflow stream so downstream nodes can consume it.',
      default: false,
    },
    think: {
      type: 'boolean',
      label: 'Enable Thinking',
      description: 'For reasoning-capable local models that expose a separate thinking trace.',
      default: false,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      description: 'Creativity level (0.0 = focused, 1.0 = creative).',
      default: 0.7,
      advanced: true,
    },
    num_predict: {
      type: 'number',
      label: 'Max Tokens',
      description: 'Maximum tokens to generate in the final answer.',
      default: 2048,
      advanced: true,
    },
  };
}

if (TOOL_SCHEMAS['ollama_chat']) {
  TOOL_SCHEMAS['ollama_chat'].label = 'Ollama Chat';
  TOOL_SCHEMAS['ollama_chat'].args = {
    model: {
      type: 'select',
      label: 'Model',
      description: 'Which local model to use. Pick from common models or type a custom model name.',
      options: OLLAMA_CHAT_MODEL_OPTIONS,
      default: 'llama3.2',
      required: true,
      allowFreeform: true,
      placeholder: 'e.g. llama3.2, mistral, gemma2',
    },
    messages: {
      type: 'array',
      label: 'Messages',
      description: 'Conversation history. Each message has a role (user/assistant/system) and content.',
      itemType: 'object',
      required: true,
    },
    system: {
      type: 'string',
      label: 'System Prompt',
      description: 'Instructions that guide the AI\'s behavior (e.g. "You are a helpful coding assistant").',
      placeholder: 'You are a helpful assistant...',
    },
    stream: {
      type: 'boolean',
      label: 'Stream Response',
      description: 'Stream tokens as they generate. Connect a stream wire to process chunks in real-time.',
      default: false,
    },
    think: {
      type: 'boolean',
      label: 'Enable Thinking',
      description: 'For reasoning models (deepseek-r1, qwq). Shows the model\'s reasoning process separately from the answer.',
      default: false,
    },
    tools: {
      type: 'array',
      label: 'Tools (Function Calling)',
      description: 'Define functions the model can call. Works with: qwen3, llama3.2, mistral, mixtral. Format: [{type:"function", function:{name, description, parameters}}]',
      itemType: 'object',
      advanced: true,
    },
    json_mode: {
      type: 'boolean',
      label: 'JSON Mode',
      description: 'Force the model to output valid JSON. Useful for structured data extraction.',
      default: false,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      description: 'Creativity level (0.0 = deterministic, 1.0 = creative, 2.0 = wild). Default: 0.7',
      default: 0.7,
      advanced: true,
    },
    num_predict: {
      type: 'number',
      label: 'Max Tokens',
      description: 'Maximum tokens to generate. -1 for unlimited, or set a limit like 2048.',
      default: 2048,
      advanced: true,
    },
  };
}

// ollama_generate — single-prompt completion
if (TOOL_SCHEMAS['ollama_generate']) {
  TOOL_SCHEMAS['ollama_generate'].label = 'Ollama Generate';
  TOOL_SCHEMAS['ollama_generate'].args = {
    model: {
      type: 'select',
      label: 'Model',
      description: 'Which local model to use. Pick from common models or type a custom model name.',
      options: OLLAMA_CHAT_MODEL_OPTIONS,
      default: 'llama3.2',
      required: true,
      allowFreeform: true,
      placeholder: 'e.g. llama3.2, mistral, gemma2',
    },
    prompt: {
      type: 'string',
      label: 'Prompt',
      description: 'What you want the AI to generate or complete.',
      required: true,
      placeholder: 'Write a short story about...',
    },
    system: {
      type: 'string',
      label: 'System Prompt',
      description: 'Instructions that guide the AI\'s behavior.',
      placeholder: 'You are a creative writer...',
    },
    stream: {
      type: 'boolean',
      label: 'Stream Response',
      description: 'Stream tokens as they generate. Connect a stream wire to process chunks in real-time.',
      default: false,
    },
    think: {
      type: 'boolean',
      label: 'Enable Thinking',
      description: 'For reasoning models (deepseek-r1, qwq). Shows the model\'s reasoning process separately from the answer.',
      default: false,
    },
    json_mode: {
      type: 'boolean',
      label: 'JSON Mode',
      description: 'Force the model to output valid JSON.',
      default: false,
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      description: 'Creativity level (0.0 = focused, 1.0 = creative). Default: 0.7',
      default: 0.7,
      advanced: true,
    },
    num_predict: {
      type: 'number',
      label: 'Max Tokens',
      description: 'Maximum tokens to generate. -1 for unlimited.',
      default: 2048,
      advanced: true,
    },
  };
}

// ollama_vision — image analysis
if (TOOL_SCHEMAS['ollama_vision']) {
  TOOL_SCHEMAS['ollama_vision'].label = 'Ollama Vision';
  TOOL_SCHEMAS['ollama_vision'].args = {
    model: {
      type: 'select',
      label: 'Vision Model',
      description: 'Which multimodal model to use for image understanding.',
      options: OLLAMA_VISION_MODEL_OPTIONS,
      default: 'llava',
      required: true,
      allowFreeform: true,
      placeholder: 'e.g. llava, moondream',
    },
    imagePath: {
      type: 'path',
      label: 'Image File',
      description: 'Path to the image file to analyze. Stays local — no cloud upload.',
      required: true,
      placeholder: 'C:/photos/image.jpg',
    },
    prompt: {
      type: 'string',
      label: 'Question / Prompt',
      description: 'What to ask about the image.',
      default: 'Describe this image in detail.',
      placeholder: 'What objects are in this image?',
    },
    temperature: {
      type: 'number',
      label: 'Temperature',
      description: 'Creativity level for the response.',
      default: 0.7,
      advanced: true,
    },
    num_predict: {
      type: 'number',
      label: 'Max Tokens',
      description: 'Maximum tokens in the response.',
      default: 2048,
      advanced: true,
    },
  };
}

// ollama_embeddings — vector embeddings
if (TOOL_SCHEMAS['ollama_embeddings']) {
  TOOL_SCHEMAS['ollama_embeddings'].label = 'Ollama Embeddings';
  TOOL_SCHEMAS['ollama_embeddings'].args = {
    model: {
      type: 'select',
      label: 'Embedding Model',
      description: 'Which model to use for generating embeddings.',
      options: OLLAMA_EMBEDDING_MODEL_OPTIONS,
      default: 'nomic-embed-text',
      required: true,
      allowFreeform: true,
      placeholder: 'e.g. nomic-embed-text, all-minilm',
    },
    input: {
      type: 'string',
      label: 'Text to Embed',
      description: 'The text to convert into a vector embedding for similarity search or RAG.',
      required: true,
      placeholder: 'Enter text to generate embeddings for...',
    },
  };
}

// ollama_models — model management
if (TOOL_SCHEMAS['ollama_models']) {
  TOOL_SCHEMAS['ollama_models'].label = 'Manage Ollama Models';
  TOOL_SCHEMAS['ollama_models'].args = {
    action: {
      type: 'select',
      label: 'Action',
      description: 'What to do with models.',
      options: OLLAMA_MODEL_ACTION_OPTIONS,
      default: 'list',
      required: true,
    },
    model: {
      type: 'select',
      label: 'Model Name',
      description: 'Which model to pull, delete, show, or copy. Not needed for "list" or "running".',
      options: [...OLLAMA_CHAT_MODEL_OPTIONS, ...OLLAMA_VISION_MODEL_OPTIONS, ...OLLAMA_EMBEDDING_MODEL_OPTIONS],
      allowFreeform: true,
      placeholder: 'e.g. llama3.2, llava, nomic-embed-text',
      showWhen: { field: 'action', values: ['pull', 'delete', 'show', 'copy'] },
    },
    destination: {
      type: 'string',
      label: 'New Name (for Copy)',
      description: 'The new name when copying a model.',
      placeholder: 'my-custom-model',
      showWhen: { field: 'action', value: 'copy' },
    },
  };
}

// ============================================================================
// BROWSER — Schema overrides for better UX
// ============================================================================

const BROWSER_USE_MODE_OPTIONS: ArgOption[] = [
  { value: 'headed', label: 'Headed (Visible)', description: 'Browser window is visible on screen' },
  { value: 'headless', label: 'Headless (Hidden)', description: 'No visible browser window — runs in background' },
];

const BROWSER_USE_WAIT_UNTIL_OPTIONS: ArgOption[] = [
  { value: 'domcontentloaded', label: 'DOM Content Loaded', description: 'Wait until the HTML is parsed (fastest)' },
  { value: 'load', label: 'Full Load', description: 'Wait for all resources (images, scripts) to load' },
  { value: 'networkidle', label: 'Network Idle', description: 'Wait until no network requests for 500ms (slowest but most reliable)' },
  { value: 'commit', label: 'Commit', description: 'Wait for first server response only' },
];

const BROWSER_USE_SCROLL_DIRECTION_OPTIONS: ArgOption[] = [
  { value: 'down', label: 'Down' },
  { value: 'up', label: 'Up' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const BROWSER_USE_TAB_ACTION_OPTIONS: ArgOption[] = [
  { value: 'list', label: 'List Tabs', description: 'Get all open tabs' },
  { value: 'new', label: 'New Tab', description: 'Open a new browser tab' },
  { value: 'switch', label: 'Switch Tab', description: 'Switch to a tab by index' },
  { value: 'close', label: 'Close Tab', description: 'Close a tab by index' },
];

const BROWSER_USE_COOKIE_ACTION_OPTIONS: ArgOption[] = [
  { value: 'get', label: 'Get Cookies', description: 'Get all cookies (optionally filtered by URL)' },
  { value: 'set', label: 'Set Cookies', description: 'Add or overwrite cookies' },
  { value: 'clear', label: 'Clear All', description: 'Delete all cookies' },
  { value: 'export', label: 'Export to File', description: 'Save cookies as JSON file' },
  { value: 'import', label: 'Import from File', description: 'Load cookies from a JSON file' },
];

const BROWSER_USE_CONTENT_MODE_OPTIONS: ArgOption[] = [
  { value: 'text', label: 'Text', description: 'Readable text content (default)' },
  { value: 'html', label: 'HTML', description: 'Raw HTML source code' },
];

const BROWSER_USE_WAIT_STATE_OPTIONS: ArgOption[] = [
  { value: 'visible', label: 'Visible', description: 'Wait until element appears on screen' },
  { value: 'hidden', label: 'Hidden', description: 'Wait until element becomes hidden' },
  { value: 'detached', label: 'Detached', description: 'Wait until element is removed from DOM' },
];

const BROWSER_USE_KEY_OPTIONS: ArgOption[] = [
  { value: 'Enter', label: 'Enter' },
  { value: 'Tab', label: 'Tab' },
  { value: 'Escape', label: 'Escape' },
  { value: 'Backspace', label: 'Backspace' },
  { value: 'Delete', label: 'Delete' },
  { value: 'ArrowUp', label: 'Arrow Up' },
  { value: 'ArrowDown', label: 'Arrow Down' },
  { value: 'ArrowLeft', label: 'Arrow Left' },
  { value: 'ArrowRight', label: 'Arrow Right' },
  { value: 'Space', label: 'Space' },
  { value: 'Home', label: 'Home' },
  { value: 'End', label: 'End' },
  { value: 'PageUp', label: 'Page Up' },
  { value: 'PageDown', label: 'Page Down' },
  { value: 'Control+a', label: 'Select All (Ctrl+A)' },
  { value: 'Control+c', label: 'Copy (Ctrl+C)' },
  { value: 'Control+v', label: 'Paste (Ctrl+V)' },
];

// browser_use_configure
if (TOOL_SCHEMAS['browser_use_configure']) {
  TOOL_SCHEMAS['browser_use_configure'].label = 'Configure Browser';
  TOOL_SCHEMAS['browser_use_configure'].args = {
    mode: {
      type: 'select',
      label: 'Browser Mode',
      description: 'How the browser runs. Headed shows a visible window; headless runs invisibly.',
      options: BROWSER_USE_MODE_OPTIONS,
      default: 'headed',
      required: true,
    },
    profile: {
      type: 'string',
      label: 'Profile Name',
      description: 'Named profile for persistent cookies and sessions across runs',
      default: 'default',
      placeholder: 'default',
      advanced: true,
    },
  };
}

// browser_use_navigate
if (TOOL_SCHEMAS['browser_use_navigate']) {
  TOOL_SCHEMAS['browser_use_navigate'].label = 'Navigate to URL';
  TOOL_SCHEMAS['browser_use_navigate'].args = {
    url: {
      type: 'string',
      label: 'URL',
      description: 'The web address to navigate to',
      required: true,
      placeholder: 'https://example.com',
    },
    wait_until: {
      type: 'select',
      label: 'Wait Until',
      description: 'When to consider navigation complete',
      options: BROWSER_USE_WAIT_UNTIL_OPTIONS,
      default: 'domcontentloaded',
    },
    wait_for_selector: {
      type: 'string',
      label: 'Wait for Selector',
      description: 'CSS selector to wait for after navigation (useful for SPAs)',
      placeholder: '#main-content, .loaded',
      advanced: true,
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Maximum time to wait for navigation',
      default: 30000,
      advanced: true,
    },
  };
}

// browser_use_click
if (TOOL_SCHEMAS['browser_use_click']) {
  TOOL_SCHEMAS['browser_use_click'].label = 'Click Element';
  TOOL_SCHEMAS['browser_use_click'].args = {
    selector: {
      type: 'string',
      label: 'CSS Selector',
      description: 'CSS selector of the element to click (e.g. #submit-btn, .nav-link)',
      placeholder: '#submit-btn',
    },
    text: {
      type: 'string',
      label: 'Visible Text',
      description: 'Click an element by its visible text (alternative to CSS selector)',
      placeholder: 'Sign In',
    },
    exact: {
      type: 'boolean',
      label: 'Exact Match',
      description: 'Require the text to match exactly (not just contain)',
      default: false,
      advanced: true,
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'How long to wait for the element',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_type
if (TOOL_SCHEMAS['browser_use_type']) {
  TOOL_SCHEMAS['browser_use_type'].label = 'Type Text';
  TOOL_SCHEMAS['browser_use_type'].args = {
    text: {
      type: 'string',
      label: 'Text to Type',
      description: 'The text to type into the field',
      required: true,
      placeholder: 'Enter your text here...',
    },
    selector: {
      type: 'string',
      label: 'CSS Selector',
      description: 'CSS selector of the input field. If empty, types into the currently focused element.',
      placeholder: '#email, input[name="username"]',
    },
    clear: {
      type: 'boolean',
      label: 'Clear First',
      description: 'Clear existing content before typing',
      default: true,
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_press_key
if (TOOL_SCHEMAS['browser_use_press_key']) {
  TOOL_SCHEMAS['browser_use_press_key'].label = 'Press Key';
  TOOL_SCHEMAS['browser_use_press_key'].args = {
    key: {
      type: 'select',
      label: 'Key',
      description: 'Keyboard key to press',
      options: BROWSER_USE_KEY_OPTIONS,
      allowFreeform: true,
      required: true,
      default: 'Enter',
      placeholder: 'Enter, Tab, Escape...',
    },
    selector: {
      type: 'string',
      label: 'Focus Selector',
      description: 'CSS selector to focus before pressing the key (optional)',
      placeholder: '#search-input',
      advanced: true,
    },
  };
}

// browser_use_screenshot
if (TOOL_SCHEMAS['browser_use_screenshot']) {
  TOOL_SCHEMAS['browser_use_screenshot'].label = 'Take Screenshot';
  TOOL_SCHEMAS['browser_use_screenshot'].args = {
    full_page: {
      type: 'boolean',
      label: 'Full Page',
      description: 'Capture the entire scrollable page instead of just the visible viewport',
      default: false,
    },
  };
}

// browser_use_content
if (TOOL_SCHEMAS['browser_use_content']) {
  TOOL_SCHEMAS['browser_use_content'].label = 'Get Page Content';
  TOOL_SCHEMAS['browser_use_content'].args = {
    mode: {
      type: 'select',
      label: 'Content Mode',
      description: 'What format to return the viewport content in',
      options: BROWSER_USE_CONTENT_MODE_OPTIONS,
      default: 'text',
    },
    max_length: {
      type: 'number',
      label: 'Max Length',
      description: 'Maximum number of characters to return',
      default: 15000,
      advanced: true,
    },
    wait_for_selector: {
      type: 'string',
      label: 'Wait for Selector',
      description: 'Wait for this CSS selector before extracting content',
      placeholder: '.article-body',
      advanced: true,
    },
    wait_timeout: {
      type: 'number',
      label: 'Wait Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_scroll
if (TOOL_SCHEMAS['browser_use_scroll']) {
  TOOL_SCHEMAS['browser_use_scroll'].label = 'Scroll Page';
  TOOL_SCHEMAS['browser_use_scroll'].args = {
    direction: {
      type: 'select',
      label: 'Direction',
      description: 'Which direction to scroll',
      options: BROWSER_USE_SCROLL_DIRECTION_OPTIONS,
      default: 'down',
    },
    amount: {
      type: 'number',
      label: 'Amount (px)',
      description: 'How many pixels to scroll',
      default: 500,
    },
    selector: {
      type: 'string',
      label: 'Container Selector',
      description: 'CSS selector of a scrollable container (scrolls the page if empty)',
      placeholder: '.scroll-container',
      advanced: true,
    },
  };
}

// browser_use_tabs
if (TOOL_SCHEMAS['browser_use_tabs']) {
  TOOL_SCHEMAS['browser_use_tabs'].label = 'Manage Tabs';
  TOOL_SCHEMAS['browser_use_tabs'].args = {
    action: {
      type: 'select',
      label: 'Action',
      description: 'What to do with tabs',
      options: BROWSER_USE_TAB_ACTION_OPTIONS,
      default: 'list',
      required: true,
    },
    url: {
      type: 'string',
      label: 'URL',
      description: 'URL to open in the new tab',
      placeholder: 'https://example.com',
      showWhen: { field: 'action', value: 'new' },
    },
    index: {
      type: 'number',
      label: 'Tab Index',
      description: 'Which tab to switch to or close (0-based)',
      default: 0,
      showWhen: { field: 'action', values: ['switch', 'close'] },
    },
  };
}

// browser_use_cookies
if (TOOL_SCHEMAS['browser_use_cookies']) {
  TOOL_SCHEMAS['browser_use_cookies'].label = 'Manage Cookies';
  TOOL_SCHEMAS['browser_use_cookies'].args = {
    action: {
      type: 'select',
      label: 'Action',
      description: 'What to do with cookies',
      options: BROWSER_USE_COOKIE_ACTION_OPTIONS,
      default: 'get',
      required: true,
    },
    urls: {
      type: 'array',
      label: 'Filter by URLs',
      description: 'Only return cookies for these URLs',
      itemType: 'string',
      placeholder: 'https://example.com',
      showWhen: { field: 'action', value: 'get' },
    },
    cookies: {
      type: 'json',
      label: 'Cookies',
      description: 'Array of cookie objects to set: [{name, value, domain, path}]',
      showWhen: { field: 'action', value: 'set' },
    },
    path: {
      type: 'path',
      label: 'File Path',
      description: 'Path for the cookies JSON file',
      placeholder: 'C:/cookies.json',
      showWhen: { field: 'action', values: ['export', 'import'] },
    },
  };
}

// browser_use_execute_script
if (TOOL_SCHEMAS['browser_use_execute_script']) {
  TOOL_SCHEMAS['browser_use_execute_script'].label = 'Execute JS Script';
  TOOL_SCHEMAS['browser_use_execute_script'].args = {
    script: {
      type: 'code',
      label: 'JavaScript Code',
      description: 'Code to run in the browser page context. Runs inside an async function — use return to send data back. An `args` object is in scope.',
      required: true,
      language: 'javascript',
      placeholder: 'return document.title;',
    },
    args: {
      type: 'json',
      label: 'Script Arguments',
      description: 'Named arguments exposed to the script as the `args` object',
      advanced: true,
    },
    wait_for_selector: {
      type: 'string',
      label: 'Wait for Selector',
      description: 'Wait for this CSS selector before running the script',
      placeholder: '#app.loaded',
      advanced: true,
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Maximum script execution time',
      default: 30000,
      advanced: true,
    },
  };
}

// browser_use_hover
if (TOOL_SCHEMAS['browser_use_hover']) {
  TOOL_SCHEMAS['browser_use_hover'].label = 'Hover Element';
  TOOL_SCHEMAS['browser_use_hover'].args = {
    selector: {
      type: 'string',
      label: 'CSS Selector',
      description: 'CSS selector of the element to hover over',
      placeholder: '.dropdown-trigger',
    },
    text: {
      type: 'string',
      label: 'Visible Text',
      description: 'Hover over an element by its visible text',
      placeholder: 'Account Menu',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_select_option
if (TOOL_SCHEMAS['browser_use_select_option']) {
  TOOL_SCHEMAS['browser_use_select_option'].label = 'Select Dropdown Option';
  TOOL_SCHEMAS['browser_use_select_option'].args = {
    selector: {
      type: 'string',
      label: 'Select Selector',
      description: 'CSS selector of the dropdown control, combobox, or native <select> element',
      required: true,
      placeholder: '#country-select, select[name="country"]',
    },
    label: {
      type: 'string',
      label: 'Option Text',
      description: 'Select by the visible text of the option (case-insensitive partial match)',
      placeholder: 'United States',
    },
    value: {
      type: 'string',
      label: 'Option Value',
      description: 'Select by the option\'s value attribute',
      placeholder: 'us',
    },
    index: {
      type: 'number',
      label: 'Option Index',
      description: 'Select by position (0-based)',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_get_dropdown_options
if (TOOL_SCHEMAS['browser_use_get_dropdown_options']) {
  TOOL_SCHEMAS['browser_use_get_dropdown_options'].label = 'Read Dropdown Options';
  TOOL_SCHEMAS['browser_use_get_dropdown_options'].args = {
    selector: {
      type: 'string',
      label: 'Dropdown Selector',
      description: 'CSS selector of the dropdown control (select, input, button, or combobox element)',
      required: true,
      placeholder: '#country-select, select[name="country"]',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_get_interactive_elements
if (TOOL_SCHEMAS['browser_use_get_interactive_elements']) {
  TOOL_SCHEMAS['browser_use_get_interactive_elements'].label = 'Get Interactive Elements';
  TOOL_SCHEMAS['browser_use_get_interactive_elements'].args = {
    wait_for_selector: {
      type: 'string',
      label: 'Wait for Selector',
      description: 'Wait for this CSS selector before scanning the page',
      placeholder: 'form, .loaded',
      advanced: true,
    },
    wait_timeout: {
      type: 'number',
      label: 'Wait Timeout (ms)',
      default: 3000,
      advanced: true,
    },
  };
}

// browser_use_fill_form
if (TOOL_SCHEMAS['browser_use_fill_form']) {
  TOOL_SCHEMAS['browser_use_fill_form'].label = 'Fill Form';
  TOOL_SCHEMAS['browser_use_fill_form'].args = {
    fields: {
      type: 'json',
      label: 'Fields',
      description: 'Map CSS selectors to values: {"#email": "user@example.com"} or array of {selector, value, type}. Use type "file" with a local path to upload files.',
      required: true,
    },
    submit: {
      type: 'boolean',
      label: 'Submit After Fill',
      description: 'Automatically submit the form after filling all fields',
      default: false,
    },
    form_selector: {
      type: 'string',
      label: 'Form Selector',
      description: 'CSS selector of the form element (helps find the submit button)',
      placeholder: '#login-form',
      advanced: true,
    },
  };
}

// browser_use_upload_file
if (TOOL_SCHEMAS['browser_use_upload_file']) {
  TOOL_SCHEMAS['browser_use_upload_file'].label = 'Upload Local File';
  TOOL_SCHEMAS['browser_use_upload_file'].args = {
    selector: {
      type: 'string',
      label: 'Target Selector',
      description: 'Optional CSS selector of the file input or upload control associated with it',
      placeholder: 'input[type="file"], label[for="resume"]',
    },
    filePath: {
      type: 'string',
      label: 'Local File Path',
      description: 'Path to the file on disk to upload',
      required: true,
      placeholder: 'C:/Users/name/Documents/resume.pdf',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      default: 5000,
      advanced: true,
    },
  };
}

// browser_use_wait_for
if (TOOL_SCHEMAS['browser_use_wait_for']) {
  TOOL_SCHEMAS['browser_use_wait_for'].label = 'Wait For';
  TOOL_SCHEMAS['browser_use_wait_for'].args = {
    selector: {
      type: 'string',
      label: 'CSS Selector',
      description: 'Wait for this element to appear/disappear',
      placeholder: '.results-loaded, #spinner',
    },
    text: {
      type: 'string',
      label: 'Text Content',
      description: 'Wait for this text to appear on the page',
      placeholder: 'Results found',
    },
    url_pattern: {
      type: 'string',
      label: 'URL Contains',
      description: 'Wait for the URL to contain this substring (e.g. "/dashboard", "?success=true")',
      placeholder: '/dashboard',
    },
    state: {
      type: 'select',
      label: 'Element State',
      description: 'What state to wait for',
      options: BROWSER_USE_WAIT_STATE_OPTIONS,
      default: 'visible',
    },
    timeout: {
      type: 'number',
      label: 'Timeout (ms)',
      description: 'Maximum time to wait before giving up',
      default: 10000,
    },
  };
}

// browser_use_status
if (TOOL_SCHEMAS['browser_use_status']) {
  TOOL_SCHEMAS['browser_use_status'].label = 'Browser Status';
}

export { TOOL_SCHEMAS };

export function getToolSchema(toolName: string): ToolSchema | undefined {
  return TOOL_SCHEMAS[toolName];
}

export function getToolsByCategory(category: string): ToolSchema[] {
  return Object.values(TOOL_SCHEMAS).filter(t => t.category === category);
}

export function getCategories(): string[] {
  const categories = new Set(Object.values(TOOL_SCHEMAS).map(t => t.category).filter(Boolean));
  return Array.from(categories) as string[];
}

export function getToolOutputs(toolName: string): string[] {
  // Special case for loop context pseudo-tool
  if (toolName === '__loop__') {
    return ['item', 'index'];
  }
  return TOOL_SCHEMAS[toolName]?.outputs || ['ok', 'result'];
}

export function hasToolSchema(toolName: string): boolean {
  return toolName in TOOL_SCHEMAS;
}

export function getAllToolNames(): string[] {
  return Object.keys(TOOL_SCHEMAS);
}
