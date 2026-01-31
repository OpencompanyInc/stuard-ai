import type { PaletteItem } from "../types";

export const TRIGGER_ITEMS: PaletteItem[] = [
  { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', args: { path: '', pattern: '*.*', recursive: true } },
  { k: 'trigger', t: 'schedule.cron', label: 'Schedule', args: { cron: '*/5 * * * *' } },
  { k: 'trigger', t: 'webhook.local', label: 'Webhook (Local)', args: {} },
  { k: 'trigger', t: 'webhook.cloud', label: 'Webhook (Cloud)', args: {} },
  { k: 'trigger', t: 'hotkey', label: 'Hotkey', args: { accelerator: 'Ctrl+Alt+C' } },
  { k: 'trigger', t: 'outlook.calendar.poll', label: 'Outlook Calendar (poll)', args: { intervalSec: 60 } },
  { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', args: { cmd: 'python', args: ['C:/path/to/script.py'] } }
];

export const LOCAL_TOOL_ITEMS: PaletteItem[] = [
  // Commands & apps
  { k: 'local.tool', t: 'run_command', label: 'Run Command', args: { command: 'echo hello', shell: 'auto' } },
  { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App / URL', args: { target: 'C:/Path/To/App.exe', args: [] } },

  // Notifications
  { k: 'local.tool', t: 'send_notification', label: 'Send Notification', args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },

  // Python & Node scripts
  {
    k: 'local.tool',
    t: 'run_python_script',
    label: 'Run Python Script',
    args: {
      code: 'print("Hello from Python!")',
      packages: [],
      timeoutMs: 60000
    }
  },
  {
    k: 'local.tool',
    t: 'run_node_script',
    label: 'Run Node.js Script',
    args: {
      code: 'console.log("Hello from Node!");',
      timeoutMs: 30000
    }
  },

  // Screen capture & media
  { k: 'local.tool', t: 'take_screenshot', label: 'Screenshot', args: {} },
  { k: 'local.tool', t: 'capture_media', label: 'Capture Photo', args: { kind: 'photo' } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Video (fixed)', args: { kind: 'video', mode: 'fixed', durationMs: 5000 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Video (until stop)', args: { kind: 'video', mode: 'until_stop', maxDurationMs: 300000 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Audio (fixed)', args: { kind: 'audio', mode: 'fixed', durationMs: 5000 } },
  { k: 'local.tool', t: 'capture_media', label: 'Record Audio (until stop)', args: { kind: 'audio', mode: 'until_stop', maxDurationMs: 300000 } },
  { k: 'local.tool', t: 'stop_capture', label: 'Stop Recording', args: { sessionId: '' } },

  // Screen recording & system audio
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen (fixed)', args: { mode: 'fixed', durationMs: 5000, target: 'fullscreen', fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen (until stop)', args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'capture_screen', label: 'Record Screen + Audio', args: { mode: 'until_stop', target: 'fullscreen', includeSystemAudio: true, fps: 30, quality: 'medium' } },
  { k: 'local.tool', t: 'stop_screen_capture', label: 'Stop Screen Recording', args: { sessionId: '' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (fixed)', args: { mode: 'fixed', durationMs: 5000, format: 'wav' } },
  { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio (until stop)', args: { mode: 'until_stop', format: 'wav' } },
  { k: 'local.tool', t: 'stop_system_audio', label: 'Stop System Audio', args: { sessionId: '' } },

  // Mouse & keyboard
  { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', args: { x: 100, y: 100, button: 'left' } },
  { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', args: { x: 100, y: 100, button: 'left' } },
  { k: 'local.tool', t: 'scroll', label: 'Scroll', args: { deltaY: 120 } },
  { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
  { k: 'local.tool', t: 'type_text', label: 'Type Text', args: { text: 'Hello', useClipboardFallback: false } },
  { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', args: { keys: ['windows', 'd'] } },

  // Window management
  { k: 'local.tool', t: 'list_open_windows', label: 'List Open Windows', args: {} },
  { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', args: { title: 'Untitled - Notepad' } },
  { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus Window', args: { hint: 'Epic Games Launcher' } },
  { k: 'local.tool', t: 'get_window_info', label: 'Get Window Info', args: { title: 'Untitled - Notepad' } },
  { k: 'local.tool', t: 'set_window_bounds', label: 'Resize/Move Window', args: { title: 'Untitled - Notepad', bounds: { x: 0, y: 0, width: 900, height: 700 }, bringToTop: true } },

  // File system
  { k: 'local.tool', t: 'read_file', label: 'Read File', args: { path: 'C:/file.txt' } },
  { k: 'local.tool', t: 'write_file', label: 'Write File', args: { path: 'C:/file.txt', content: 'text', append: false } },
  { k: 'local.tool', t: 'create_directory', label: 'Create Directory', args: { path: 'C:/folder' } },
  { k: 'local.tool', t: 'list_directory', label: 'List Directory', args: { path: 'C:/folder' } },
  { k: 'local.tool', t: 'move_file', label: 'Move File', args: { src: 'C:/old.txt', dest: 'C:/new.txt' } },

  // Clipboard
  { k: 'local.tool', t: 'get_clipboard_content', label: 'Get Clipboard', args: {} },
  { k: 'local.tool', t: 'set_clipboard_content', label: 'Set Clipboard', args: { text: 'Hello' } },

  // Memory & groups
  { k: 'local.tool', t: 'memory_retrieval', label: 'Memory', args: {} },
  { k: 'local.tool', t: 'group_management', label: 'Groups', args: {} },

  // Orchestration & timing
  { k: 'local.tool', t: 'wait', label: 'Wait', args: { ms: 1000 } },
  { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential (Local)', args: { steps: [], continueOnError: false } },
  { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel (Local)', args: { steps: [] } },

  // Variables (persistent state across runs)
  { k: 'local.tool', t: 'set_variable', label: 'Set Variable', args: { name: 'myVar', value: '', type: 'string' } },
  { k: 'local.tool', t: 'get_variable', label: 'Get Variable', args: { name: 'myVar', default: '' } },
  { k: 'local.tool', t: 'toggle_variable', label: 'Toggle Boolean', args: { name: 'isActive' } },
  { k: 'local.tool', t: 'increment_variable', label: 'Increment Number', args: { name: 'counter', amount: 1 } },
  { k: 'local.tool', t: 'append_to_list', label: 'Append to List', args: { name: 'items', item: '' } },
  { k: 'local.tool', t: 'delete_variable', label: 'Delete Variable', args: { name: 'myVar' } },

  // Custom UI
  { k: 'local.tool', t: 'custom_ui', label: 'Show Custom UI', args: { title: 'My UI', html: '<div>Hello</div>', window: { width: 300, height: 200 } } },
  { k: 'local.tool', t: 'update_custom_ui', label: 'Update Custom UI', args: { id: '', data: {}, html: '' } },
  { k: 'local.tool', t: 'close_custom_ui', label: 'Close Custom UI', args: { id: '' } },
];

export const CLOUD_TOOL_ITEMS: PaletteItem[] = [
  { k: 'cloud.tool', t: 'run_sequential', label: 'Run Sequential', args: { steps: [] } },
  { k: 'cloud.tool', t: 'run_parallel', label: 'Run Parallel', args: { steps: [] } },
  { k: 'cloud.tool', t: 'analyze_image', label: 'Analyze Image', args: {} },
  { k: 'cloud.tool', t: 'analyze_current_screen', label: 'Analyze Screen', args: {} },

  // Text-to-Speech
  { k: 'cloud.tool', t: 'text_to_speech', label: 'Text to Speech', args: { text: 'Hello!', voice: 'alloy', speed: 1.0, format: 'mp3', save: true, play: false } },
  { k: 'cloud.tool', t: 'text_to_speech', label: 'Speak Text (Play)', args: { text: 'Hello!', voice: 'alloy', speed: 1.0, format: 'mp3', save: false, play: true } },
  { k: 'cloud.tool', t: 'list_tts_voices', label: 'List TTS Voices', args: {} },
  {
    k: 'cloud.tool',
    t: 'cloud_ai_vision',
    label: 'AI Vision (structured)',
    args: {
      prompt: 'Detect people and summarize the scene.',
      imagePath: '',
      schema: {
        type: 'object',
        properties: {
          person_present: { type: 'boolean' },
          person_count: { type: 'number' },
          summary: { type: 'string' },
        },
      },
    },
  },
];

// Basic Math Operations (Scratch-like)
export const MATH_ITEMS: PaletteItem[] = [
  { k: 'local.tool', t: 'math_add', label: 'Add', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_subtract', label: 'Subtract', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_multiply', label: 'Multiply', args: { a: 0, b: 0 } },
  { k: 'local.tool', t: 'math_divide', label: 'Divide', args: { a: 0, b: 1 } },
  { k: 'local.tool', t: 'math_power', label: 'Power', args: { a: 2, b: 2 } },
  { k: 'local.tool', t: 'math_sqrt', label: 'Square Root', args: { x: 4 } },
  { k: 'local.tool', t: 'math_abs', label: 'Absolute', args: { x: -5 } },
  { k: 'local.tool', t: 'math_random', label: 'Random', args: { min: 1, max: 10 } },
  { k: 'local.tool', t: 'math_sum', label: 'Sum List', args: { x: [1, 2, 3] } },
  { k: 'local.tool', t: 'math_mean', label: 'Average', args: { x: [1, 2, 3] } },
  { k: 'local.tool', t: 'math_max', label: 'Max', args: { x: [1, 5, 3] } },
  { k: 'local.tool', t: 'math_min', label: 'Min', args: { x: [1, 5, 3] } },
  { k: 'local.tool', t: 'math_compare', label: 'Compare', args: { a: 5, b: 3, op: 'gt' } },
  { k: 'local.tool', t: 'math_range', label: 'Range', args: { start: 1, stop: 10 } },
];

export const INTEGRATION_ITEMS: PaletteItem[] = [
  { k: 'cloud.tool', t: 'google_drive_list_files', label: 'Google Drive', args: {} },
  { k: 'cloud.tool', t: 'google_calendar_list_events', label: 'Google Calendar', args: {} },
  { k: 'cloud.tool', t: 'gmail_send', label: 'Gmail Send', args: {} },
  { k: 'cloud.tool', t: 'google_sheets_read', label: 'Google Sheets', args: {} },
  { k: 'cloud.tool', t: 'google_docs_read', label: 'Google Docs', args: {} },
  { k: 'cloud.tool', t: 'docs_create_document', label: 'Create Google Doc', args: { title: 'Untitled' } },
  { k: 'cloud.tool', t: 'docs_write_text', label: 'Write to Google Doc', args: { documentId: '', text: '' } },
  { k: 'cloud.tool', t: 'outlook_send', label: 'Outlook Send', args: {} }
];
