/**
 * Palette categories with icons for the workflow builder toolbox
 */
import {
  Zap, Clock, Folder, Link, Cloud, FileCode, Keyboard, Command,
  MousePointer2, Scroll, Clipboard, Camera, Mic, Video, StopCircle,
  FileText, FolderOpen, FolderPlus, Move, AppWindow, Eye, Mail,
  Database, Calendar, FileSpreadsheet, GitBranch, ListOrdered, Workflow,
  Box, PenLine, BookOpen, ToggleLeft, PlusCircle, ListPlus, Trash2,
  Package, List, Layout, X, Wand2, Rocket, Terminal, Bell,
  Monitor, Volume2, Search, Globe, Brain, Calculator, Sigma,
  Sparkles, BarChart3, Hash, Speaker, Download, Archive, CheckCircle,
  MessageSquare, ListChecks, GitPullRequest, Play, Inbox,
  Send, User, Activity, Radio, Bot, Phone, PhoneCall,
  HardDrive, Scan, Binary,
  Film, Upload, Share2, Copy, Scissors, SortAsc, Settings2,
  Bluetooth, BluetoothOff, Sun, Battery, Image as ImageIcon,
  type LucideIcon
} from "lucide-react";

export interface PaletteCategoryItem {
  k: 'trigger' | 'local.tool' | 'cloud.tool';
  t: string;
  label: string;
  icon: LucideIcon;
  args: Record<string, any>;
  disabled?: boolean;
  /** Optional visual override stamped onto the dropped node — used by installed
   *  marketplace functions so the canvas node renders with the publisher's
   *  designed icon/color. */
  iconName?: string;
  colorKey?: string;
  /** When set, the canvas drop handler will materialize this top-level workflow
   *  as a sub-workflow inside the host workspace and wire a
   *  call_workspace_function node — instead of leaving a fragile cross-workflow
   *  call_workflow link to a separately-installed workflow. */
  sourceWorkflowId?: string;
}

export interface PaletteCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: PaletteCategoryItem[];
}

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  // ── Core workflow building blocks ─────────────────────────────────────────
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Zap,
    color: 'amber',
    items: [
      { k: 'trigger', t: 'manual', label: 'Manual (Click to Run)', icon: Play, args: {} },
      { k: 'trigger', t: 'app_start', label: 'On App Start', icon: AppWindow, args: {} },
      { k: 'trigger', t: 'hotkey', label: 'Hotkey', icon: Keyboard, args: { accelerator: 'Ctrl+Alt+K' } },
      { k: 'trigger', t: 'hotkey', label: 'Hotkey (hold)', icon: Radio, args: { accelerator: 'Ctrl+H', hold: true } },
      { k: 'trigger', t: 'hotkey.release', label: 'Hotkey Release', icon: Keyboard, args: { accelerator: 'Ctrl+H' } },
      { k: 'trigger', t: 'keystroke', label: 'Keystroke Sequence', icon: Command, args: { sequence: 'stuard' } },
      { k: 'trigger', t: 'function', label: 'Function (callable workflow)', icon: Workflow, args: {} },
      { k: 'trigger', t: 'webhook', label: 'Webhook', icon: Cloud, args: { mode: 'cloud' } },
      // ── Disabled pending Google CASA verification (push triggers need gmail.readonly / drive.readonly) ──
      // { k: 'trigger', t: 'gmail.new_email', label: 'Gmail: New Email', icon: Mail, args: { profile: 'default', labelIds: ['INBOX'] } },
      // { k: 'trigger', t: 'drive.new_file', label: 'Drive: New File', icon: Database, args: { profile: 'default', onlyNew: true, includeFolders: false } },
      { k: 'trigger', t: 'schedule.cron', label: 'Schedule', icon: Clock, args: { cron: '*/5 * * * *' } },
      { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', icon: Folder, args: { path: '', pattern: '*.*', recursive: true } },
      { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', icon: FileCode, args: { cmd: 'python', args: ['script.py'] } },
    ],
  },
  {
    id: 'flow',
    label: 'Flow Control',
    icon: GitBranch,
    color: 'indigo',
    items: [
      { k: 'local.tool', t: 'wait', label: 'Wait / Delay', icon: Clock, args: { ms: 1000 } },
      { k: 'local.tool', t: 'log', label: 'Log Message', icon: FileText, args: { message: '' } },
      { k: 'local.tool', t: 'send_notification', label: 'Send Notification', icon: Bell, args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },
      { k: 'local.tool', t: 'return_value', label: 'Return Value', icon: StopCircle, args: { value: '{{}}', success: true, message: '' } },
      { k: 'local.tool', t: 'end', label: 'End Flow', icon: StopCircle, args: {} },
      { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential', icon: ListOrdered, args: { steps: [] } },
      { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel', icon: Zap, args: { steps: [] } },
      { k: 'local.tool', t: 'invoke_workflow', label: 'Invoke Workflow', icon: Workflow, args: { id: '' } },
      { k: 'local.tool', t: 'call_workflow', label: 'Call Workflow (external)', icon: Workflow, args: { workflowId: '', inputs: {} } },
      { k: 'local.tool', t: 'call_function', label: 'Call Function (internal)', icon: Zap, args: { triggerId: '', inputs: {} } },
      { k: 'local.tool', t: 'call_workspace_function', label: 'Call Workspace Function', icon: FolderOpen, args: { path: '', inputs: {} } },
    ],
  },
  {
    id: 'variables',
    label: 'Variables',
    icon: Box,
    color: 'orange',
    items: [
      { k: 'local.tool', t: 'set_variable', label: 'Set Variable', icon: PenLine, args: { name: 'myVar', value: '' } },
      { k: 'local.tool', t: 'get_variable', label: 'Get Variable', icon: BookOpen, args: { name: 'myVar', default: '' } },
      { k: 'local.tool', t: 'toggle_variable', label: 'Toggle Boolean', icon: ToggleLeft, args: { name: 'isActive' } },
      { k: 'local.tool', t: 'increment_variable', label: 'Increment Number', icon: PlusCircle, args: { name: 'counter', amount: 1 } },
      { k: 'local.tool', t: 'append_to_list', label: 'Append to List', icon: ListPlus, args: { name: 'items', item: '' } },
      { k: 'local.tool', t: 'delete_variable', label: 'Delete Variable', icon: Trash2, args: { name: 'myVar' } },
    ],
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'agent',
    label: 'AI Agent',
    icon: Bot,
    color: 'purple',
    items: [
      { k: 'cloud.tool', t: 'agent_node', label: 'AI Agent', icon: Bot, args: { prompt: '', model: 'google/gemini-3.1-pro-preview', outputMode: 'text', maxSteps: 10 } },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Vision',
    icon: Eye,
    color: 'fuchsia',
    items: [
      // Unified AI inference — text, image, audio, video, screen, PDF — pick model + media in smart args.
      { k: 'cloud.tool', t: 'ai_inference', label: 'AI Inference', icon: Brain, args: { prompt: 'Summarize this', input: '', sources: [], mode: 'text', model: 'google/gemini-3.1-pro-preview' } },
      { k: 'cloud.tool', t: 'ai_inference', label: 'Analyze Screen', icon: Eye, args: { prompt: 'Describe what is currently on the screen — UI elements, text, and any relevant context.', sources: [{ captureScreen: true }], mode: 'text', model: 'google/gemini-3.1-pro-preview' } },
      { k: 'cloud.tool', t: 'ai_inference', label: 'AI Vision (JSON)', icon: Eye, args: { prompt: 'Extract structured data from this image.', sources: [{ path: '' }], mode: 'json', schema: { description: 'string', objects: 'string[]' }, model: 'google/gemini-3.1-pro-preview' } },
      { k: 'cloud.tool', t: 'find_text', label: 'Find Text', icon: Scan, args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
      { k: 'cloud.tool', t: 'find_and_click_text', label: 'Find & Click Text', icon: MousePointer2, args: { text: '', context: '', start: false, region: { x: 0, y: 0, width: 800, height: 600 }, caseSensitive: false } },
      { k: 'cloud.tool', t: 'google_cloud_ocr', label: 'OCR (Image or Screen)', icon: Scan, args: { path: '', imageUrl: '', base64: '', mimeType: 'image/png', captureScreen: false, region: { x: 0, y: 0, width: 800, height: 600 }, ocrMode: 'document', languageHints: [], includeWordBoxes: true } },
      { k: 'cloud.tool', t: 'generate_image', label: 'Generate Image', icon: Sparkles, args: { prompt: '', model: 'gemini-3.1-flash-image-preview', size: 'auto', aspect_ratio: 'auto', quality: 'auto', n: 1, format: 'png', background: 'auto' } },
    ],
  },
  {
    id: 'search',
    label: 'Web Search',
    icon: Search,
    color: 'green',
    items: [
      { k: 'cloud.tool', t: 'web_search', label: 'Web Search', icon: Search, args: { query: 'latest AI news' } },
      { k: 'cloud.tool', t: 'scrape_url', label: 'Scrape URL', icon: Globe, args: { urls: ['https://example.com'] } },
    ],
  },

  // ── Local interaction (input + media + files) ─────────────────────────────
  {
    id: 'input',
    label: 'Input (Mouse, Keys, Clipboard)',
    icon: MousePointer2,
    color: 'blue',
    items: [
      // Mouse
      { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', icon: MousePointer2, args: { x: 100, y: 100, button: 'left' } },
      { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', icon: MousePointer2, args: { x: 100, y: 100 } },
      { k: 'local.tool', t: 'move_cursor', label: 'Move Cursor', icon: MousePointer2, args: { x: 100, y: 100, duration: 0 } },
      { k: 'local.tool', t: 'scroll', label: 'Scroll', icon: Scroll, args: { deltaY: 120 } },
      { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', icon: Move, args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
      { k: 'local.tool', t: 'get_mouse_position', label: 'Get Mouse Position', icon: MousePointer2, args: {} },
      // Keyboard
      { k: 'local.tool', t: 'type_text', label: 'Type Text', icon: Keyboard, args: { text: '' } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', icon: Command, args: { keys: ['ctrl', 'c'] } },
      // Clipboard
      { k: 'local.tool', t: 'get_clipboard_content', label: 'Get Clipboard', icon: Clipboard, args: {} },
      { k: 'local.tool', t: 'set_clipboard_content', label: 'Set Clipboard', icon: Clipboard, args: { text: '' } },
    ],
  },
  {
    id: 'media',
    label: 'Media & Screen',
    icon: Camera,
    color: 'pink',
    items: [
      { k: 'local.tool', t: 'take_screenshot', label: 'Screenshot', icon: Camera, args: {} },
      { k: 'local.tool', t: 'capture_media', label: 'Capture Photo', icon: Camera, args: { kind: 'photo' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Webcam', icon: Video, args: { kind: 'video', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Mic Audio', icon: Mic, args: { kind: 'audio', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Webcam + Mic', icon: Video, args: { kind: 'audiovideo', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_screen', label: 'Record Screen', icon: Monitor, args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
      { k: 'local.tool', t: 'capture_system_audio', label: 'Record System Audio', icon: Volume2, args: { mode: 'until_stop', format: 'wav' } },
      { k: 'local.tool', t: 'stop_capture', label: 'Stop Webcam/Mic', icon: StopCircle, args: { sessionId: 'rec' } },
      { k: 'local.tool', t: 'stop_screen_capture', label: 'Stop Screen', icon: StopCircle, args: { sessionId: '' } },
      { k: 'local.tool', t: 'stop_system_audio', label: 'Stop System Audio', icon: StopCircle, args: { sessionId: '' } },
    ],
  },
  {
    id: 'files',
    label: 'Files',
    icon: FolderOpen,
    color: 'cyan',
    items: [
      // Local filesystem
      { k: 'local.tool', t: 'read_file', label: 'Read File', icon: FileText, args: { path: '' } },
      { k: 'local.tool', t: 'write_file', label: 'Write File', icon: PenLine, args: { path: '', content: '', description: '' } },
      { k: 'local.tool', t: 'list_directory', label: 'List Directory', icon: Folder, args: { path: '' } },
      { k: 'local.tool', t: 'glob', label: 'Find Files', icon: Search, args: { pattern: '*.txt', root: '' } },
      { k: 'local.tool', t: 'grep', label: 'Search In Files', icon: Search, args: { path: '', pattern: '' } },
      { k: 'local.tool', t: 'create_directory', label: 'Create Folder', icon: FolderPlus, args: { path: '' } },
      { k: 'local.tool', t: 'move_file', label: 'Move File', icon: Package, args: { src: '', dest: '' } },
      { k: 'local.tool', t: 'open_file', label: 'Open File', icon: FolderOpen, args: { path: '' } },
      { k: 'local.tool', t: 'run_command', label: 'Run Command', icon: Terminal, args: { command: 'echo hello', isPermissionRequired: false, description: '' } },
      { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App/URL', icon: Rocket, args: { target: '' } },
      // Workflow workspace (sandboxed, per-workflow)
      { k: 'local.tool', t: 'workspace_read_file', label: 'Read Workspace File', icon: FileText, args: { path: 'data/config.json' } },
      { k: 'local.tool', t: 'workspace_write_file', label: 'Write Workspace File', icon: PenLine, args: { path: 'data/config.json', content: '{}', description: 'Save config.json in the workflow workspace.' } },
      { k: 'local.tool', t: 'workspace_list_files', label: 'List Workspace Files', icon: List, args: { path: '' } },
      { k: 'local.tool', t: 'workspace_create_folder', label: 'Create Workspace Folder', icon: FolderPlus, args: { path: 'data/exports' } },
      { k: 'local.tool', t: 'workspace_delete_file', label: 'Delete Workspace File', icon: Trash2, args: { path: '' } },
      { k: 'local.tool', t: 'workspace_get_info', label: 'Get Workspace Info', icon: HardDrive, args: {} },
    ],
  },
  {
    id: 'scripts',
    label: 'Scripts',
    icon: FileCode,
    color: 'emerald',
    items: [
      { k: 'local.tool', t: 'run_python_script', label: 'Python Script', icon: FileCode, args: { code: 'print("Hello!")', packages: [] } },
      { k: 'local.tool', t: 'run_node_script', label: 'Node.js Script', icon: FileCode, args: { code: 'console.log("Hello!")' } },
    ],
  },
  {
    id: 'utils',
    label: 'Utilities',
    icon: Sparkles,
    color: 'teal',
    items: [
      { k: 'local.tool', t: 'get_datetime', label: 'Get Date & Time', icon: Clock, args: {} },
      { k: 'local.tool', t: 'math_eval', label: 'Math Expression', icon: Calculator, args: { expression: 'sqrt(16) + pow(2, 3)' } },
      { k: 'local.tool', t: 'generate_uuid', label: 'Generate UUID', icon: Hash, args: {} },
      { k: 'local.tool', t: 'random_number', label: 'Random Number', icon: Sparkles, args: { min: 1, max: 100 } },
      { k: 'local.tool', t: 'random_choice', label: 'Random Choice', icon: Sparkles, args: { items: ['a', 'b', 'c'] } },
      { k: 'local.tool', t: 'sleep', label: 'Sleep / Delay', icon: Clock, args: { seconds: 1 } },
      { k: 'local.tool', t: 'get_system_info', label: 'System Info', icon: Monitor, args: {} },
      { k: 'local.tool', t: 'get_env_var', label: 'Get Env Variable', icon: Box, args: { name: 'PATH' } },
      { k: 'local.tool', t: 'hash_string', label: 'Hash String', icon: Hash, args: { text: '', algorithm: 'sha256' } },
      { k: 'local.tool', t: 'base64_encode', label: 'Base64 Encode', icon: Binary, args: { text: '' } },
      { k: 'local.tool', t: 'base64_decode', label: 'Base64 Decode', icon: Binary, args: { encoded: '' } },
      { k: 'local.tool', t: 'json_parse', label: 'Parse JSON', icon: FileCode, args: { text: '{}' } },
      { k: 'local.tool', t: 'json_stringify', label: 'Stringify JSON', icon: FileCode, args: { data: {}, pretty: true } },
      { k: 'local.tool', t: 'regex_match', label: 'Regex Match', icon: Search, args: { text: '', pattern: '' } },
      { k: 'local.tool', t: 'regex_replace', label: 'Regex Replace', icon: PenLine, args: { text: '', pattern: '', replacement: '' } },
    ],
  },
  {
    id: 'math',
    label: 'Math (Scratch-style)',
    icon: Calculator,
    color: 'rose',
    items: [
      { k: 'local.tool', t: 'math_add', label: 'Add', icon: PlusCircle, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_subtract', label: 'Subtract', icon: Calculator, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_multiply', label: 'Multiply', icon: Hash, args: { a: 0, b: 0 } },
      { k: 'local.tool', t: 'math_divide', label: 'Divide', icon: Calculator, args: { a: 0, b: 1 } },
      { k: 'local.tool', t: 'math_power', label: 'Power', icon: Sparkles, args: { a: 2, b: 2 } },
      { k: 'local.tool', t: 'math_sqrt', label: 'Square Root', icon: Calculator, args: { x: 4 } },
      { k: 'local.tool', t: 'math_abs', label: 'Absolute', icon: Calculator, args: { x: -5 } },
      { k: 'local.tool', t: 'math_random', label: 'Random', icon: Sparkles, args: { min: 1, max: 10 } },
      { k: 'local.tool', t: 'math_sum', label: 'Sum List', icon: Sigma, args: { x: [1, 2, 3] } },
      { k: 'local.tool', t: 'math_mean', label: 'Average', icon: BarChart3, args: { x: [1, 2, 3] } },
      { k: 'local.tool', t: 'math_max', label: 'Max', icon: BarChart3, args: { x: [1, 5, 3] } },
      { k: 'local.tool', t: 'math_min', label: 'Min', icon: BarChart3, args: { x: [1, 5, 3] } },
      { k: 'local.tool', t: 'math_compare', label: 'Compare', icon: Calculator, args: { a: 5, b: 3, op: 'gt' } },
      { k: 'local.tool', t: 'math_range', label: 'Range', icon: ListOrdered, args: { start: 1, stop: 10 } },
    ],
  },

  // ── Network + storage + system ────────────────────────────────────────────
  {
    id: 'http',
    label: 'HTTP / API',
    icon: Globe,
    color: 'teal',
    items: [
      {
        k: 'local.tool',
        t: 'http_request',
        label: 'HTTP Request',
        icon: Globe,
        args: {
          url: 'https://httpbin.org/anything',
          method: 'GET',
          headers: {},
          query: {},
          json_body: undefined,
          form: undefined,
          bearer_token: '',
          timeout: 30,
          follow_redirects: true,
          verify_ssl: true,
          retries: 0,
        },
      },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    icon: Database,
    color: 'emerald',
    items: [
      { k: 'local.tool', t: 'db_store', label: 'Save Document', icon: HardDrive, args: { table: 'my_collection', data: {} } },
      { k: 'local.tool', t: 'db_retrieve', label: 'Get Document', icon: Search, args: { table: 'my_collection', id: '' } },
      { k: 'local.tool', t: 'db_search', label: 'Search Documents', icon: Search, args: { table: 'my_collection', filters: {}, limit: 100 } },
      { k: 'local.tool', t: 'db_delete', label: 'Delete Document', icon: Trash2, args: { table: 'my_collection', id: '' } },
      { k: 'local.tool', t: 'db_list_tables', label: 'List All Data', icon: List, args: {} },
      { k: 'local.tool', t: 'db_query', label: 'SQL Query', icon: FileCode, args: { query: 'SELECT * FROM my_table LIMIT 100' } },
    ],
  },
  {
    id: 'cloud_storage',
    label: 'Cloud Storage',
    icon: Cloud,
    color: 'cyan',
    items: [
      { k: 'cloud.tool', t: 'cloud_storage_upload', label: 'Upload File', icon: Upload, args: { path: '', folder: '', visibility: 'private' } },
      { k: 'cloud.tool', t: 'cloud_storage_get_url', label: 'Get File URL', icon: Link, args: { objectName: '', visibility: 'private' } },
      { k: 'cloud.tool', t: 'cloud_storage_list', label: 'List Files', icon: List, args: { prefix: '', limit: 100 } },
      { k: 'cloud.tool', t: 'cloud_storage_delete', label: 'Delete File', icon: Trash2, args: { objectName: '' } },
      { k: 'cloud.tool', t: 'cloud_storage_set_visibility', label: 'Set Visibility', icon: Eye, args: { objectName: '', visibility: 'public' } },
    ],
  },
  {
    id: 'ui',
    label: 'Custom UI',
    icon: Layout,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'custom_ui', label: 'Show UI', icon: AppWindow, args: { title: 'My UI', component: 'function App() {\n  return (\n    <div className="p-6 text-center">\n      <h2 className="text-2xl font-bold text-white">Hello</h2>\n      <button onClick={() => stuard.submit({ ok: true })} className="btn-primary mt-4 px-6">OK</button>\n    </div>\n  );\n}', window: { width: 300, height: 200, position: 'center', borderRadius: 12, frameless: true, alwaysOnTop: true, backgroundColor: '#1a1a2e', backgroundType: 'color', contentPadding: 24, shadow: { enabled: true, color: '#00000040', blur: 20, spread: 0, x: 0, y: 8 }, animation: { open: 'fade', close: 'fade', duration: 300, easing: 'ease-out' } } } },
      { k: 'local.tool', t: 'update_custom_ui', label: 'Update UI', icon: AppWindow, args: { id: '', data: {}, html: '' } },
      { k: 'local.tool', t: 'close_custom_ui', label: 'Close UI', icon: X, args: { id: '' } },
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: AppWindow,
    color: 'sky',
    items: [
      { k: 'local.tool', t: 'list_open_windows', label: 'List Windows', icon: List, args: {} },
      { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', icon: AppWindow, args: { title: '' } },
      { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus', icon: Wand2, args: { hint: '' } },
      { k: 'local.tool', t: 'get_window_info', label: 'Get Window Info', icon: AppWindow, args: { title: '' } },
      { k: 'local.tool', t: 'set_window_bounds', label: 'Resize / Move', icon: AppWindow, args: { title: '', bounds: { x: 0, y: 0, width: 900, height: 700 }, bringToTop: true } },
    ],
  },
  {
    id: 'desktop_controls',
    label: 'Desktop Controls',
    icon: Settings2,
    color: 'slate',
    items: [
      { k: 'local.tool', t: 'describe_desktop_control_capabilities', label: 'Check Capabilities', icon: Activity, args: {} },
      { k: 'local.tool', t: 'get_system_volume', label: 'Get Volume', icon: Volume2, args: {} },
      { k: 'local.tool', t: 'set_system_volume', label: 'Set Volume', icon: Volume2, args: { level: 50 } },
      { k: 'local.tool', t: 'get_display_brightness', label: 'Get Brightness', icon: Sun, args: {} },
      { k: 'local.tool', t: 'set_display_brightness', label: 'Set Brightness', icon: Sun, args: { percent: 75 } },
      { k: 'local.tool', t: 'list_bluetooth_devices', label: 'List Bluetooth Devices', icon: Bluetooth, args: {} },
      { k: 'local.tool', t: 'connect_bluetooth_device', label: 'Connect Bluetooth Device', icon: Bluetooth, args: { address: '' } },
      { k: 'local.tool', t: 'disconnect_bluetooth_device', label: 'Disconnect Bluetooth Device', icon: BluetoothOff, args: { address: '' } },
      { k: 'local.tool', t: 'get_power_status', label: 'Battery / Power Status', icon: Battery, args: {} },
      { k: 'local.tool', t: 'get_desktop_wallpaper', label: 'Get Wallpaper', icon: ImageIcon, args: {} },
      { k: 'local.tool', t: 'set_desktop_wallpaper', label: 'Set Wallpaper', icon: ImageIcon, args: { path: '', style: 'fill' } },
    ],
  },
  {
    id: 'browser_use',
    label: 'Browser',
    icon: Globe,
    color: 'cyan',
    items: [
      { k: 'local.tool', t: 'browser_use_status', label: 'Browser Status', icon: Activity, args: {} },
      { k: 'local.tool', t: 'browser_use_navigate', label: 'Navigate to URL', icon: Globe, args: { url: 'https://example.com', wait_until: 'domcontentloaded' } },
      { k: 'local.tool', t: 'browser_use_click', label: 'Click Element', icon: MousePointer2, args: { selector: '', text: '' } },
      { k: 'local.tool', t: 'browser_use_type', label: 'Type Text', icon: Keyboard, args: { selector: '', text: '', clear: true } },
      { k: 'local.tool', t: 'browser_use_press_key', label: 'Press Key', icon: Command, args: { key: 'Enter', selector: '' } },
      { k: 'local.tool', t: 'browser_use_screenshot', label: 'Screenshot', icon: Camera, args: { full_page: false }, disabled: true },
      { k: 'local.tool', t: 'browser_use_content', label: 'Get Page Content', icon: FileText, args: { mode: 'text', max_length: 15000 } },
      { k: 'local.tool', t: 'browser_use_scroll', label: 'Scroll Page', icon: Scroll, args: { direction: 'down', amount: 500 } },
      { k: 'local.tool', t: 'browser_use_get_interactive_elements', label: 'Get Interactive Elements', icon: Search, args: {} },
      { k: 'local.tool', t: 'browser_use_fill_form', label: 'Fill Form', icon: PenLine, args: { fields: {}, submit: false } },
      { k: 'local.tool', t: 'browser_use_upload_file', label: 'Upload Local File', icon: Upload, args: { selector: '', filePath: '' } },
      { k: 'local.tool', t: 'browser_use_hover', label: 'Hover Element', icon: MousePointer2, args: { selector: '', text: '' } },
      { k: 'local.tool', t: 'browser_use_get_dropdown_options', label: 'Read Dropdown Options', icon: ListOrdered, args: { selector: '' } },
      { k: 'local.tool', t: 'browser_use_select_option', label: 'Select Dropdown', icon: ListOrdered, args: { selector: '', label: '' } },
      { k: 'local.tool', t: 'browser_use_wait_for', label: 'Wait For Element', icon: Clock, args: { selector: '', timeout: 10000 } },
      { k: 'local.tool', t: 'browser_use_tabs', label: 'Manage Tabs', icon: Layout, args: { action: 'list' } },
      { k: 'local.tool', t: 'browser_use_cookies', label: 'Manage Cookies', icon: Database, args: { action: 'get' } },
      { k: 'local.tool', t: 'browser_use_execute_script', label: 'Execute JS Script', icon: FileCode, args: { script: 'return document.title;' } },
      { k: 'local.tool', t: 'browser_use_configure', label: 'Configure Browser', icon: Box, args: { mode: 'headed' } },
      { k: 'local.tool', t: 'browser_use_sync_chrome', label: 'Sync Chrome Cookies', icon: Download, args: {} },
    ],
  },

  // ── Media tooling + local AI ──────────────────────────────────────────────
  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    icon: Film,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'ffmpeg_status', label: 'FFmpeg Status', icon: Activity, args: {} },
      { k: 'local.tool', t: 'ffmpeg_setup', label: 'Install FFmpeg', icon: Download, args: {} },
      { k: 'local.tool', t: 'ffmpeg_probe_media', label: 'Probe File (Metadata)', icon: Search, args: { inputPath: '' } },
      { k: 'local.tool', t: 'ffmpeg_convert_media', label: 'Convert Media', icon: Film, args: { inputPath: '', outputPath: '', overwrite: true } },
      { k: 'local.tool', t: 'ffmpeg_extract_audio', label: 'Extract Audio', icon: Mic, args: { inputPath: '', outputPath: '', overwrite: true } },
      { k: 'local.tool', t: 'ffmpeg_trim_media', label: 'Trim Media', icon: Scissors, args: { inputPath: '', outputPath: '', startSeconds: 0, durationSeconds: 30, overwrite: true } },
      { k: 'local.tool', t: 'ffmpeg_extract_frames', label: 'Extract Frames', icon: Camera, args: { inputPath: '', outputPattern: '', fps: 1, overwrite: true } },
      { k: 'local.tool', t: 'ffmpeg_run', label: 'Custom FFmpeg Command', icon: Terminal, args: { args: [] } },
    ],
  },
  {
    id: 'mediapipe',
    label: 'MediaPipe (CV)',
    icon: Scan,
    color: 'lime',
    items: [
      { k: 'local.tool', t: 'mediapipe_pose', label: 'Pose Estimation', icon: Activity, args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_hands', label: 'Hand Tracking', icon: Scan, args: { imagePath: '', drawLandmarks: true, maxNumHands: 2, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_face_detection', label: 'Face Detection', icon: User, args: { imagePath: '', drawDetections: true, modelSelection: 0, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_face_mesh', label: 'Face Mesh (468pt)', icon: Scan, args: { imagePath: '', drawLandmarks: true, maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_segmentation', label: 'Background Removal', icon: User, args: { imagePath: '', threshold: 0.5, blurBackground: false } },
      { k: 'local.tool', t: 'mediapipe_holistic', label: 'Holistic (All-in-One)', icon: Activity, args: { imagePath: '', drawLandmarks: true, modelComplexity: 1, minDetectionConfidence: 0.5 } },
      { k: 'local.tool', t: 'mediapipe_process_video', label: 'Process Video', icon: Video, args: { videoPath: '', task: 'pose', drawLandmarks: true, maxFrames: 0, sampleEveryN: 1 } },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (Local AI)',
    icon: Bot,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'ollama_status', label: 'Check Status', icon: Activity, args: {} },
      { k: 'local.tool', t: 'ollama_agent', label: 'Local AI Agent', icon: Bot, args: { model: 'llama3.2', prompt: '', outputMode: 'text', toolMode: 'curated', maxSteps: 8 } },
      { k: 'local.tool', t: 'ollama_embeddings', label: 'Embeddings', icon: Binary, args: { model: 'nomic-embed-text', input: '' } },
      { k: 'local.tool', t: 'ollama_models', label: 'Manage Models', icon: List, args: { action: 'list' } },
    ],
  },
  {
    id: 'tts',
    label: 'ElevenLabs Voice',
    icon: Speaker,
    color: 'purple',
    items: [
      { k: 'cloud.tool', t: 'text_to_speech', label: 'Text to Speech', icon: Speaker, args: { text: 'Hello!', voice_id: 'JBFqnCBsd6RMkjVDRZzb', model_id: 'eleven_multilingual_v2', language_code: '', speed: 1.0, format: 'mp3', save: true, play: false } },
      { k: 'cloud.tool', t: 'list_tts_voices', label: 'List TTS Voices', icon: List, args: {} },
      { k: 'cloud.tool', t: 'get_tts_models', label: 'Get TTS Models', icon: List, args: {} },
      { k: 'cloud.tool', t: 'elevenlabs_list_agents', label: 'List Live Agents', icon: Bot, args: { search: '', archived: false, show_only_owned_agents: true, page_size: 20 } },
      { k: 'cloud.tool', t: 'elevenlabs_get_signed_conversation_url', label: 'Get Live Session URL', icon: Radio, args: { agent_id: '', include_conversation_id: true, branch_id: '' } },
      { k: 'cloud.tool', t: 'elevenlabs_get_webrtc_token', label: 'Get WebRTC Token', icon: Mic, args: { agent_id: '', participant_name: '', branch_id: '' } },
      { k: 'cloud.tool', t: 'elevenlabs_list_conversations', label: 'List Voice Sessions', icon: ListChecks, args: { agent_id: '', search: '', branch_id: '', page_size: 20 } },
    ],
  },

  // ── Integrations: Google ──────────────────────────────────────────────────
  {
    id: 'gmail',
    label: 'Gmail',
    icon: Mail,
    color: 'red',
    items: [
      { k: 'cloud.tool', t: 'gmail_send_message', label: 'Send Email', icon: Send, args: { to: [], subject: '', body: '', contentType: 'text/plain', from: '', profile: '' } },
      // ── Disabled pending Google CASA verification (gmail.readonly / gmail.modify restricted scopes) ──
    ],
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    icon: Database,
    color: 'amber',
    items: [
      // ── Disabled pending Google CASA verification (drive / drive.readonly restricted scopes) ──
      { k: 'cloud.tool', t: 'drive_get_file', label: 'Get File Metadata', icon: FileText, args: { fileId: '' } },
      { k: 'cloud.tool', t: 'drive_create_file', label: 'Create File', icon: PenLine, args: { name: 'file.txt', content: '', mimeType: 'text/plain' } },
      { k: 'cloud.tool', t: 'drive_create_folder', label: 'Create Folder', icon: FolderPlus, args: { name: 'New Folder' } },
      { k: 'cloud.tool', t: 'drive_upload_file', label: 'Upload Local File', icon: Upload, args: { path: '' } },
      { k: 'cloud.tool', t: 'drive_download_file', label: 'Download File', icon: Download, args: { fileId: '', path: '' } },
      { k: 'cloud.tool', t: 'drive_export_file', label: 'Export Google File', icon: Download, args: { fileId: '', path: '', exportMimeType: 'application/pdf' } },
      { k: 'cloud.tool', t: 'drive_update_file', label: 'Update File Content', icon: Upload, args: { fileId: '', path: '' } },
      { k: 'cloud.tool', t: 'drive_move_file', label: 'Move File', icon: Move, args: { fileId: '', newParentId: '' } },
      { k: 'cloud.tool', t: 'drive_copy_file', label: 'Copy File', icon: Copy, args: { fileId: '' } },
      { k: 'cloud.tool', t: 'drive_rename_file', label: 'Rename File', icon: PenLine, args: { fileId: '', name: '' } },
      { k: 'cloud.tool', t: 'drive_trash_file', label: 'Move to Trash', icon: Archive, args: { fileId: '' } },
      { k: 'cloud.tool', t: 'drive_delete_file', label: 'Delete Permanently', icon: Trash2, args: { fileId: '' } },
      { k: 'cloud.tool', t: 'drive_share_file', label: 'Share File', icon: Share2, args: { fileId: '', role: 'reader', type: 'user', emailAddress: '' } },
      { k: 'cloud.tool', t: 'drive_list_permissions', label: 'List Permissions', icon: List, args: { fileId: '' } },
      { k: 'cloud.tool', t: 'drive_remove_permission', label: 'Remove Permission', icon: Trash2, args: { fileId: '', permissionId: '' } },
      { k: 'cloud.tool', t: 'drive_get_storage_quota', label: 'Storage Quota', icon: HardDrive, args: {} },
    ],
  },
  {
    id: 'google_calendar',
    label: 'Google Calendar',
    icon: Calendar,
    color: 'blue',
    items: [
      { k: 'cloud.tool', t: 'calendar_list_events', label: 'List Events', icon: List, args: { calendarId: 'primary', maxResults: 10 } },
      { k: 'cloud.tool', t: 'calendar_create_event', label: 'Create Event', icon: PlusCircle, args: { summary: '', start: '', end: '' } },
      { k: 'cloud.tool', t: 'calendar_delete_event', label: 'Delete Event', icon: Trash2, args: { eventId: '' } },
    ],
  },
  {
    id: 'google_sheets',
    label: 'Google Sheets',
    icon: FileSpreadsheet,
    color: 'green',
    items: [
      { k: 'cloud.tool', t: 'sheets_read_range', label: 'Read Range', icon: FileSpreadsheet, args: { spreadsheetId: '', range: 'Sheet1!A1:B10' } },
      { k: 'cloud.tool', t: 'sheets_get_spreadsheet', label: 'Get Spreadsheet Info', icon: Search, args: { spreadsheetId: '' } },
      { k: 'cloud.tool', t: 'sheets_create_spreadsheet', label: 'Create Spreadsheet', icon: PlusCircle, args: { title: 'Untitled' } },
      { k: 'cloud.tool', t: 'sheets_write_range', label: 'Write Range', icon: PenLine, args: { spreadsheetId: '', range: 'Sheet1!A1', values: [[]] } },
      { k: 'cloud.tool', t: 'sheets_append_rows', label: 'Append Rows', icon: ListPlus, args: { spreadsheetId: '', range: 'Sheet1!A:Z', values: [[]] } },
      { k: 'cloud.tool', t: 'sheets_clear_range', label: 'Clear Range', icon: X, args: { spreadsheetId: '', range: 'Sheet1!A2:Z' } },
      { k: 'cloud.tool', t: 'sheets_add_sheet', label: 'Add Sheet / Tab', icon: PlusCircle, args: { spreadsheetId: '', title: 'Sheet2' } },
      { k: 'cloud.tool', t: 'sheets_batch_update_values', label: 'Batch Write', icon: FileSpreadsheet, args: { spreadsheetId: '', data: [{ range: 'Sheet1!A1', values: [[]] }] } },
      { k: 'cloud.tool', t: 'sheets_format_cells', label: 'Format Cells', icon: Settings2, args: { spreadsheetId: '', sheetId: 0, requests: [] } },
      { k: 'cloud.tool', t: 'sheets_delete_rows_columns', label: 'Delete Rows / Columns', icon: Trash2, args: { spreadsheetId: '', sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 } },
      { k: 'cloud.tool', t: 'sheets_sort_range', label: 'Sort Range', icon: SortAsc, args: { spreadsheetId: '', sheetId: 0, range: { startRowIndex: 0, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 5 }, sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }] } },
      { k: 'cloud.tool', t: 'sheets_auto_resize', label: 'Auto-Resize Columns', icon: Scan, args: { spreadsheetId: '', sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 10 } },
    ],
  },
  {
    id: 'google_docs',
    label: 'Google Docs',
    icon: FileText,
    color: 'blue',
    items: [
      { k: 'cloud.tool', t: 'docs_get_document', label: 'Get Document', icon: FileText, args: { documentId: '' } },
      { k: 'cloud.tool', t: 'docs_create_document', label: 'Create Document', icon: PlusCircle, args: { title: 'Untitled' } },
      { k: 'cloud.tool', t: 'docs_write_text', label: 'Write Text', icon: PenLine, args: { documentId: '', text: '' } },
    ],
  },
  {
    id: 'google_tasks',
    label: 'Google Tasks',
    icon: ListChecks,
    color: 'indigo',
    items: [
      { k: 'cloud.tool', t: 'tasks_list', label: 'List Tasks', icon: List, args: { maxResults: 10 } },
    ],
  },

  // ── Integrations: Microsoft + Dev + Comms + Social ────────────────────────
  // Disabled — Outlook integration temporarily hidden (see shared/integration-flags.ts)
  /*
  {
    id: 'outlook',
    label: 'Outlook',
    icon: Mail,
    color: 'sky',
    items: [
      { k: 'cloud.tool', t: 'outlook_send_mail', label: 'Send Email', icon: Send, args: { to: [], subject: '', body: '', contentType: 'Text' } },
      { k: 'cloud.tool', t: 'outlook_list_messages', label: 'List Messages', icon: Inbox, args: { folder: 'Inbox', top: 10 } },
      { k: 'cloud.tool', t: 'outlook_search_messages', label: 'Search Messages', icon: Search, args: { query: '', top: 10 } },
      { k: 'cloud.tool', t: 'outlook_get_message', label: 'Get Message', icon: FileText, args: { id: '' } },
      { k: 'cloud.tool', t: 'outlook_list_recent_brief', label: 'Recent Messages', icon: List, args: { maxResults: 5 } },
      { k: 'cloud.tool', t: 'outlook_list_folders', label: 'List Folders', icon: Folder, args: {} },
      { k: 'cloud.tool', t: 'outlook_reply_message', label: 'Reply', icon: MessageSquare, args: { id: '', comment: '' } },
      { k: 'cloud.tool', t: 'outlook_forward_message', label: 'Forward', icon: Send, args: { id: '', to: [] } },
      { k: 'cloud.tool', t: 'outlook_create_draft', label: 'Create Draft', icon: PenLine, args: { to: [], subject: '', body: '' } },
      { k: 'cloud.tool', t: 'outlook_mark_as_read', label: 'Mark Read', icon: CheckCircle, args: { id: '' } },
      { k: 'cloud.tool', t: 'outlook_archive_message', label: 'Archive', icon: Archive, args: { id: '' } },
      { k: 'cloud.tool', t: 'outlook_move_message', label: 'Move Message', icon: Move, args: { id: '', destinationId: '' } },
      { k: 'cloud.tool', t: 'outlook_delete_message', label: 'Delete Message', icon: Trash2, args: { id: '' } },
      { k: 'cloud.tool', t: 'outlook_download_attachment', label: 'Download Attachment', icon: Download, args: { messageId: '', attachmentId: '', path: '' } },
      { k: 'cloud.tool', t: 'outlook_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'outlook_calendar_list_events', label: 'List Events', icon: Calendar, args: {} },
      { k: 'cloud.tool', t: 'outlook_calendar_create_event', label: 'Create Event', icon: PlusCircle, args: { subject: '', start: '', end: '' } },
      { k: 'cloud.tool', t: 'outlook_calendar_update_event', label: 'Update Event', icon: PenLine, args: { eventId: '' } },
      { k: 'cloud.tool', t: 'outlook_calendar_delete_event', label: 'Delete Event', icon: Trash2, args: { eventId: '' } },
    ],
  },
  */
  {
    id: 'github',
    label: 'GitHub',
    icon: GitBranch,
    color: 'slate',
    items: [
      { k: 'cloud.tool', t: 'github_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'github_list_repos', label: 'List Repos', icon: Database, args: { visibility: 'all' } },
      { k: 'cloud.tool', t: 'github_list_issues', label: 'List Issues', icon: MessageSquare, args: { owner: '', repo: '', state: 'open' } },
      { k: 'cloud.tool', t: 'github_create_issue', label: 'Create Issue', icon: GitPullRequest, args: { owner: '', repo: '', title: '', body: '' } },
    ],
  },
  // Disabled — WhatsApp integration temporarily hidden (see shared/integration-flags.ts)
  // {
  //   id: 'whatsapp',
  //   label: 'WhatsApp',
  //   icon: Phone,
  //   color: 'emerald',
  //   items: [
  //     { k: 'cloud.tool', t: 'whatsapp_status', label: 'Check Status', icon: Phone, args: {} },
  //     { k: 'cloud.tool', t: 'whatsapp_send_message', label: 'Send Message', icon: MessageSquare, args: { message: '', preview_url: false } },
  //     { k: 'cloud.tool', t: 'whatsapp_send_media', label: 'Send Media', icon: Camera, args: { type: 'image', url: '', caption: '' } },
  //     { k: 'cloud.tool', t: 'whatsapp_send_reaction', label: 'Send Reaction', icon: Activity, args: { message_id: '', emoji: '👍' } },
  //     { k: 'cloud.tool', t: 'whatsapp_mark_read', label: 'Mark Read', icon: CheckCircle, args: { message_id: '' } },
  //     { k: 'cloud.tool', t: 'whatsapp_upload_media', label: 'Upload Media', icon: Download, args: { url: '', mime_type: '' } },
  //   ],
  // },
  {
    id: 'telnyx',
    label: 'SMS / Call',
    icon: Phone,
    color: 'emerald',
    items: [
      { k: 'cloud.tool', t: 'telnyx_send_sms', label: 'Send SMS', icon: MessageSquare, args: { message: '' } },
      { k: 'cloud.tool', t: 'telnyx_voice_call', label: 'AI Voice Call', icon: PhoneCall, args: { provider: 'auto', initial_message: '', system_prompt: '' } },
      { k: 'cloud.tool', t: 'telnyx_phone_status', label: 'Check Phone Status', icon: Phone, args: {} },
    ],
  },
  // Disabled — Meta integrations temporarily hidden (see shared/integration-flags.ts)
  /*
  {
    id: 'facebook',
    label: 'Facebook',
    icon: MessageSquare,
    color: 'blue',
    items: [
      { k: 'cloud.tool', t: 'facebook_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'facebook_list_pages', label: 'List Pages', icon: List, args: {} },
      { k: 'cloud.tool', t: 'facebook_list_page_posts', label: 'List Page Posts', icon: Inbox, args: { page_id: '', limit: 10 } },
      { k: 'cloud.tool', t: 'facebook_create_page_post', label: 'Create Page Post', icon: Send, args: { page_id: '', message: '', link: '', published: true } },
    ],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    icon: Camera,
    color: 'rose',
    items: [
      { k: 'cloud.tool', t: 'instagram_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'instagram_list_media', label: 'List Media', icon: List, args: { limit: 10 } },
      { k: 'cloud.tool', t: 'instagram_publish_media', label: 'Publish Media', icon: Send, args: { media_type: 'IMAGE', image_url: '', caption: '' } },
    ],
  },
  {
    id: 'threads',
    label: 'Threads',
    icon: Radio,
    color: 'slate',
    items: [
      { k: 'cloud.tool', t: 'threads_get_me', label: 'Get Profile', icon: User, args: {} },
      { k: 'cloud.tool', t: 'threads_list_posts', label: 'List Posts', icon: List, args: { limit: 10 } },
      { k: 'cloud.tool', t: 'threads_publish_post', label: 'Publish Post', icon: Send, args: { text: '', reply_control: 'everyone' } },
    ],
  },
  */
  {
    id: 'x',
    label: 'X',
    icon: X,
    color: 'slate',
    items: [
      { k: 'cloud.tool', t: 'x_search_tweets', label: 'Search Posts', icon: Search, args: { query: '', max_results: 20 } },
      { k: 'cloud.tool', t: 'x_get_user_timeline', label: 'User Timeline', icon: List, args: { username: '', max_results: 20, exclude_replies: false, exclude_retweets: false } },
      { k: 'cloud.tool', t: 'x_get_tweet', label: 'Get Post', icon: FileText, args: { id: '' } },
      { k: 'cloud.tool', t: 'x_get_comments', label: 'Get Comments', icon: MessageSquare, args: { post_id: '', username: '', max_results: 20, only_direct_replies: false, exclude_retweets: true } },
      { k: 'cloud.tool', t: 'x_comment_on_post', label: 'Comment Post', icon: MessageSquare, args: { post_id: '', text: '' } },
      { k: 'cloud.tool', t: 'x_reply_to_comment', label: 'Reply Comment', icon: MessageSquare, args: { comment_id: '', text: '' } },
      { k: 'cloud.tool', t: 'x_like_comment', label: 'Like Comment', icon: CheckCircle, args: { comment_id: '' } },
      { k: 'cloud.tool', t: 'x_post_tweet', label: 'Post to X', icon: Send, args: { text: '', reply_to_tweet_id: '' } },
      { k: 'cloud.tool', t: 'x_delete_tweet', label: 'Delete Post', icon: Trash2, args: { id: '' } },
      { k: 'cloud.tool', t: 'x_send_dm', label: 'Send DM', icon: MessageSquare, args: { recipient_username: '', text: '' } },
      { k: 'cloud.tool', t: 'x_list_dms', label: 'List DMs', icon: Inbox, args: { conversation_id: '', participant_username: '', max_results: 20 } },
      { k: 'cloud.tool', t: 'x_get_user', label: 'Get User', icon: User, args: { username: '' } },
      { k: 'cloud.tool', t: 'x_list_followers', label: 'List Followers', icon: List, args: { username: '', max_results: 100 } },
      { k: 'cloud.tool', t: 'x_list_following', label: 'List Following', icon: List, args: { username: '', max_results: 100 } },
    ],
  },
  // Disabled — Reddit integration temporarily hidden (see shared/integration-flags.ts)
  /*
  {
    id: 'reddit',
    label: 'Reddit',
    icon: Globe,
    color: 'orange',
    items: [
      { k: 'cloud.tool', t: 'reddit_search', label: 'Search Posts', icon: Search, args: { query: '', sort: 'relevance', time: 'all', limit: 25 } },
      { k: 'cloud.tool', t: 'reddit_view_subreddit', label: 'View Subreddit', icon: List, args: { subreddit: '', sort: 'hot', limit: 25 } },
      { k: 'cloud.tool', t: 'reddit_view_comments', label: 'View Comments', icon: MessageSquare, args: { subreddit: '', post_id: '' } },
      { k: 'cloud.tool', t: 'reddit_create_post', label: 'Create Post', icon: Send, args: { subreddit: '', title: '', kind: 'self', text: '' } },
      { k: 'cloud.tool', t: 'reddit_comment', label: 'Comment / Reply', icon: MessageSquare, args: { thing_id: '', text: '' } },
    ],
  },
  */
];

/**
 * Visual section groups for the palette. Each category id is mapped to a top-level
 * group so the UI can render dividers and reduce 30+-row scan fatigue. The order
 * of groups + ids below also defines the visual ordering inside each group.
 */
export const PALETTE_GROUPS: { id: string; label: string; categoryIds: string[] }[] = [
  { id: 'core', label: 'Core', categoryIds: ['installed', 'triggers', 'flow', 'variables'] },
  { id: 'ai', label: 'AI', categoryIds: ['agent', 'ai', 'search'] },
  { id: 'local', label: 'Local Actions', categoryIds: ['input', 'media', 'files', 'scripts', 'utils', 'math'] },
  { id: 'system', label: 'Network · Data · System', categoryIds: ['http', 'database', 'cloud_storage', 'ui', 'windows', 'desktop_controls', 'browser_use'] },
  { id: 'media_ai', label: 'Media Tooling & Local AI', categoryIds: ['ffmpeg', 'mediapipe', 'ollama', 'tts'] },
  { id: 'google', label: 'Google', categoryIds: ['gmail', 'google_drive', 'google_calendar', 'google_sheets', 'google_docs', 'google_tasks'] },
  { id: 'integrations', label: 'Integrations', categoryIds: ['github', 'telnyx', 'x'] },
];

/** Lookup: category id → group id. Used by the palette to render dividers. */
export const CATEGORY_TO_GROUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const g of PALETTE_GROUPS) for (const id of g.categoryIds) map[id] = g.id;
  return map;
})();

export const CATEGORY_COLORS: Record<string, { bg: string; border: string; hover: string; text: string; icon: string }> = {
  slate: { bg: 'bg-slate-50', border: 'border-slate-200', hover: 'hover:bg-slate-100', text: 'text-slate-700', icon: 'text-slate-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200', hover: 'hover:bg-amber-100', text: 'text-amber-800', icon: 'text-amber-600' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-200', hover: 'hover:bg-purple-100', text: 'text-purple-800', icon: 'text-purple-600' },
  blue: { bg: 'bg-blue-50', border: 'border-blue-200', hover: 'hover:bg-blue-100', text: 'text-blue-800', icon: 'text-blue-600' },
  green: { bg: 'bg-green-50', border: 'border-green-200', hover: 'hover:bg-green-100', text: 'text-green-800', icon: 'text-green-600' },
  pink: { bg: 'bg-pink-50', border: 'border-pink-200', hover: 'hover:bg-pink-100', text: 'text-pink-800', icon: 'text-pink-600' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:bg-orange-100', text: 'text-orange-800', icon: 'text-orange-600' },
  yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', hover: 'hover:bg-yellow-100', text: 'text-yellow-800', icon: 'text-yellow-600' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', hover: 'hover:bg-cyan-100', text: 'text-cyan-800', icon: 'text-cyan-600' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', hover: 'hover:bg-violet-100', text: 'text-violet-800', icon: 'text-violet-600' },
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', hover: 'hover:bg-indigo-100', text: 'text-indigo-800', icon: 'text-indigo-600' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', hover: 'hover:bg-emerald-100', text: 'text-emerald-800', icon: 'text-emerald-600' },
  fuchsia: { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', hover: 'hover:bg-fuchsia-100', text: 'text-fuchsia-800', icon: 'text-fuchsia-600' },
  teal: { bg: 'bg-teal-50', border: 'border-teal-200', hover: 'hover:bg-teal-100', text: 'text-teal-800', icon: 'text-teal-600' },
  sky: { bg: 'bg-sky-50', border: 'border-sky-200', hover: 'hover:bg-sky-100', text: 'text-sky-800', icon: 'text-sky-600' },
  rose: { bg: 'bg-rose-50', border: 'border-rose-200', hover: 'hover:bg-rose-100', text: 'text-rose-800', icon: 'text-rose-600' },
  red: { bg: 'bg-red-50', border: 'border-red-200', hover: 'hover:bg-red-100', text: 'text-red-800', icon: 'text-red-600' },
  lime: { bg: 'bg-lime-50', border: 'border-lime-200', hover: 'hover:bg-lime-100', text: 'text-lime-800', icon: 'text-lime-600' },
};

/** Helper to find icon for a tool/trigger type */
export const getToolIcon = (type: string, isTrigger?: boolean): LucideIcon => {
  for (const cat of PALETTE_CATEGORIES) {
    const found = cat.items.find(i => i.t === type);
    if (found) return found.icon;
  }
  return isTrigger ? Zap : Command;
};

/** Helper to find category color for a tool/trigger type */
export const getToolColor = (type: string, isTrigger?: boolean): string => {
  for (const cat of PALETTE_CATEGORIES) {
    const found = cat.items.find(i => i.t === type);
    if (found) return cat.color;
  }
  return isTrigger ? 'amber' : 'slate';
};
