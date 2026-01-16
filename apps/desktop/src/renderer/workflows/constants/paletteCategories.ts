/**
 * Palette categories with icons for the workflow builder toolbox
 */
import {
  Zap, Clock, Folder, Link, Cloud, FileCode, Keyboard, Command,
  MousePointer2, Scroll, Clipboard, Camera, Mic, Video, StopCircle,
  FileText, FolderOpen, FolderPlus, Move, AppWindow, Eye, Mail,
  Database, Calendar, FileSpreadsheet, GitMerge, ListOrdered, Workflow,
  Box, PenLine, BookOpen, ToggleLeft, PlusCircle, ListPlus, Trash2,
  Package, List, Layout, X, Wand2, Rocket, Terminal, Link2, Bell,
  Monitor, Volume2, type LucideIcon
} from "lucide-react";

export interface PaletteCategoryItem {
  k: 'trigger' | 'local.tool' | 'cloud.tool';
  t: string;
  label: string;
  icon: LucideIcon;
  args: Record<string, any>;
}

export interface PaletteCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: PaletteCategoryItem[];
}

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Zap,
    color: 'amber',
    items: [
      { k: 'trigger', t: 'hotkey', label: 'Hotkey (blocking)', icon: Keyboard, args: { accelerator: 'Ctrl+Alt+K', passthrough: false } },
      { k: 'trigger', t: 'hotkey', label: 'Hotkey (pass-through)', icon: Keyboard, args: { accelerator: 'Ctrl+C', passthrough: true } },
      { k: 'trigger', t: 'keystroke', label: 'Keystroke Sequence', icon: Command, args: { sequence: 'stuard' } },
      { k: 'trigger', t: 'webhook.local', label: 'Webhook (Local)', icon: Link, args: {} },
      { k: 'trigger', t: 'webhook.cloud', label: 'Webhook (Cloud)', icon: Cloud, args: {} },
      { k: 'trigger', t: 'schedule.cron', label: 'Schedule', icon: Clock, args: { cron: '*/5 * * * *' } },
      { k: 'trigger', t: 'fs.watch', label: 'File/Folder Watch', icon: Folder, args: { path: '', pattern: '*.*', recursive: true } },
      { k: 'trigger', t: 'command.watch', label: 'Custom Script (watch)', icon: FileCode, args: { cmd: 'python', args: ['script.py'] } },
    ],
  },
  {
    id: 'flow',
    label: 'Flow Control',
    icon: GitMerge,
    color: 'indigo',
    items: [
      { k: 'local.tool', t: 'wait', label: 'Wait / Delay', icon: Clock, args: { ms: 1000 } },
      { k: 'local.tool', t: 'log', label: 'Log Message', icon: FileText, args: { message: '' } },
      { k: 'local.tool', t: 'send_notification', label: 'Send Notification', icon: Bell, args: { title: 'Stuard AI', body: 'Hello!', severity: 'info' } },
      { k: 'local.tool', t: 'end', label: 'End Flow', icon: StopCircle, args: {} },
      { k: 'local.tool', t: 'run_sequential', label: 'Run Sequential', icon: ListOrdered, args: { steps: [] } },
      { k: 'local.tool', t: 'run_parallel', label: 'Run Parallel', icon: Zap, args: { steps: [] } },
      { k: 'local.tool', t: 'invoke_workflow', label: 'Invoke Workflow', icon: Workflow, args: { id: '' } },
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
  {
    id: 'input',
    label: 'Input & Output',
    icon: Keyboard,
    color: 'blue',
    items: [
      { k: 'local.tool', t: 'type_text', label: 'Type Text', icon: Keyboard, args: { text: '' } },
      { k: 'local.tool', t: 'send_hotkey', label: 'Send Hotkey', icon: Command, args: { keys: ['ctrl', 'c'] } },
      { k: 'local.tool', t: 'click_at_coordinates', label: 'Click', icon: MousePointer2, args: { x: 100, y: 100, button: 'left' } },
      { k: 'local.tool', t: 'double_click_at_coordinates', label: 'Double Click', icon: MousePointer2, args: { x: 100, y: 100 } },
      { k: 'local.tool', t: 'scroll', label: 'Scroll', icon: Scroll, args: { deltaY: 120 } },
      { k: 'local.tool', t: 'drag_and_drop', label: 'Drag & Drop', icon: Move, args: { fromX: 100, fromY: 100, toX: 400, toY: 400 } },
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
      { k: 'local.tool', t: 'capture_media', label: 'Record Mic Audio', icon: Mic, args: { kind: 'audio', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_media', label: 'Record Webcam', icon: Video, args: { kind: 'video', mode: 'until_stop', sessionId: 'rec' } },
      { k: 'local.tool', t: 'capture_screen', label: 'Record Screen', icon: Monitor, args: { mode: 'until_stop', target: 'fullscreen', fps: 30, quality: 'medium' } },
      { k: 'local.tool', t: 'capture_screen', label: 'Record Screen + Audio', icon: Monitor, args: { mode: 'until_stop', target: 'fullscreen', includeSystemAudio: true, fps: 30, quality: 'medium' } },
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
      { k: 'local.tool', t: 'read_file', label: 'Read File', icon: FileText, args: { path: '' } },
      { k: 'local.tool', t: 'write_file', label: 'Write File', icon: PenLine, args: { path: '', content: '' } },
      { k: 'local.tool', t: 'list_directory', label: 'List Directory', icon: Folder, args: { path: '' } },
      { k: 'local.tool', t: 'create_directory', label: 'Create Folder', icon: FolderPlus, args: { path: '' } },
      { k: 'local.tool', t: 'move_file', label: 'Move File', icon: Package, args: { src: '', dest: '' } },
      { k: 'local.tool', t: 'run_command', label: 'Run Command', icon: Terminal, args: { command: 'echo hello' } },
      { k: 'local.tool', t: 'launch_application_or_uri', label: 'Launch App/URL', icon: Rocket, args: { target: '' } },
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
    id: 'windows',
    label: 'Windows',
    icon: AppWindow,
    color: 'sky',
    items: [
      { k: 'local.tool', t: 'list_open_windows', label: 'List Windows', icon: List, args: {} },
      { k: 'local.tool', t: 'bring_window_to_foreground', label: 'Focus Window', icon: AppWindow, args: { title: '' } },
      { k: 'local.tool', t: 'smart_bring_window_to_foreground', label: 'Smart Focus', icon: Wand2, args: { hint: '' } },
    ],
  },
  {
    id: 'ui',
    label: 'Custom UI',
    icon: Layout,
    color: 'violet',
    items: [
      { k: 'local.tool', t: 'custom_ui', label: 'Show UI', icon: AppWindow, args: { title: 'My UI', html: '<div class="overlay-container"><h2>Hello</h2></div>', window: { width: 300, height: 200, position: 'center', borderRadius: 12 } } },
      { k: 'local.tool', t: 'update_custom_ui', label: 'Update UI', icon: AppWindow, args: { id: '', data: {}, html: '' } },
      { k: 'local.tool', t: 'close_custom_ui', label: 'Close UI', icon: X, args: { id: '' } },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Vision',
    icon: Eye,
    color: 'fuchsia',
    items: [
      { k: 'cloud.tool', t: 'analyze_current_screen', label: 'Analyze Screen', icon: Eye, args: {} },
      { k: 'cloud.tool', t: 'analyze_image', label: 'Analyze Image', icon: Eye, args: { path: '' } },
      { k: 'cloud.tool', t: 'analyze_media', label: 'Transcribe Audio', icon: Mic, args: { sources: [{ path: '' }], task: 'transcribe' } },
      { k: 'cloud.tool', t: 'cloud_ai_vision', label: 'AI Vision (JSON)', icon: Eye, args: { prompt: '', imagePath: '' } },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Link2,
    color: 'teal',
    items: [
      { k: 'cloud.tool', t: 'gmail_send_message', label: 'Gmail Send', icon: Mail, args: { to: [], subject: '', body: '', contentType: 'text/plain' } },
      { k: 'cloud.tool', t: 'drive_list_files', label: 'Google Drive List', icon: Database, args: { q: '', pageSize: 20 } },
      { k: 'cloud.tool', t: 'calendar_list_events', label: 'Calendar Events', icon: Calendar, args: { calendarId: 'primary', maxResults: 10 } },
      { k: 'cloud.tool', t: 'sheets_read_range', label: 'Read Sheet', icon: FileSpreadsheet, args: { spreadsheetId: '', range: 'Sheet1!A1:B10' } },
      { k: 'cloud.tool', t: 'outlook_send_mail', label: 'Outlook Send', icon: Mail, args: { to: [], subject: '', body: '', contentType: 'Text' } },
      { k: 'cloud.tool', t: 'github_list_repos', label: 'List Repos', icon: GitMerge, args: { visibility: 'all' } },
      { k: 'cloud.tool', t: 'github_list_issues', label: 'List Issues', icon: GitMerge, args: { owner: '', repo: '', state: 'open' } },
      { k: 'cloud.tool', t: 'github_create_issue', label: 'Create Issue', icon: GitMerge, args: { owner: '', repo: '', title: '', body: '' } },
    ],
  },
];

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
