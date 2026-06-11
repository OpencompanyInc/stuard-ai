// Maps a tool call name to the brand/category it belongs to. Used by the
// compact-mode status pill to show which integrations and capabilities are
// currently in flight instead of a single generic "AI working" spinner.
//
// Brands fall into two buckets:
//   1. Real integrations with a multi-color brand SVG (Gmail, GitHub, …)
//   2. Generic capability categories (web search, files, terminal, …) that
//      get a tinted lucide icon as a stand-in.

import type { LucideIcon } from 'lucide-react';
import {
  Bluetooth,
  Bot,
  Calendar,
  Camera,
  Clipboard,
  Clock,
  Cloud,
  Database,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Link as LinkIcon,
  MapPin,
  Monitor,
  MousePointer,
  Network,
  Search,
  Sparkles,
  Terminal,
  Volume2,
  Webhook,
  Workflow,
  Zap,
  BarChart3,
  ScanFace,
} from 'lucide-react';

import discordLogo from '../assets/integrations/Discord.svg';
import elevenLabsLogo from '../assets/integrations/ElevenLabs.svg';
import ffmpegLogo from '../assets/integrations/FFmpeg.svg';
import facebookLogo from '../assets/integrations/Facebook.svg';
import githubLogo from '../assets/integrations/GitHub.svg';
import gmailLogo from '../assets/integrations/Gmail.svg';
import googleCalendarLogo from '../assets/integrations/GoogleCalendar.svg';
import googleDocsLogo from '../assets/integrations/GoogleDocs.svg';
import googleDriveLogo from '../assets/integrations/GoogleDrive.svg';
import googleSheetsLogo from '../assets/integrations/GoogleSheets.svg';
import googleTasksLogo from '../assets/integrations/GoogleTasks.svg';
import instagramLogo from '../assets/integrations/Instagram.svg';
import ollamaLogo from '../assets/integrations/Ollama.svg';
import outlookLogo from '../assets/integrations/Outlook.png';
import pythonLogo from '../assets/integrations/Python.svg';
import redditLogo from '../assets/integrations/Reddit.svg';
import supabaseLogo from '../assets/integrations/Supabase.svg';
import threadsLogo from '../assets/integrations/Threads.svg';
import whatsappLogo from '../assets/integrations/WhatsApp.svg';
import xLogo from '../assets/integrations/X.svg';
import youtubeLogo from '../assets/integrations/YouTube.svg';
import { getIntegrationBranding } from '../../../../../shared/integration-branding';

export interface ToolBrand {
  key: string;
  label: string;
  /** Brand SVG/PNG URL (preferred — multi-color marks). */
  logo?: string;
  /**
   * Use the live favicon (via integrationLogoSources) as the mark — same source
   * Connected Apps uses for brands we don't bundle a vector for (Notion, Maps…).
   * `icon` stays as the offline/error fallback.
   */
  useRemote?: boolean;
  /** Lucide fallback for generic capability categories. */
  icon?: LucideIcon;
  /** Tint color applied to the lucide icon. */
  color?: string;
}

const BRANDS: Record<string, ToolBrand> = {
  // ── Integrations (brand SVGs) ──────────────────────────────────────────────
  gmail: { key: 'gmail', label: 'Gmail', logo: gmailLogo },
  drive: { key: 'drive', label: 'Drive', logo: googleDriveLogo },
  calendar: { key: 'calendar', label: 'Calendar', logo: googleCalendarLogo },
  docs: { key: 'docs', label: 'Docs', logo: googleDocsLogo },
  sheets: { key: 'sheets', label: 'Sheets', logo: googleSheetsLogo },
  tasks: { key: 'tasks', label: 'Tasks', logo: googleTasksLogo },
  github: { key: 'github', label: 'GitHub', logo: githubLogo },
  discord: { key: 'discord', label: 'Discord', logo: discordLogo },
  reddit: { key: 'reddit', label: 'Reddit', logo: redditLogo },
  x: { key: 'x', label: 'X', logo: xLogo },
  facebook: { key: 'facebook', label: 'Facebook', logo: facebookLogo },
  instagram: { key: 'instagram', label: 'Instagram', logo: instagramLogo },
  threads: { key: 'threads', label: 'Threads', logo: threadsLogo },
  outlook: { key: 'outlook', label: 'Outlook', logo: outlookLogo },
  // No bundled vector — use the live notion.so favicon, exactly like Connected Apps.
  notion: { key: 'notion', label: 'Notion', useRemote: true },
  youtube: { key: 'youtube', label: 'YouTube', logo: youtubeLogo },
  whatsapp: { key: 'whatsapp', label: 'WhatsApp', logo: whatsappLogo },
  python: { key: 'python', label: getIntegrationBranding('python')?.shortLabel ?? 'Scripts', logo: pythonLogo },
  ffmpeg: { key: 'ffmpeg', label: getIntegrationBranding('ffmpeg')?.shortLabel ?? 'Media', logo: ffmpegLogo },
  mediapipe: { key: 'mediapipe', label: getIntegrationBranding('mediapipe')?.shortLabel ?? 'Vision', icon: ScanFace, color: '#F472B6' },
  data_analysis: { key: 'data_analysis', label: getIntegrationBranding('data-analysis')?.shortLabel ?? 'Charts', icon: BarChart3, color: '#60A5FA' },
  ollama: { key: 'ollama', label: getIntegrationBranding('ollama')?.shortLabel ?? 'Local AI', logo: ollamaLogo },
  supabase: { key: 'supabase', label: 'Supabase', logo: supabaseLogo },
  elevenlabs: { key: 'elevenlabs', label: 'Voice', logo: elevenLabsLogo },

  // ── System / capability categories (lucide icons) ──────────────────────────
  browser: { key: 'browser', label: 'Browser', icon: Globe, color: '#60A5FA' },
  // Live Google Maps favicon (maps.google.com); MapPin is the offline fallback.
  maps: { key: 'maps', label: 'Maps', useRemote: true, icon: MapPin, color: '#EA4335' },
  search: { key: 'search', label: 'Web search', icon: Search, color: '#E5E7EB' },
  scrape: { key: 'scrape', label: 'Web scrape', icon: LinkIcon, color: '#22D3EE' },
  http: { key: 'http', label: 'HTTP request', icon: Network, color: '#22D3EE' },
  files: { key: 'files', label: 'Files', icon: Folder, color: '#FCD34D' },
  document: { key: 'document', label: 'Document', icon: FileText, color: '#9CA3AF' },
  terminal: { key: 'terminal', label: 'Terminal', icon: Terminal, color: '#34D399' },
  capture: { key: 'capture', label: 'Capture', icon: Camera, color: '#F472B6' },
  database: { key: 'database', label: 'Database', icon: Database, color: '#A78BFA' },
  storage: { key: 'storage', label: 'Cloud storage', icon: Cloud, color: '#60A5FA' },
  ai: { key: 'ai', label: 'AI inference', icon: Sparkles, color: '#A78BFA' },
  agent: { key: 'agent', label: 'Agent', icon: Bot, color: '#A78BFA' },
  image: { key: 'image', label: 'Image', icon: ImageIcon, color: '#F472B6' },
  audio: { key: 'audio', label: 'Audio', icon: Volume2, color: '#F472B6' },
  webhook: { key: 'webhook', label: 'Webhook', icon: Webhook, color: '#22D3EE' },
  desktop: { key: 'desktop', label: 'Desktop control', icon: MousePointer, color: '#FBBF24' },
  system: { key: 'system', label: 'System', icon: Monitor, color: '#9CA3AF' },
  bluetooth: { key: 'bluetooth', label: 'Bluetooth', icon: Bluetooth, color: '#60A5FA' },
  clipboard: { key: 'clipboard', label: 'Clipboard', icon: Clipboard, color: '#9CA3AF' },
  time: { key: 'time', label: 'Time', icon: Clock, color: '#9CA3AF' },
  workflow: { key: 'workflow', label: 'Workflow', icon: Workflow, color: '#A78BFA' },
  zap: { key: 'zap', label: 'Action', icon: Zap, color: '#FBBF24' },
};

// Meta-tool wrappers carry the *real* tool name in their arguments. `execute_tool`
// (orchestrator) puts it in `tool_name`; `vm_execute_tool` puts it in `tool`.
// Without unwrapping, anything routed through these wrappers (e.g. the Maps
// tools the orchestrator reaches via execute_tool) would brand as the generic
// wrapper and show no logo.
const WRAPPER_TOOLS = new Set(['execute_tool', 'vm_execute_tool']);

function unwrapInnerToolName(args: Record<string, any> | null | undefined): string | null {
  if (!args || typeof args !== 'object') return null;
  const candidate = args.tool_name ?? args.tool ?? args.vmTool ?? args.toolName ?? args.name;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

/**
 * Map a raw tool-call name (e.g. `browser_use_navigate`, `gmail_send`) to its
 * integration brand. Returns null for tools we don't know how to categorise so
 * callers can render a generic spinner fallback.
 *
 * Pass the call's `args` so wrapper tools (`execute_tool`, `vm_execute_tool`)
 * brand off the inner tool they actually run.
 */
export function toolToBrand(toolName: string, args?: Record<string, any> | null): ToolBrand | null {
  let name = (toolName || '').toLowerCase();
  if (!name) return null;

  // Unwrap meta-tool wrappers so the pill reflects the inner tool (Maps,
  // Notion, …). If the inner name can't be resolved, fall through with the
  // wrapper name (no brand → generic spinner, same as before).
  if (WRAPPER_TOOLS.has(name)) {
    const inner = unwrapInnerToolName(args);
    if (inner) name = inner.toLowerCase();
  }

  // ── Brand integrations ─────────────────────────────────────────────────────
  if (name.startsWith('browser_use_') || name.startsWith('browser_')) return BRANDS.browser;
  if (name.startsWith('gmail_') || name === 'send_email' || name.startsWith('google_send_mail')) return BRANDS.gmail;
  if (name.startsWith('drive_') || name.startsWith('google_drive_')) return BRANDS.drive;
  if (name.startsWith('calendar_') || name.startsWith('google_calendar_')) return BRANDS.calendar;
  if (name.startsWith('docs_') || name.startsWith('google_docs_')) return BRANDS.docs;
  if (name.startsWith('sheets_') || name.startsWith('google_sheets_')) return BRANDS.sheets;
  if (name.startsWith('tasks_') || name.startsWith('google_tasks_')) return BRANDS.tasks;
  if (name.startsWith('github_') || name.startsWith('gh_')) return BRANDS.github;
  if (name.startsWith('discord_')) return BRANDS.discord;
  if (name.startsWith('reddit_')) return BRANDS.reddit;
  if (name === 'x' || name.startsWith('x_') || name.startsWith('twitter_')) return BRANDS.x;
  if (name.startsWith('facebook_') || name.startsWith('fb_')) return BRANDS.facebook;
  if (name.startsWith('instagram_') || name.startsWith('ig_')) return BRANDS.instagram;
  if (name.startsWith('threads_')) return BRANDS.threads;
  if (name.startsWith('outlook_')) return BRANDS.outlook;
  if (name.startsWith('notion_')) return BRANDS.notion;
  if (name.startsWith('youtube_') || name.startsWith('yt_')) return BRANDS.youtube;
  if (name.startsWith('whatsapp_') || name.startsWith('wa_')) return BRANDS.whatsapp;
  if (name.startsWith('telnyx_')) return BRANDS.whatsapp; // SMS/voice share comms tile
  if (name.startsWith('maps_')) return BRANDS.maps;
  if (name.startsWith('python_') || name === 'run_python_script' || name === 'pip_install') return BRANDS.python;
  if (name.startsWith('ffmpeg_') || name === 'transcode' || name === 'extract_audio') return BRANDS.ffmpeg;
  if (name.startsWith('mediapipe_')) return BRANDS.mediapipe;
  if (name.startsWith('data_analysis_') || name.startsWith('plot_') || name === 'data_load'
    || name === 'describe_data' || name === 'correlate_data' || name === 'run_data_python') return BRANDS.data_analysis;
  if (name.startsWith('ollama_')) return BRANDS.ollama;
  if (name.startsWith('supabase_')) return BRANDS.supabase;
  if (name.startsWith('elevenlabs_') || name.startsWith('tts_')) return BRANDS.elevenlabs;
  if (name.startsWith('slack_')) return BRANDS.slack;
  if (name.startsWith('meet_') || name.startsWith('google_meet_')) return BRANDS.meet;

  // ── System / capability categories ─────────────────────────────────────────
  if (name === 'web_search' || name === 'search' || name.endsWith('_search')) return BRANDS.search;
  if (name === 'scrape_url' || name.startsWith('scrape_') || name === 'fetch_url' || name === 'web_fetch') return BRANDS.scrape;
  if (name === 'http_request' || name.startsWith('http_')) return BRANDS.http;
  if (name === 'webhook' || name.startsWith('webhook_')) return BRANDS.webhook;

  if (name.startsWith('db_')) return BRANDS.database;
  if (name.startsWith('cloud_storage_')) return BRANDS.storage;

  if (name === 'read_file' || name === 'write_file' || name === 'list_directory'
    || name === 'create_directory' || name === 'move_file' || name === 'copy_file'
    || name === 'delete_file' || name === 'file_exists' || name.startsWith('file_')) return BRANDS.files;

  if (name === 'run_command' || name === 'run_shell' || name === 'run_node_script'
    || name === 'terminal' || name.startsWith('terminal_') || name === 'exec') return BRANDS.terminal;

  if (name.startsWith('capture_') || name === 'screenshot') return BRANDS.capture;

  if (name === 'ai_inference' || name === 'llm_call' || name.startsWith('llm_')) return BRANDS.ai;
  if (name === 'agent_node' || name === 'call_workflow' || name === 'call_function'
    || name === 'call_workspace_function') return BRANDS.workflow;

  if (name === 'generate_image' || name.startsWith('image_')) return BRANDS.image;
  if (name === 'list_tts_voices' || name.startsWith('audio_') || name === 'capture_system_audio') return BRANDS.audio;

  if (name === 'click_at_coordinates' || name === 'double_click_at_coordinates'
    || name === 'type_text' || name === 'keystroke' || name === 'move_cursor'
    || name === 'drag_and_drop' || name === 'find_and_click_text' || name === 'find_text') return BRANDS.desktop;

  if (name === 'list_open_windows' || name === 'bring_window_to_foreground'
    || name === 'app_start' || name === 'get_desktop_wallpaper' || name === 'get_display_brightness') return BRANDS.system;

  if (name === 'connect_bluetooth_device' || name === 'disconnect_bluetooth_device'
    || name === 'list_bluetooth_devices') return BRANDS.bluetooth;

  if (name === 'get_clipboard_content' || name.startsWith('clipboard_')) return BRANDS.clipboard;
  if (name === 'get_datetime' || name === 'wait' || name === 'sleep') return BRANDS.time;

  return null;
}

/**
 * Reduce a list of tool calls to the unique integration brands they touch,
 * preserving first-seen order. Useful for rendering a horizontal stack of
 * brand logos without duplicates when multiple calls of the same integration
 * fire in parallel.
 */
export function uniqueBrands(toolCalls: readonly ToolCallLike[]): ToolBrand[] {
  const seen = new Set<string>();
  const out: ToolBrand[] = [];
  for (const tc of toolCalls) {
    const b = toolToBrand(tc.tool, tc.args);
    if (!b) continue;
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    out.push(b);
  }
  return out;
}

export interface ToolCallLike {
  id: string;
  tool: string;
  status: 'called' | 'running' | 'completed' | 'error';
  /** Raw tool args — used to unwrap wrapper tools (execute_tool, vm_execute_tool). */
  args?: Record<string, any> | null;
}

function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Last in-flight tool call, or the most recent call if none are active. */
export function getActiveToolCall(
  toolCalls: readonly ToolCallLike[] | undefined,
): ToolCallLike | null {
  if (!toolCalls?.length) return null;
  const inFlight = toolCalls.filter((t) => t.status === 'running' || t.status === 'called');
  return inFlight[inFlight.length - 1] ?? toolCalls[toolCalls.length - 1] ?? null;
}

export function getActiveBrandKey(toolCalls: readonly ToolCallLike[] | undefined): string | null {
  const active = getActiveToolCall(toolCalls);
  if (!active) return null;
  return toolToBrand(active.tool, active.args)?.key ?? null;
}

/** Label for the in-flight tool, e.g. "Using Slack…" */
export function usingToolStatusText(toolCalls: readonly ToolCallLike[] | undefined): string | null {
  if (!toolCalls?.length) return null;
  const hasInFlight = toolCalls.some((t) => t.status === 'running' || t.status === 'called');
  if (!hasInFlight) return null;
  const active = getActiveToolCall(toolCalls);
  if (!active) return null;
  const brand = toolToBrand(active.tool, active.args);
  const label = brand?.label || humanizeToolName(active.tool);
  return `Using ${label}\u2026`;
}

export function hasInFlightToolCalls(toolCalls: readonly ToolCallLike[] | undefined): boolean {
  return !!toolCalls?.some((t) => t.status === 'running' || t.status === 'called');
}
