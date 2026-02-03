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

export type ArgType = 'string' | 'number' | 'boolean' | 'select' | 'array' | 'object' | 'code' | 'path' | 'hotkey' | 'json' | 'cron' | 'files';

export interface ArgOption {
  value: string | number | boolean;
  label: string;
  description?: string;
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

type ToolCategory = 'core' | 'system' | 'input' | 'ui' | 'vision' | 'data' | 'integrations' | 'flow';

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
  { id: 'call_workflow', category: 'flow', kind: 'local', description: 'Call another workflow file as a function with input parameters', argsTemplate: { workflowId: '', inputs: {} }, outputSchema: { ok: 'boolean', result: 'any', error: 'string' } },
  { id: 'call_function', category: 'flow', kind: 'local', description: 'Call a function trigger within the same workflow by trigger ID', argsTemplate: { triggerId: '', inputs: {} }, outputSchema: { ok: 'boolean', result: 'any', error: 'string' } },
  { id: 'log', category: 'flow', kind: 'local', description: 'Log a message to the workflow execution log', argsTemplate: { message: 'Step completed' }, outputSchema: { ok: 'boolean', logged: 'string' } },
  { id: 'send_notification', category: 'flow', kind: 'local', description: 'Show a local desktop notification (OS toast)', argsTemplate: { title: 'Stuard AI', body: 'Hello!', severity: 'info', taskId: '', workflowRunId: '' }, outputSchema: { ok: 'boolean', notification: 'object', error: 'string' } },

  // --- SYSTEM ---
  { id: 'run_command', category: 'system', kind: 'local', description: 'Run shell commands cross-platform with timeout', argsTemplate: { command: 'echo hello', shell: 'auto', timeoutMs: 30000, cwd: '', background: false, terminalId: '' }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', terminalId: 'string', pid: 'number', status: 'string', shell: 'string' } },
  { id: 'run_system_command', category: 'system', kind: 'local', description: 'Execute system commands with timeout (shell=true)', argsTemplate: { command: 'echo hello', timeoutMs: 30000, shell: true, background: false, terminalId: '' }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', terminalId: 'string', pid: 'number', status: 'string', shell: 'string' } },
  { id: 'list_terminals', category: 'system', kind: 'local', description: 'List active and recent terminal sessions', argsTemplate: {}, outputSchema: { ok: 'boolean', terminals: 'any[]' } },
  { id: 'read_terminal', category: 'system', kind: 'local', description: 'Read incremental terminal output for a terminalId', argsTemplate: { terminalId: '', sinceSeq: 0, maxChars: 8000 }, outputSchema: { ok: 'boolean', terminalId: 'string', chunks: 'any[]', done: 'boolean', exitCode: 'number', seq: 'number' } },
  { id: 'run_python_script', category: 'system', kind: 'local', description: 'Run Python code inline or from file with auto-install packages', argsTemplate: { code: "print('hello')", packages: [], envId: 'default', timeoutMs: 30000 }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number', installed: 'string[]' } },
  { id: 'run_node_script', category: 'system', kind: 'local', description: 'Run Node.js code inline or from file', argsTemplate: { code: "console.log('hello')", timeoutMs: 30000 }, outputSchema: { ok: 'boolean', stdout: 'string', stderr: 'string', exitCode: 'number' } },
  { id: 'launch_application_or_uri', category: 'system', kind: 'local', description: 'Launch desktop applications or open URLs', argsTemplate: { target: 'https://example.com', args: [] }, outputSchema: { ok: 'boolean' } },
  { id: 'read_file', category: 'system', kind: 'local', description: 'Read text file contents', argsTemplate: { path: '', line_start: 1, line_end: 100 }, outputSchema: { ok: 'boolean', content: 'string', total_lines: 'number', line_start: 'number', line_end: 'number' } },
  { id: 'file_read', category: 'system', kind: 'local', description: 'Read file contents with line numbers', argsTemplate: { path: '', whole_file: true, line_start: 1, line_end: 100 }, outputSchema: { ok: 'boolean', content: 'string', total_lines: 'number', line_start: 'number', line_end: 'number', lines_returned: 'number', truncated: 'boolean', error: 'string' } },
  { id: 'file_edit', category: 'system', kind: 'local', description: 'Edit file contents (delete, add, replace lines)', argsTemplate: { path: '', mode: 'replace', line_start: 10, line_end: 15, content: '' }, outputSchema: { ok: 'boolean', mode: 'string', lines_affected: 'number', new_total_lines: 'number', error: 'string' } },
  { id: 'write_file', category: 'system', kind: 'local', description: 'Write text content to a file', argsTemplate: { path: '', content: '', append: false }, outputSchema: { ok: 'boolean' } },
  { id: 'create_directory', category: 'system', kind: 'local', description: 'Create a directory on disk', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'list_directory', category: 'system', kind: 'local', description: 'List directory contents', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', items: 'any[]' } },
  { id: 'open_file', category: 'system', kind: 'local', description: 'Open a file or folder with the default application', argsTemplate: { path: '' }, outputSchema: { ok: 'boolean', opened: 'string', method: 'string' } },
  { id: 'move_file', category: 'system', kind: 'local', description: 'Move or rename files and directories', argsTemplate: { src: '', dest: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'list_open_windows', category: 'system', kind: 'local', description: 'List all open windows and their properties', argsTemplate: {}, outputSchema: { ok: 'boolean', windows: 'any[]' } },
  { id: 'bring_window_to_foreground', category: 'system', kind: 'local', description: 'Activate and focus a window by title', argsTemplate: { title: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'smart_bring_window_to_foreground', category: 'system', kind: 'local', description: 'Intelligently find and activate a window', argsTemplate: { hint: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'get_window_info', category: 'system', kind: 'local', description: 'Get details about a specific window', argsTemplate: { title: '' }, outputSchema: { ok: 'boolean', bounds: 'object' } },
  { id: 'set_window_bounds', category: 'system', kind: 'local', description: 'Move and/or resize a window', argsTemplate: { title: '', bounds: { x: 0, y: 0, width: 800, height: 600 }, bringToTop: true }, outputSchema: { ok: 'boolean', bounds: 'object' } },

  // --- INPUT ---
  { id: 'send_hotkey', category: 'input', kind: 'local', description: 'Send keyboard hotkey combinations', argsTemplate: { keys: ['ctrl', 'c'] }, outputSchema: { ok: 'boolean' } },
  { id: 'type_text', category: 'input', kind: 'local', description: 'Type text at cursor position', argsTemplate: { text: '', useClipboardFallback: false }, outputSchema: { ok: 'boolean' } },
  { id: 'click_at_coordinates', category: 'input', kind: 'local', description: 'Click at specific screen coordinates', argsTemplate: { x: 100, y: 100, button: 'left' }, outputSchema: { ok: 'boolean' } },
  { id: 'double_click_at_coordinates', category: 'input', kind: 'local', description: 'Double-click at specific screen coordinates', argsTemplate: { x: 100, y: 100, button: 'left' }, outputSchema: { ok: 'boolean' } },
  { id: 'scroll', category: 'input', kind: 'local', description: 'Scroll the mouse wheel', argsTemplate: { deltaY: 120, deltaX: 0, speed: 1 }, outputSchema: { ok: 'boolean' } },
  { id: 'drag_and_drop', category: 'input', kind: 'local', description: 'Drag from one coordinate to another', argsTemplate: { fromX: 100, fromY: 100, toX: 400, toY: 400 }, outputSchema: { ok: 'boolean' } },
  { id: 'get_mouse_position', category: 'input', kind: 'local', description: 'Get the current mouse cursor position on screen', argsTemplate: {}, outputSchema: { ok: 'boolean', x: 'number', y: 'number' } },
  { id: 'move_cursor', category: 'input', kind: 'local', description: 'Move the mouse cursor to specific screen coordinates', argsTemplate: { x: 100, y: 100, duration: 0 }, outputSchema: { ok: 'boolean', x: 'number', y: 'number' } },
  { id: 'computer_use', category: 'input', kind: 'local', description: 'Perform GUI actions (mouse/keyboard) and optionally capture a screenshot', argsTemplate: { action: 'mouse_move', x: 100, y: 100, includeScreenshot: false }, outputSchema: { ok: 'boolean', action: 'string', filePath: 'string', screenshot: 'string', cursor: { x: 'number', y: 'number' }, display: { width: 'number', height: 'number' }, text: 'string' } },
  { id: 'get_clipboard_content', category: 'input', kind: 'local', description: 'Read text from the clipboard', argsTemplate: {}, outputSchema: { ok: 'boolean', text: 'string' } },
  { id: 'set_clipboard_content', category: 'input', kind: 'local', description: 'Set text into the clipboard', argsTemplate: { text: '' }, outputSchema: { ok: 'boolean' } },

  // --- VISION / MEDIA ---
  { id: 'take_screenshot', category: 'vision', kind: 'local', description: 'Capture screenshot and return a local file path', argsTemplate: { region: { x: 0, y: 0, width: 800, height: 600 }, hideUI: false }, outputSchema: { ok: 'boolean', filePath: 'string' } },
  { id: 'capture_media', category: 'vision', kind: 'local', description: 'Capture photos, videos, or audio', argsTemplate: { kind: 'audio', mode: 'fixed', durationMs: 5000, device: '', filePath: '', sessionId: '', maxDurationMs: 600000 }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', stoppedBy: 'string', mode: 'string', status: 'string', durationMs: 'number' } },
  { id: 'stop_capture', category: 'vision', kind: 'local', description: 'Stop an active capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean' } },
  { id: 'list_active_captures', category: 'vision', kind: 'local', description: 'List all currently active capture sessions', argsTemplate: {}, outputSchema: { ok: 'boolean', sessions: 'string[]' } },
  { id: 'capture_screen', category: 'vision', kind: 'local', description: 'Record the screen (full screen, monitor, window, or region) with optional system audio', argsTemplate: { mode: 'fixed', durationMs: 5000, target: 'fullscreen', monitorId: 0, windowTitle: '', region: { x: 0, y: 0, width: 1920, height: 1080 }, includeSystemAudio: false, fps: 30, quality: 'medium', filePath: '', sessionId: '', maxDurationMs: 7200000 }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', stoppedBy: 'string', hasAudio: 'boolean', audioFilePath: 'string' } },
  { id: 'stop_screen_capture', category: 'vision', kind: 'local', description: 'Stop an active screen capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean', filePath: 'string', audioFilePath: 'string' } },
  { id: 'describe_screen_capture_capabilities', category: 'vision', kind: 'local', description: 'List available monitors and windows for screen capture', argsTemplate: {}, outputSchema: { monitors: 'any[]', windows: 'any[]' } },
  { id: 'capture_system_audio', category: 'vision', kind: 'local', description: 'Record system audio output (what you hear from speakers). Uses WASAPI loopback on Windows.', argsTemplate: { mode: 'fixed', durationMs: 5000, device: '', filePath: '', sessionId: '', maxDurationMs: 7200000, format: 'wav' }, outputSchema: { ok: 'boolean', filePath: 'string', mimeType: 'string', sessionId: 'string', stoppedBy: 'string', durationMs: 'number' } },
  { id: 'stop_system_audio', category: 'vision', kind: 'local', description: 'Stop an active system audio capture session', argsTemplate: { sessionId: '' }, outputSchema: { ok: 'boolean', sessionId: 'string', wasActive: 'boolean', filePath: 'string' } },
  { id: 'describe_system_audio_capabilities', category: 'vision', kind: 'local', description: 'List available loopback devices and check platform support', argsTemplate: {}, outputSchema: { supported: 'boolean', platform: 'string', devices: 'any[]', note: 'string' } },
  { id: 'analyze_image', category: 'vision', kind: 'cloud', description: 'Analyze an image file with AI vision', argsTemplate: { imagePath: '', prompt: '' }, outputSchema: { text: 'string' } },
  { id: 'analyze_current_screen', category: 'vision', kind: 'cloud', description: 'Capture and analyze the current screen', argsTemplate: { mode: 'text', prompt: '', booleanKey: '' }, outputSchema: { text: 'string', json: 'any', boolean: 'boolean' } },
  { id: 'analyze_media', category: 'vision', kind: 'cloud', description: 'Analyze video/audio files or transcribe audio. The task determines the output - use task="transcribe" for transcription.', argsTemplate: { task: 'Summarize this media', sources: [{ path: '' }], mode: 'fast' }, outputSchema: { summary: 'string' } },
  { id: 'stream_speech', category: 'vision', kind: 'local', description: 'Stream microphone audio to the cloud speech proxy', argsTemplate: { accessToken: '', device: '', busId: 'default', durationMs: 60000, sampleRate: 16000 }, outputSchema: { ok: 'boolean', sessionId: 'string' } },
  { id: 'stop_stream_speech', category: 'vision', kind: 'local', description: 'Stop an active stream_speech audio session', argsTemplate: { busId: 'default' }, outputSchema: { ok: 'boolean', busId: 'string' } },
  { id: 'play_audio', category: 'vision', kind: 'local', description: 'Play an audio file (MP3, WAV, etc.)', argsTemplate: { path: '', block: true }, outputSchema: { ok: 'boolean', played: 'string', method: 'string', error: 'string' } },
  { id: 'ffmpeg_status', category: 'vision', kind: 'local', description: 'Check if FFmpeg is available locally (downloaded or system-installed).', argsTemplate: {}, outputSchema: { ok: 'boolean', available: 'boolean', source: 'string', ffmpegPath: 'string', ffprobePath: 'string', meta: 'any' } },
  { id: 'ffmpeg_setup', category: 'vision', kind: 'local', description: 'Ensure FFmpeg is available locally (auto-downloads if needed).', argsTemplate: {}, outputSchema: { ok: 'boolean', available: 'boolean', source: 'string', ffmpegPath: 'string', ffprobePath: 'string', meta: 'any', error: 'string', message: 'string' } },
  { id: 'ffmpeg_run', category: 'vision', kind: 'local', description: 'Run FFmpeg with custom arguments. Use for advanced conversions and edits.', argsTemplate: { inputs: ['C:/input_1.mp4', 'C:/input_2.mp4'], extraArgs: ['-filter_complex', '...'], output: 'C:/output.mp4', overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string', outputFilePath: 'string' } },
  { id: 'ffmpeg_convert_media', category: 'vision', kind: 'local', description: 'Convert media from one format to another using FFmpeg.', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/output.webm', overwrite: true, extraArgs: ['-c:v', 'libvpx-vp9', '-crf', 30, '-b:v', 0], timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_extract_audio', category: 'vision', kind: 'local', description: 'Extract audio from a media file into an audio-only output (e.g. mp3, wav).', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/output.mp3', overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_trim_media', category: 'vision', kind: 'local', description: 'Trim a media file to a time range (fast copy mode).', argsTemplate: { inputPath: 'C:/input.mp4', outputPath: 'C:/clip.mp4', startSeconds: 0, durationSeconds: 10, overwrite: true, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'ffmpeg_probe_media', category: 'vision', kind: 'local', description: 'Inspect a media file using ffprobe and return JSON metadata.', argsTemplate: { inputPath: 'C:/input.mp4', timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', data: 'any', stdout: 'string', stderr: 'string', ffprobePath: 'string' } },
  { id: 'ffmpeg_extract_frames', category: 'vision', kind: 'local', description: 'Extract image frames from a video to a numbered file pattern.', argsTemplate: { inputPath: 'C:/input.mp4', outputPattern: 'C:/frames/%04d.jpg', overwrite: true, fps: 1, startSeconds: 0, durationSeconds: 5, timeoutMs: 300000, cwd: '' }, outputSchema: { ok: 'boolean', exitCode: 'number', stdout: 'string', stderr: 'string', ffmpegPath: 'string' } },
  { id: 'text_to_speech', category: 'vision', kind: 'cloud', description: 'Convert text to speech audio', argsTemplate: { text: '', voice: 'alloy', speed: 1.0, format: 'mp3', save: true, play: false, outputPath: '' }, outputSchema: { ok: 'boolean', filePath: 'string', format: 'string', voice: 'string', textLength: 'number', played: 'boolean', error: 'string' } },
  { id: 'list_tts_voices', category: 'vision', kind: 'cloud', description: 'List all available text-to-speech voices', argsTemplate: {}, outputSchema: { ok: 'boolean', voices: 'any[]' } },

  // --- DATA / AI ---
  { id: 'ai_inference', category: 'data', kind: 'cloud', description: 'Run AI inference on text. Returns plain text or structured JSON.', argsTemplate: { prompt: '', input: '', mode: 'json', schema: {}, model: 'openai/gpt-4.1-mini', temperature: 0.3 }, outputSchema: { ok: 'boolean', text: 'string', json: 'any', model: 'string' } },
  { id: 'web_search', category: 'data', kind: 'cloud', description: 'Search the web using Perplexity AI', argsTemplate: { query: '', max_results: 5, max_tokens_per_page: 1024 }, outputSchema: { results: 'any[]', id: 'string' } },

  // --- UI ---
  { id: 'custom_ui', category: 'ui', kind: 'local', description: 'Display custom interactive overlay UI with HTML + Tailwind CSS', argsTemplate: { id: 'my-panel', title: 'My Custom UI', window: { width: 400, height: 500, position: 'center', alwaysOnTop: true }, blocking: true, css: '', layout: {}, data: {} }, outputSchema: { ok: 'boolean', action: 'string', data: 'object' } },
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

  // --- INTEGRATIONS ---
  { id: 'gmail_send_message', category: 'integrations', kind: 'cloud', description: 'Send an email via Gmail with optional file attachments', argsTemplate: { to: [], subject: '', body: '', contentType: 'text/plain', cc: [], bcc: [], attachments: [] }, outputSchema: { message: 'object', attachmentCount: 'number' } },
  { id: 'gmail_list_messages', category: 'integrations', kind: 'cloud', description: 'List Gmail messages', argsTemplate: { q: '', labelIds: [], maxResults: 10, includeSpamTrash: false }, outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' } },
  { id: 'gmail_get_message_brief', category: 'integrations', kind: 'cloud', description: 'Get a Gmail message brief', argsTemplate: { id: '' }, outputSchema: { message: 'object' } },
  { id: 'gmail_get_message_full', category: 'integrations', kind: 'cloud', description: 'Get a Gmail message with full content', argsTemplate: { id: '' }, outputSchema: { message: 'object' } },
  { id: 'gmail_modify_message', category: 'integrations', kind: 'cloud', description: 'Modify Gmail message labels', argsTemplate: { id: '', addLabelIds: [], removeLabelIds: [] }, outputSchema: { message: 'object' } },
  { id: 'gmail_delete_message', category: 'integrations', kind: 'cloud', description: 'Delete a Gmail message permanently', argsTemplate: { id: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'gmail_archive_message', category: 'integrations', kind: 'cloud', description: 'Archive a Gmail message', argsTemplate: { id: '' }, outputSchema: { message: 'object' } },
  { id: 'gmail_mark_as_read', category: 'integrations', kind: 'cloud', description: 'Mark a Gmail message as read', argsTemplate: { id: '' }, outputSchema: { message: 'object' } },
  { id: 'gmail_mark_as_unread', category: 'integrations', kind: 'cloud', description: 'Mark a Gmail message as unread', argsTemplate: { id: '' }, outputSchema: { message: 'object' } },
  { id: 'drive_list_files', category: 'integrations', kind: 'cloud', description: 'List Google Drive files', argsTemplate: { query: '', pageSize: 20, orderBy: '' }, outputSchema: { files: 'any[]', count: 'number', nextPageToken: 'string' } },
  { id: 'calendar_list_events', category: 'integrations', kind: 'cloud', description: 'List Google Calendar events', argsTemplate: { calendarId: 'primary', timeMin: '', timeMax: '', maxResults: 10 }, outputSchema: { items: 'any[]', count: 'number', nextPageToken: 'string' } },
  { id: 'calendar_create_event', category: 'integrations', kind: 'cloud', description: 'Create a Google Calendar event', argsTemplate: { calendarId: 'primary', summary: '', description: '', start: '', end: '', timeZone: '' }, outputSchema: { event: 'object' } },
  { id: 'sheets_read_range', category: 'integrations', kind: 'cloud', description: 'Read a range from Google Sheets', argsTemplate: { spreadsheetId: '', range: '' }, outputSchema: { values: 'any[]', range: 'string' } },
  { id: 'docs_get_document', category: 'integrations', kind: 'cloud', description: 'Get a Google Docs document', argsTemplate: { documentId: '' }, outputSchema: { document: 'object' } },
  { id: 'docs_create_document', category: 'integrations', kind: 'cloud', description: 'Create a new Google Doc', argsTemplate: { title: '' }, outputSchema: { document: 'object' } },
  { id: 'docs_write_text', category: 'integrations', kind: 'cloud', description: 'Write text to a Google Doc', argsTemplate: { documentId: '', text: '' }, outputSchema: { result: 'object' } },
  { id: 'tasks_list', category: 'integrations', kind: 'cloud', description: 'List Google Tasks', argsTemplate: { tasklist: '', maxResults: 10 }, outputSchema: { items: 'any[]', count: 'number' } },
  { id: 'youtube_get_video', category: 'integrations', kind: 'cloud', description: 'Get detailed information about a YouTube video', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', video: 'object', error: 'string' } },
  { id: 'youtube_get_channel', category: 'integrations', kind: 'cloud', description: 'Get information about a YouTube channel', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', channel: 'object', error: 'string' } },
  { id: 'youtube_get_playlist', category: 'integrations', kind: 'cloud', description: 'Get information about a YouTube playlist', argsTemplate: { url: '', maxVideos: 10 }, outputSchema: { ok: 'boolean', playlist: 'object', videos: 'any[]', error: 'string' } },
  { id: 'youtube_search', category: 'integrations', kind: 'cloud', description: 'Search YouTube for videos, channels, or playlists', argsTemplate: { query: '', type: 'video', maxResults: 5 }, outputSchema: { ok: 'boolean', results: 'any[]', error: 'string' } },
  { id: 'youtube_parse_url', category: 'integrations', kind: 'cloud', description: 'Parse a YouTube URL and identify content type', argsTemplate: { url: '' }, outputSchema: { ok: 'boolean', type: 'string', id: 'string' } },
  { id: 'search_marketplace', category: 'integrations', kind: 'cloud', description: 'Search the Stuard workflow marketplace', argsTemplate: { query: '', category: '', limit: 10 }, outputSchema: { ok: 'boolean', results: 'any[]', count: 'number' } },
  { id: 'get_marketplace_workflow', category: 'integrations', kind: 'cloud', description: 'Retrieve a workflow from the marketplace by slug', argsTemplate: { slug: '' }, outputSchema: { ok: 'boolean', workflow: 'object' } },
  { id: 'list_popular_workflows', category: 'integrations', kind: 'cloud', description: 'List popular workflows from the marketplace', argsTemplate: { category: '', sort_by: 'downloads', limit: 10 }, outputSchema: { ok: 'boolean', workflows: 'any[]', count: 'number' } },
  { id: 'list_marketplace_categories', category: 'integrations', kind: 'cloud', description: 'List all available workflow categories', argsTemplate: {}, outputSchema: { ok: 'boolean', categories: 'any[]' } },
  { id: 'deploy_headless_agent', category: 'flow', kind: 'cloud', description: 'Deploy an autonomous sub-agent to run a task in the background', argsTemplate: { objective: '', tools_allowed: [], custom_system_prompt: '', model: 'fast' }, outputSchema: { ok: 'boolean', taskId: 'string', error: 'string' } },
  { id: 'get_headless_agent_status', category: 'flow', kind: 'cloud', description: 'Get the status of a deployed sub-agent task', argsTemplate: { taskId: '' }, outputSchema: { ok: 'boolean', task: 'object', error: 'string' } },
  { id: 'list_headless_agent_tasks', category: 'flow', kind: 'cloud', description: 'List recent sub-agent tasks', argsTemplate: { status: '', parent_id: '', limit: 25 }, outputSchema: { ok: 'boolean', tasks: 'any[]', error: 'string' } },

  // --- DATA / TASKS ---
  { id: 'task_crud', category: 'data', kind: 'local', description: 'Create/Read/Update/Delete tasks', argsTemplate: { action: 'create', task: {} }, outputSchema: { ok: 'boolean', task: 'object' } },
  { id: 'task_reminders', category: 'data', kind: 'local', description: 'Schedule/List reminders', argsTemplate: { action: 'schedule', taskId: '', time: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'planner_list_items', category: 'data', kind: 'local', description: 'Get unified list of tasks/reminders', argsTemplate: { start: '', end: '' }, outputSchema: { items: 'any[]' } },
  { id: 'agent_todo', category: 'data', kind: 'local', description: 'Agent internal todo list for tracking long-running tasks (session-scoped)', argsTemplate: { action: 'list', sessionId: '', data: {} }, outputSchema: { ok: 'boolean', items: 'any[]', todo: 'object', progress: 'object', count: 'number' } },

  // --- VARIABLES ---
  { id: 'set_variable', category: 'data', kind: 'local', description: 'Set a workflow variable. For workflow.* variables, they must be defined in the workflow variables array first.', argsTemplate: { name: '', value: '', scope: 'workflow' }, outputSchema: { ok: 'boolean' } },
  { id: 'get_variable', category: 'data', kind: 'local', description: 'Get a workflow variable value. For workflow.* variables, they must be defined in the workflow variables array.', argsTemplate: { name: '', default: '' }, outputSchema: { ok: 'boolean', value: 'any' } },
  { id: 'delete_variable', category: 'data', kind: 'local', description: 'Delete a stored variable', argsTemplate: { name: '' }, outputSchema: { ok: 'boolean' } },
  { id: 'toggle_variable', category: 'data', kind: 'local', description: 'Toggle a boolean workflow variable (must be defined in variables array)', argsTemplate: { name: '' }, outputSchema: { ok: 'boolean', value: 'boolean' } },
  { id: 'increment_variable', category: 'data', kind: 'local', description: 'Increment a numeric workflow variable (must be defined in variables array)', argsTemplate: { name: '', amount: 1 }, outputSchema: { ok: 'boolean', value: 'number' } },
  { id: 'append_to_list', category: 'data', kind: 'local', description: 'Append an item to a list workflow variable (must be defined in variables array)', argsTemplate: { name: '', item: '' }, outputSchema: { ok: 'boolean', value: 'any[]' } },

  // --- MEMORY / KNOWLEDGE ---
  { id: 'memory_retrieval', category: 'data', kind: 'cloud', description: 'Retrieve stored memories and facts', argsTemplate: { query: '' }, outputSchema: { ok: 'boolean', memories: 'any[]', facts: 'any[]' } },
];

const TRIGGER_DEFINITIONS = [
  { type: 'manual', description: 'Manual trigger - user clicks run. Supports inputParams for user input forms.', argsTemplate: {}, inputParams: [] },
  { type: 'function', description: 'Function trigger - allows this workflow to be called from other workflows with input parameters', argsTemplate: {}, inputParams: [] },
  { type: 'webhook.local', description: 'Local webhook trigger', argsTemplate: {} },
  { type: 'webhook.cloud', description: 'Cloud webhook trigger', argsTemplate: {} },
  { type: 'schedule.cron', description: 'Cron schedule trigger', argsTemplate: { cron: '* * * * *' } },
  { type: 'hotkey', description: 'Global hotkey trigger (blocking)', argsTemplate: { accelerator: 'Ctrl+Alt+K', passthrough: false } },
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
];

const MEDIA_KIND_OPTIONS: ArgOption[] = [
  { value: 'photo', label: 'Photo', description: 'Take a still image' },
  { value: 'video', label: 'Video', description: 'Record video' },
  { value: 'audio', label: 'Audio', description: 'Record audio only' },
];

const AUDIO_FORMAT_OPTIONS: ArgOption[] = [
  { value: 'mp3', label: 'MP3', description: 'Compressed audio' },
  { value: 'wav', label: 'WAV', description: 'Uncompressed audio' },
  { value: 'opus', label: 'Opus', description: 'High quality compressed' },
];

const ANALYZE_MODE_OPTIONS: ArgOption[] = [
  { value: 'text', label: 'Text', description: 'Return plain text response' },
  { value: 'json', label: 'JSON', description: 'Return structured JSON' },
  { value: 'boolean', label: 'Boolean', description: 'Return true/false' },
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

const KNOWN_SELECT_OPTIONS: Record<string, ArgOption[]> = {
  'button': MOUSE_BUTTON_OPTIONS,
  'shell': SHELL_OPTIONS,
  'voice': TTS_VOICE_OPTIONS,
  'mode': [...CAPTURE_MODE_OPTIONS, ...ANALYZE_MODE_OPTIONS],
  'kind': MEDIA_KIND_OPTIONS,
  'format': AUDIO_FORMAT_OPTIONS,
  'target': SCREEN_TARGET_OPTIONS,
  'quality': SCREEN_QUALITY_OPTIONS,
};

function inferArgType(key: string, value: any): ArgType {
  if (key === 'code' || key === 'script') return 'code';
  if (key === 'path' || key === 'filePath' || key === 'imagePath' || key === 'src' || key === 'dest' || key === 'cwd' || key === 'outputPath') return 'path';
  if (key === 'keys' && Array.isArray(value)) return 'hotkey';
  if (key === 'schema' || key === 'layout' || key === 'window' || key === 'region' || key === 'task') return 'json';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  if (KNOWN_SELECT_OPTIONS[key]) return 'select';
  if (typeof value === 'string') {
    const enumPatterns = ['fixed', 'until_stop', 'photo', 'video', 'audio', 'left', 'right', 'middle', 'auto', 'cmd', 'powershell', 'bash', 'text', 'json', 'boolean'];
    if (enumPatterns.includes(value)) return 'select';
  }
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
    const type = inferArgType(key, value);
    const argSchema: ArgSchema = {
      type,
      label: KNOWN_LABELS[key] || keyToLabel(key),
      description: KNOWN_DESCRIPTIONS[key],
      default: value,
      placeholder: typeof value === 'string' ? value : undefined,
    };

    if (type === 'select' && KNOWN_SELECT_OPTIONS[key]) {
      argSchema.options = KNOWN_SELECT_OPTIONS[key];
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
        { type: inferArgType(key, value), label: keyToLabel(key), default: value } as ArgSchema,
      ])
    ),
    outputs: ['trigger'],
  };
}

// ============================================================================
// SCHEMA OVERRIDES - Explicit field configurations for better UX
// ============================================================================

// Custom UI - code-style editors for layout, CSS, and data
if (TOOL_SCHEMAS['custom_ui']) {
  TOOL_SCHEMAS['custom_ui'].args = {
    id: {
      type: 'string',
      label: 'Panel ID',
      description: 'Unique identifier for this UI panel (used to update/close it later)',
      required: true,
      placeholder: 'my-panel',
    },
    title: {
      type: 'string',
      label: 'Window Title',
      description: 'Title displayed in the window header',
      placeholder: 'My Custom UI',
    },
    window: {
      type: 'json',
      label: 'Window Options',
      description: 'Configure window size, position, and behavior (width, height, position, alwaysOnTop, frameless, transparent, etc.)',
    },
    blocking: {
      type: 'boolean',
      label: 'Blocking',
      description: 'If true, workflow waits for user interaction before continuing',
      default: true,
    },
    css: {
      type: 'code',
      label: 'Custom CSS',
      description: 'Add custom CSS styles for the UI',
      language: 'css' as any,
      placeholder: '.my-class { color: blue; }',
    },
    layout: {
      type: 'json',
      label: 'Layout (JSON)',
      description: 'Define your UI using a declarative JSON layout. Supports rows, columns, text, buttons, inputs, and more.',
      placeholder: '{ "type": "column", "children": [] }',
    },
    html: {
      type: 'code',
      label: 'HTML Content',
      description: 'Raw HTML content (alternative to layout). Use Tailwind CSS classes for styling.',
      language: 'html' as any,
    },
    data: {
      type: 'json',
      label: 'Initial Data',
      description: 'Data object passed to the UI components. Use the key-value editor to add variables like {{stepId.field}}',
    },
    // Window settings (shown in collapsible section)
    width: {
      type: 'number',
      label: 'Width',
      description: 'Window width in pixels',
      default: 400,
      placeholder: '400',
    },
    height: {
      type: 'number',
      label: 'Height',
      description: 'Window height in pixels',
      default: 500,
      placeholder: '500',
    },
    position: {
      type: 'select',
      label: 'Position',
      description: 'Where the window appears on screen',
      default: 'center',
      options: [
        { value: 'center', label: 'Center', description: 'Center of the screen' },
        { value: 'top-left', label: 'Top Left' },
        { value: 'top-right', label: 'Top Right' },
        { value: 'bottom-left', label: 'Bottom Left' },
        { value: 'bottom-right', label: 'Bottom Right' },
        { value: 'cursor', label: 'Near Cursor', description: 'Appears near mouse pointer' },
      ],
    },
    alwaysOnTop: {
      type: 'boolean',
      label: 'Always on Top',
      description: 'Keep the window above other windows',
      default: true,
    },
    frameless: {
      type: 'boolean',
      label: 'Frameless',
      description: 'Hide the window title bar and borders',
      default: false,
    },
    _uiDesign: {
      type: 'json',
      label: 'UI Design Data',
      description: 'Internal: Stores the visual UI Builder design for editing. Do not modify directly.',
    },
  };
}

// Update Custom UI - similar improvements
if (TOOL_SCHEMAS['update_custom_ui']) {
  TOOL_SCHEMAS['update_custom_ui'].args = {
    ...TOOL_SCHEMAS['update_custom_ui'].args,
    id: {
      type: 'string',
      label: 'Panel ID',
      description: 'ID of the panel to update',
      required: true,
    },
    html: {
      type: 'code',
      label: 'HTML Content',
      description: 'Raw HTML content to inject (alternative to layout)',
      language: 'html' as any,
    },
    css: {
      type: 'code',
      label: 'Custom CSS',
      language: 'css' as any,
    },
    data: {
      type: 'json',
      label: 'Updated Data',
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

// File/Folder Watch Trigger - user-friendly path and pattern editor
if (TOOL_SCHEMAS['fs.watch']) {
  TOOL_SCHEMAS['fs.watch'].args = {
    path: {
      type: 'path',
      label: 'Watch Path',
      description: 'File or folder path to watch for changes',
      required: true,
      placeholder: 'C:/Users/Documents or /home/user/folder',
    },
    pattern: {
      type: 'string',
      label: 'File Pattern',
      description: 'Glob pattern to filter files (e.g., *.txt, *.{js,ts}, **/*.log)',
      default: '*.*',
      placeholder: '*.*',
    },
    recursive: {
      type: 'boolean',
      label: 'Watch Subfolders',
      description: 'Also watch files in subdirectories',
      default: true,
    },
    events: {
      type: 'array',
      label: 'Watch Events',
      description: 'Which file events to watch for',
      default: ['add', 'change', 'unlink'],
      itemType: 'string',
      itemOptions: [
        { value: 'add', label: 'File Added', description: 'When a new file is created' },
        { value: 'change', label: 'File Changed', description: 'When a file is modified' },
        { value: 'unlink', label: 'File Deleted', description: 'When a file is removed' },
        { value: 'addDir', label: 'Folder Added', description: 'When a new folder is created' },
        { value: 'unlinkDir', label: 'Folder Deleted', description: 'When a folder is removed' },
      ],
    },
  };
  TOOL_SCHEMAS['fs.watch'].outputs = ['filePath', 'eventType', 'stats'];
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
  };
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
