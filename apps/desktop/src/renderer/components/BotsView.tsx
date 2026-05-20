import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  Play, Pause, Plus, ChevronLeft, ChevronRight, ChevronsUpDown,
  Loader2, Settings2, Activity, Brain, Trash2, Cloud, Monitor,
  Sparkles, Terminal, ListTodo, Clock, Calendar, Link as LinkIcon,
  Mail, Hand, Copy, Check, Zap, AlertCircle, X, Wrench, Search,
  Maximize2, LayoutGrid,
} from 'lucide-react';
import { KanbanTab } from './bots/KanbanTab';
import { supabase } from '../lib/supabaseClient';
import { getCloudAiHttp } from '../utils/cloud';
import {
  SCHEDULE_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
  PROACTIVE_MODEL_MODE_LABELS,
  EXECUTION_TARGET_LABELS,
  type ScheduleInterval,
  type ExecutionTarget,
  type NotificationChannel,
  type ProactiveModelMode,
} from '../types/proactive';

// ─── Types (mirror main-process Bot/BotConfig) ─────────────────────────────

type BotStatus = 'paused' | 'running' | 'errored';

interface BotConfig {
  interval: ScheduleInterval;
  executionTarget: ExecutionTarget;
  modelMode: ProactiveModelMode;
  modelId?: string;
  instructions: string;
  contextPermissions: { screenshot: boolean; systemAudio: boolean; micAudio: boolean };
  allowedTools: string[];
  notificationChannels: NotificationChannel[];
  memoryEnabled: boolean;
  /** Per-bot skill subset. undefined = inherit all globally-active skills. */
  skillIds?: string[];
}

type BotTriggerType = 'schedule.interval' | 'schedule.cron' | 'webhook' | 'gmail.new_email' | 'manual';

interface BotTrigger {
  id: string;
  type: BotTriggerType;
  args: Record<string, any>;
  enabled?: boolean;
  label?: string;
  requiresCloud?: boolean;
}

interface Bot {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  storedFacts: string;
  triggers: BotTrigger[];
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  vmDeployedAt?: string | null;
  isLegacyDefault?: boolean;
  config?: BotConfig;
}

interface VmBotRuntime {
  id: string;
  name?: string;
  status?: BotStatus;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: 'success' | 'partial' | 'failed';
  lastError?: string;
  isRunning?: boolean;
}

const COMMON_EMOJIS = ['🤖', '✨', '📊', '📰', '🐦', '📸', '🛒', '💼', '🎯', '🧠', '⚡', '🔔', '📅', '💡', '🎨', '📝'];

// ─── Helpers ───────────────────────────────────────────────────────────────

interface BotBlueprint {
  name: string;
  emoji: string;
  description?: string;
  systemPrompt: string;
  instructions: string;
  allowedTools: string[];
  interval: ScheduleInterval;
  toolRationale?: Array<{ tool: string; reason: string }>;
}

const BOT_TOOL_RULES: Array<{ keywords: string[]; tools: string[]; emojiIndex?: number }> = [
  { keywords: ['twitter', 'tweet', 'tweets', 'x post', 'x/twitter'], tools: ['x_post_tweet', 'x_search_tweets', 'x_get_user_timeline', 'x_get_user', 'web_search'], emojiIndex: 4 },
  // Gmail read/search/get tools disabled pending Google CASA verification; only send remains.
  { keywords: ['email', 'gmail', 'inbox', 'newsletter'], tools: ['gmail_send_message'], emojiIndex: 12 },
  { keywords: ['calendar', 'meeting', 'schedule', 'appointment'], tools: ['calendar_list_events', 'calendar_create_event', 'calendar_update_event', 'get_datetime'], emojiIndex: 12 },
  { keywords: ['github', 'issue', 'pull request', 'pr ', 'repo', 'repository'], tools: ['github_search_issues', 'github_create_issue', 'github_list_pull_requests', 'github_get_pull_request', 'github_comment_on_issue'], emojiIndex: 7 },
  { keywords: ['file', 'folder', 'document', 'docs', 'workspace', 'notes'], tools: ['file_search', 'semantic_file_search', 'read_file', 'write_file', 'file_edit', 'list_directory'], emojiIndex: 15 },
  { keywords: ['browser', 'website', 'web page', 'scrape', 'page', 'site'], tools: ['browser_use_navigate', 'browser_use_content', 'browser_use_get_interactive_elements', 'browser_use_click', 'scrape_url', 'web_search'], emojiIndex: 10 },
  { keywords: ['research', 'monitor', 'news', 'market', 'competitor', 'price'], tools: ['web_search', 'scrape_url', 'search_past_conversations'], emojiIndex: 3 },
  { keywords: ['sheet', 'spreadsheet', 'csv', 'data'], tools: ['sheets_read_sheet', 'sheets_update_values', 'sheets_append_values', 'read_file', 'write_file'], emojiIndex: 2 },
  { keywords: ['discord'], tools: ['discord_send_message', 'discord_list_channels', 'discord_get_messages'], emojiIndex: 10 },
  { keywords: ['reddit', 'subreddit'], tools: ['reddit_search_posts', 'reddit_get_subreddit_posts', 'reddit_create_post', 'reddit_comment_on_post'], emojiIndex: 3 },
  { keywords: ['sms', 'text message', 'phone'], tools: ['telnyx_send_sms', 'telnyx_list_messages'], emojiIndex: 11 },
];

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function humanizeToolName(name: string): string {
  if (!name) return '';
  const stripped = name.replace(/^(gmail|google|github|slack|notion|linear|discord|twitter|reddit|browser)[._]/i, (m) => `${m.replace(/[._]$/, '')} `);
  return stripped
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function humanizeModelName(id: string): string {
  if (!id) return '';
  const slash = id.lastIndexOf('/');
  const raw = slash >= 0 ? id.slice(slash + 1) : id;
  return raw
    .split('-')
    .filter(Boolean)
    .map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => {
    const key = keyword.trim().toLowerCase();
    if (!key) return false;
    if (key.length <= 2) return new RegExp(`(^|\\W)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(text);
    return text.includes(key);
  });
}

function titleFromGoal(goal: string): string {
  const cleaned = compactWhitespace(goal)
    .replace(/^(create|make|build|set up|setup|add)\s+(a|an)?\s*/i, '')
    .replace(/\b(bot|agent)\b/gi, '')
    .trim();
  const words = (cleaned || 'Assistant').split(/\s+/).slice(0, 4);
  const title = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return title.endsWith('Agent') ? title : `${title} Agent`;
}

function inferInterval(goal: string): ScheduleInterval {
  const text = goal.toLowerCase();
  if (hasAnyKeyword(text, ['manual', 'on demand', 'when i ask'])) return 'manual';
  if (hasAnyKeyword(text, ['urgent', 'live', 'asap', 'realtime', 'real-time'])) return '10m';
  if (hasAnyKeyword(text, ['often', 'frequent', 'watch', 'monitor'])) return '15m';
  if (hasAnyKeyword(text, ['daily', 'morning', 'evening', 'weekly'])) return '2h';
  return '30m';
}

function pickBlueprintTools(goal: string, availableTools: string[]): { tools: string[]; emoji: string } {
  const text = goal.toLowerCase();
  const available = new Set(availableTools);
  const picked = new Set<string>();
  let emoji = COMMON_EMOJIS[0];

  for (const rule of BOT_TOOL_RULES) {
    if (!hasAnyKeyword(text, rule.keywords)) continue;
    if (typeof rule.emojiIndex === 'number') emoji = COMMON_EMOJIS[rule.emojiIndex] || emoji;
    for (const tool of rule.tools) {
      if (available.has(tool)) picked.add(tool);
    }
  }

  if (picked.size === 0) {
    for (const tool of ['web_search', 'scrape_url', 'search_past_conversations']) {
      if (available.has(tool)) picked.add(tool);
    }
  }

  return { tools: Array.from(picked).slice(0, 10), emoji };
}

function buildBotBlueprint(goal: string, availableTools: string[], preferredName?: string): BotBlueprint {
  const objective = compactWhitespace(goal) || 'Help with recurring work and notify me when action is useful.';
  const name = compactWhitespace(preferredName || '') || titleFromGoal(objective);
  const { tools, emoji } = pickBlueprintTools(objective, availableTools);
  const interval = inferInterval(objective);
  const systemPrompt = [
    `You are ${name}, a proactive background agent.`,
    '',
    'Objective:',
    `- ${objective}`,
    '',
    'Operating rules:',
    '- Review the trigger context and recent agent memory before acting.',
    '- Use granted tools to verify facts or complete actions before guessing.',
    '- Keep actions focused on the objective and avoid unrelated work.',
    '- Record useful durable findings in agent memory.',
    '- Notify the user only for completed work, decisions, risks, or useful findings.',
    '',
    'Success criteria:',
    '- The user can trust the agent to run with minimal babysitting.',
    '- Each run produces either a concrete result, a concise status update, or no notification when nothing changed.',
  ].join('\n');
  const instructions = [
    'At each wake-up, inspect the trigger payload, recent agent memory, and open tasks.',
    'Decide whether action is needed for the objective.',
    'Use the allowed tools to complete the next useful step, update memory/tasks when relevant, and send a concise app notification when there is something worth interrupting the user for.',
  ].join(' ');

  return { name, emoji, systemPrompt, instructions, allowedTools: tools, interval };
}

const INTERNAL_BOT_TOOLS = new Set([
  'search_tools',
  'get_tool_schema',
  'execute_tool',
  'get_skill_info',
  'choose_notification_channel',
  'write_session_summary',
  'search_past_conversations',
  'get_conversation_context',
]);

function isInternalBotTool(tool: string): boolean {
  return INTERNAL_BOT_TOOLS.has(tool)
    || tool.startsWith('proactive_task_')
    || tool.startsWith('bot_memory_');
}

function normalizeAiBlueprint(raw: any, goal: string, availableTools: string[], preferredName?: string): BotBlueprint {
  const fallback = buildBotBlueprint(goal, availableTools, preferredName);
  const available = new Set(availableTools);
  const canUseTool = (tool: string) => {
    if (!tool || isInternalBotTool(tool)) return false;
    if (tool.startsWith('browser_') && !tool.startsWith('browser_use_')) return false;
    return available.size === 0 || available.has(tool);
  };

  const tools: string[] = Array.isArray(raw?.allowedTools)
    ? Array.from(new Set<string>(raw.allowedTools.map((tool: any) => String(tool || '').trim()).filter(canUseTool))).slice(0, 12)
    : fallback.allowedTools;

  const interval = ['10m', '15m', '30m', '1h', '2h', 'random', 'manual'].includes(String(raw?.interval || ''))
    ? String(raw.interval) as ScheduleInterval
    : fallback.interval;

  const toolRationale = Array.isArray(raw?.toolRationale)
    ? raw.toolRationale
        .map((entry: any) => ({
          tool: String(entry?.tool || '').trim(),
          reason: compactWhitespace(String(entry?.reason || '')),
        }))
        .filter((entry: { tool: string; reason: string }) => canUseTool(entry.tool) && entry.reason)
        .slice(0, 12)
    : undefined;

  return {
    name: compactWhitespace(String(raw?.name || '')) || fallback.name,
    emoji: compactWhitespace(String(raw?.emoji || '')) || fallback.emoji,
    description: compactWhitespace(String(raw?.description || '')) || fallback.description,
    systemPrompt: String(raw?.systemPrompt || '').trim() || fallback.systemPrompt,
    instructions: compactWhitespace(String(raw?.instructions || '')) || fallback.instructions,
    allowedTools: tools.length > 0 ? tools : fallback.allowedTools,
    interval,
    toolRationale,
  };
}

export type BlueprintStreamEvent =
  | { type: 'start'; goal: string; model: string; availableToolCount: number }
  | { type: 'phase'; phase: 'generate' | 'repair' }
  | { type: 'tool_search.start'; query: string; category: string | null; limit: number; fallback?: boolean }
  | { type: 'tool_search.results'; query: string; tools: Array<{ name: string; description: string; category: string }>; fallback?: boolean }
  | { type: 'step'; finishReason: string | null; toolCalls: Array<{ tool: string; input: any }>; textPreview: string }
  | { type: 'blueprint'; blueprint: any; discoveredTools: Array<{ name: string; description: string; category: string }> }
  | { type: 'done' }
  | { type: 'error'; error: string; detail?: string };

async function streamBotBlueprintWithAi(
  goal: string,
  availableTools: string[],
  preferredName: string | undefined,
  onEvent: (event: BlueprintStreamEvent) => void,
): Promise<BotBlueprint> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const hasToken = Boolean(token);

  let response: Response;
  try {
    response = await fetch(`${getCloudAiHttp()}/inference/ai/bot-blueprint`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ goal, preferredName, availableTools }),
    });
  } catch (e: any) {
    const reason = e?.message || String(e || 'network_error');
    throw new Error(`network: ${reason}${hasToken ? '' : ' (no auth token)'}`);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`http ${response.status}: ${detail.slice(0, 200) || 'no_body'}${hasToken ? '' : ' (no auth token)'}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let blueprintEvent: Extract<BlueprintStreamEvent, { type: 'blueprint' }> | null = null;
  let errorEvent: Extract<BlueprintStreamEvent, { type: 'error' }> | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let event: BlueprintStreamEvent | null = null;
      try { event = JSON.parse(payload) as BlueprintStreamEvent; } catch { continue; }
      if (!event) continue;
      onEvent(event);
      if (event.type === 'blueprint') blueprintEvent = event;
      else if (event.type === 'error') errorEvent = event;
    }
  }

  if (errorEvent) throw new Error(errorEvent.error || 'bot_blueprint_failed');
  if (!blueprintEvent) throw new Error('stream_ended_without_blueprint');

  return normalizeAiBlueprint(blueprintEvent.blueprint, goal, availableTools, preferredName);
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function timeUntil(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Any moment';
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)}m`;
  return `${Math.round(diff / 3600_000 * 10) / 10}h`;
}

function padCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
}

function formatShortScheduleLabel(interval: ScheduleInterval): string {
  switch (interval) {
    case '10m': return '10 mins';
    case '15m': return '15 mins';
    case '30m': return '30 mins';
    case '1h': return '1 hour';
    case '2h': return '2 hours';
    case 'random': return 'Random';
    case 'manual': return 'Manual';
    default: return SCHEDULE_LABELS[interval];
  }
}

function formatDuration(startedAt: string, completedAt?: string | null): string | null {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt || Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatElapsedFrom(startedAt: string, at: string): string {
  const start = new Date(startedAt).getTime();
  const current = new Date(at).getTime();
  if (Number.isNaN(start) || Number.isNaN(current) || current < start) return '0s';
  const totalSeconds = Math.max(0, Math.round((current - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildLogPreview(log: any): string {
  if (log?.timedOut) return log.failureReason || 'Timed out';
  if (log?.status === 'running') {
    const history = Array.isArray(log.stageHistory) ? log.stageHistory : [];
    return history.length > 0 ? history[history.length - 1].label : 'Running...';
  }
  return log?.agentMessage?.slice(0, 140) || log?.partialResponse?.slice(0, 140) || log?.failureReason || 'No message';
}

// ─── Trigger metadata ──────────────────────────────────────────────────────

const TRIGGER_META: Record<BotTriggerType, { label: string; icon: any; tagline: string }> = {
  'schedule.interval': { label: 'On a schedule', icon: Clock, tagline: 'Wake every fixed interval (every 30m, 1h, …)' },
  'schedule.cron': { label: 'Cron expression', icon: Calendar, tagline: 'Custom cron — e.g. weekly Tuesday 9am' },
  'webhook': { label: 'Incoming webhook', icon: LinkIcon, tagline: 'Wake when a unique URL receives a POST' },
  'gmail.new_email': { label: 'New Gmail email', icon: Mail, tagline: 'Wake when a new email matches your filters' },
  'manual': { label: 'Manual only', icon: Hand, tagline: 'Wake only when you press Run Now' },
};

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every 5 min', expr: '*/5 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily at 9am', expr: '0 9 * * *' },
  { label: 'Weekly (Tue 9am)', expr: '0 9 * * 2' },
  { label: 'Monthly (1st 9am)', expr: '0 9 1 * *' },
];

function describeTrigger(t: BotTrigger): string {
  if (t.label) return t.label;
  switch (t.type) {
    case 'schedule.interval':
      return SCHEDULE_LABELS[(t.args?.every || '30m') as ScheduleInterval] || `Every ${t.args?.every}`;
    case 'schedule.cron': {
      const expr = String(t.args?.expr || '');
      const preset = CRON_PRESETS.find(p => p.expr === expr);
      return preset ? preset.label : `Cron: ${expr}`;
    }
    case 'webhook':
      return t.args?.lastFiredAt ? `Webhook · last fired ${timeAgo(t.args.lastFiredAt)}` : 'Webhook · waiting for first hit';
    case 'gmail.new_email': {
      const filters: string[] = [];
      if (t.args?.from) filters.push(`from ${t.args.from}`);
      if (t.args?.subjectContains) filters.push(`subject "${t.args.subjectContains}"`);
      return filters.length ? `Gmail · ${filters.join(', ')}` : 'Any new Gmail email';
    }
    case 'manual':
      return 'Run only when triggered manually';
  }
}

// ─── Shared layout primitives (mirrors ProactiveView) ──────────────────────

type BadgeTone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger';

function statusInfo(status: BotStatus): { dot: string; label: string; textColor: string; badgeTone: BadgeTone } {
  if (status === 'running') return { dot: 'bg-emerald-500', label: 'Running', textColor: 'text-emerald-400', badgeTone: 'success' };
  if (status === 'errored') return { dot: 'bg-rose-500', label: 'Errored', textColor: 'text-rose-400', badgeTone: 'danger' };
  return { dot: 'bg-zinc-400', label: 'Paused', textColor: 'text-theme-muted', badgeTone: 'neutral' };
}

function DashboardBadge({
  label,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: any;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold',
        tone === 'primary' && 'border-primary/25 bg-primary/10 text-primary',
        tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-300',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
        tone === 'danger' && 'border-red-500/20 bg-red-500/10 text-red-300',
        tone === 'neutral' && 'border-theme/10 bg-theme-card/70 text-theme-muted',
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span>{label}</span>
    </span>
  );
}

function StatCard({
  value,
  label,
  size = 'lg',
  className,
}: {
  value: React.ReactNode;
  label: string;
  size?: 'lg' | 'md';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-zinc-500/10 px-4 py-3.5 border border-theme/30 dark:border-transparent',
        className,
      )}
    >
      <div
        className={clsx(
          'font-semibold tracking-tight text-theme-fg leading-none truncate',
          size === 'lg' ? 'text-[22px]' : 'text-[15px]',
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-theme-muted">{label}</div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-theme-hover/60 px-3 py-1 text-[12px] font-medium text-theme-fg">
      {children}
    </span>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  align = 'right',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-theme-fg transition hover:bg-theme-hover/50"
      >
        <span>{current?.label ?? value}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-theme-muted" />
      </button>
      {open && (
        <div
          className={clsx(
            'absolute top-full mt-1 z-30 min-w-[170px] overflow-hidden rounded-xl border border-theme bg-theme-card shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={clsx(
                'block w-full px-3 py-2 text-left text-[13px] transition hover:bg-theme-hover/60',
                opt.value === value ? 'font-medium text-primary' : 'text-theme-fg',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-theme-fg">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-theme-muted">{description}</div>
        )}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0',
        checked ? 'bg-primary' : 'bg-theme-hover/60',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className={clsx(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 shadow-sm',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
      )} />
    </button>
  );
}

function ActivityCard({
  log,
  firedBy,
  onOpen,
}: {
  log: any;
  firedBy?: BotTrigger | null;
  onOpen: () => void;
}) {
  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 140)
    || log.partialResponse?.slice(0, 140)
    || log.failureReason
    || buildLogPreview(log);

  const formattedDate = (() => {
    const d = new Date(log.startedAt);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.getDate();
    const month = d.toLocaleString(undefined, { month: 'short' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${month}, ${time}`;
  })();

  const TriggerIcon = firedBy ? TRIGGER_META[firedBy.type]?.icon : Hand;
  const triggerLabel = firedBy ? (TRIGGER_META[firedBy.type]?.label || firedBy.type) : 'Manual';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative w-full rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-4 text-left shadow-sm transition hover:bg-theme-hover/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={clsx('text-[12px] font-medium', statusColor)}>{statusLabel}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-theme-hover/60 px-1.5 py-0.5 text-[10px] text-theme-muted">
            <TriggerIcon className="h-2.5 w-2.5" />
            {triggerLabel}
          </span>
        </div>
        <Maximize2 className="h-3.5 w-3.5 flex-none text-theme-muted/60 transition group-hover:text-theme-fg" />
      </div>
      <div className="mt-2 text-[14px] leading-6 text-theme-fg line-clamp-2">{title}</div>
      <div className="mt-2 text-[11px] text-theme-muted">{formattedDate}</div>
    </button>
  );
}

function TaskDetailModal({
  log,
  firedBy,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  log: any;
  firedBy?: BotTrigger | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      if (e.key === 'ArrowRight' && hasNext) onNext?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const isCompleted = log.status === 'completed';
  const isFailed = log.status === 'failed';
  const statusLabel = isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Running';
  const statusColor = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-amber-300';

  const d = new Date(log.startedAt);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateLabel = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  const duration = formatDuration(log.startedAt, log.completedAt);
  const title = log.agentMessage?.split(/\n+/)[0]?.slice(0, 200) || buildLogPreview(log);
  const body = log.agentMessage && log.agentMessage.split(/\n+/).slice(1).join('\n').trim();
  const stageHistory = Array.isArray(log.stageHistory) ? log.stageHistory : [];

  const TriggerIcon = firedBy ? TRIGGER_META[firedBy.type]?.icon : Hand;
  const triggerLabel = firedBy ? (TRIGGER_META[firedBy.type]?.label || firedBy.type) : 'Manual';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="relative w-full max-w-[520px] rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className={clsx('text-[12px] font-semibold', statusColor)}>{statusLabel}</span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-center leading-tight">
              <div className="text-[14px] font-medium text-theme-fg tabular-nums">{time}</div>
              <div className="text-[11px] text-theme-muted">{dateLabel}</div>
            </div>
            <button
              type="button"
              onClick={onNext}
              disabled={!hasNext}
              className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-theme-muted transition hover:bg-theme-hover/50 hover:text-theme-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 text-[14px] font-medium leading-6 text-theme-fg">{title}</div>
        {body && (
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-theme-fg/85">{body}</p>
        )}
        {log.failureReason && (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
            {log.failureReason}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <Pill>
            <TriggerIcon className="h-3 w-3" />
            {triggerLabel}
          </Pill>
          {log.executionTarget && <Pill>{EXECUTION_TARGET_LABELS[log.executionTarget as ExecutionTarget]?.label || log.executionTarget}</Pill>}
          {log.modelMode && <Pill>{PROACTIVE_MODEL_MODE_LABELS[log.modelMode as ProactiveModelMode]?.label || log.modelMode}</Pill>}
          {duration && <Pill>Execution Time: {duration}</Pill>}
        </div>

        {stageHistory.length > 0 && (
          <div className="mt-5">
            <div className="text-[13px] font-semibold text-theme-fg">Stages</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {stageHistory.map((stage: any, idx: number) => (
                <Pill key={`${stage.stage}_${idx}`}>
                  {stage.label} {formatElapsedFrom(log.startedAt, stage.at)}
                </Pill>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Top-level component (bot list) ────────────────────────────────────────

export type BotsViewScope = 'all' | 'vm';

interface BotsViewProps {
  /**
   * Filter the visible bots:
   * - `'all'` (default): every bot the user has, regardless of where it runs.
   * - `'vm'`: only bots that have been deployed to the cloud VM (used inside
   *   the Cloud Engine workspace where local-only desktop bots are hidden).
   */
  scope?: BotsViewScope;
}

export function BotsView({ scope = 'all' }: BotsViewProps = {}) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await window.desktopAPI.botsList();
      if (res?.ok && Array.isArray(res.bots)) setBots(res.bots);
    } catch (e) {
      console.error('Failed to list bots', e);
    }
  }, []);

  useEffect(() => {
    (async () => { await refresh(); setLoading(false); })();
  }, [refresh]);

  // Re-fetch every 10s so cards reflect status / next-run / last-run changes.
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const visibleBots = useMemo(
    () => (scope === 'vm' ? bots.filter(b => !!b.vmDeployedAt) : bots),
    [bots, scope],
  );

  const selectedBot = useMemo(() => bots.find(b => b.id === selectedBotId) || null, [bots, selectedBotId]);

  const handleDeleteFromList = useCallback(async (bot: Bot) => {
    if (!confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    const res = await window.desktopAPI.botsDelete(bot.id);
    if (res?.ok) {
      if (selectedBotId === bot.id) setSelectedBotId(null);
      await refresh();
    } else if (res?.error) {
      alert(res.error);
    }
  }, [refresh, selectedBotId]);

  const runningCount = visibleBots.filter(b => b.status === 'running').length;
  const erroredCount = visibleBots.filter(b => b.status === 'errored').length;
  const onVmCount = bots.filter(b => !!b.vmDeployedAt).length;
  const localOnlyCount = bots.filter(b => !b.vmDeployedAt).length;

  const isVmScope = scope === 'vm';
  const headerTitle = isVmScope ? 'Agents on VM' : 'Agents';
  const headerSubtitle = isVmScope
    ? 'Agents running 24/7 on your cloud VM — independent of whether your laptop is open.'
    : 'Build and deploy 24/7 agents — each with its own personality, tools, and memory.';

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-theme-muted">Loading agents…</span>
      </div>
    );
  }

  if (selectedBot) {
    return (
      <BotDetailView
        bot={selectedBot}
        onBack={() => setSelectedBotId(null)}
        onChange={refresh}
        scope={scope}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">{headerTitle}</h1>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
            {isVmScope ? (
              <Cloud className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            )}
            <span>{headerSubtitle}</span>
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 scrollbar-minimal">
        <div className="space-y-7">
          {/* Overview stats */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Overview</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatCard value={padCount(visibleBots.length)} label={isVmScope ? 'On VM' : 'Total Agents'} />
              <StatCard value={padCount(runningCount)} label="Running" />
              <StatCard
                value={padCount(isVmScope ? localOnlyCount : onVmCount)}
                label={isVmScope ? 'Local only' : 'On VM'}
              />
              <StatCard value={padCount(erroredCount)} label="Errored" />
            </div>
          </section>

          {/* Agents grid */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-theme-fg">{isVmScope ? 'Deployed to VM' : 'Agents'}</h2>
              <span className="text-[12px] text-theme-muted">
                {visibleBots.length} {isVmScope ? 'on VM' : 'total'}
              </span>
            </div>
            {visibleBots.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Cloud className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold text-theme-fg">
                    {isVmScope ? 'No agents on this VM yet' : 'No agents yet'}
                  </h3>
                  <p className="max-w-sm text-[12px] text-theme-muted">
                    {isVmScope
                      ? 'Open any agent and choose “Deploy to VM” so it keeps running even when your laptop is closed.'
                      : 'Create your first agent to put it to work in the background.'}
                  </p>
                </div>
                {!isVmScope && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="mt-1 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New Agent
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleBots.map(bot => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    onClick={() => setSelectedBotId(bot.id)}
                    onDelete={() => handleDeleteFromList(bot)}
                  />
                ))}
                {!isVmScope && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="flex min-h-[140px] items-center justify-center gap-2 rounded-2xl border border-dashed border-theme/40 bg-zinc-500/5 text-[13px] text-theme-muted transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  >
                    <Plus className="h-4 w-4" />
                    New Agent
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {createOpen && (
        <CreateBotModal
          onClose={() => setCreateOpen(false)}
          onCreated={async (newBot) => {
            setCreateOpen(false);
            await refresh();
            setSelectedBotId(newBot.id);
          }}
        />
      )}
    </div>
  );
}

// ─── Bot card ──────────────────────────────────────────────────────────────

function BotCard({ bot, onClick, onDelete }: { bot: Bot; onClick: () => void; onDelete?: () => void }) {
  const status = statusInfo(bot.status);
  const onVm = !!bot.vmDeployedAt;

  return (
    <div className="group relative rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 transition hover:bg-theme-hover/30">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col gap-3 p-5 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme-card text-xl shadow-sm">
              {bot.emoji || '🤖'}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-theme-fg">{bot.name}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
                <span className={clsx('font-medium', status.textColor)}>{status.label}</span>
                {bot.isLegacyDefault && (
                  <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">default</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pr-9">
            {onVm && <DashboardBadge label="On VM" tone="primary" icon={Cloud} />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Last run</div>
            <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">{timeAgo(bot.lastRunAt)}</div>
          </div>
          <div className="rounded-xl bg-theme-card px-3 py-2.5 shadow-sm">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-theme-muted/70">Next in</div>
            <div className="mt-1 truncate text-[13px] font-semibold text-theme-fg">
              {bot.status === 'running' ? timeUntil(bot.nextRunAt) : '—'}
            </div>
          </div>
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 text-red-300 opacity-0 transition hover:bg-red-500/10 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
          title="Delete agent"
          aria-label={`Delete ${bot.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Create bot modal ──────────────────────────────────────────────────────

function CreateBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: (bot: Bot) => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🤖');
  const [goal, setGoal] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [interval, setInterval] = useState<ScheduleInterval>('30m');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateElapsed, setGenerateElapsed] = useState(0);
  const [generateStage, setGenerateStage] = useState('');
  const [progressEvents, setProgressEvents] = useState<Array<{ id: number; icon: 'search' | 'results' | 'step' | 'phase' | 'start' | 'done'; title: string; detail?: string; tools?: Array<{ name: string; category: string }>; at: number }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!generating) {
      setGenerateElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => setGenerateElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [generating]);

  const pushProgress = useCallback((entry: { icon: 'search' | 'results' | 'step' | 'phase' | 'start' | 'done'; title: string; detail?: string; tools?: Array<{ name: string; category: string }> }) => {
    setProgressEvents(prev => [...prev, { id: prev.length, ...entry, at: Date.now() }]);
  }, []);

  const handleStreamEvent = useCallback((event: BlueprintStreamEvent) => {
    if (event.type === 'start') {
      setGenerateStage('Connecting');
      pushProgress({
        icon: 'start',
        title: 'Connected',
        detail: humanizeModelName(event.model),
      });
    } else if (event.type === 'phase') {
      if (event.phase === 'generate') {
        setGenerateStage('Designing the agent');
        pushProgress({ icon: 'phase', title: 'Designing the agent' });
      } else {
        setGenerateStage('Refining the output');
        pushProgress({ icon: 'phase', title: 'Refining the output' });
      }
    } else if (event.type === 'tool_search.start') {
      const label = event.fallback ? 'Backup search' : 'Searching the catalog';
      setGenerateStage(label);
      pushProgress({
        icon: 'search',
        title: label,
        detail: event.query,
      });
    } else if (event.type === 'tool_search.results') {
      const count = event.tools.length;
      pushProgress({
        icon: 'results',
        title: count === 0 ? 'No matches' : `${count} match${count === 1 ? '' : 'es'}`,
        detail: event.query,
        tools: event.tools.map(t => ({ name: t.name, category: t.category })),
      });
    } else if (event.type === 'step') {
      const toolNames = event.toolCalls.map(c => c.tool).filter(Boolean);
      if (toolNames.length > 0) {
        pushProgress({
          icon: 'step',
          title: 'Looked up tools',
          detail: toolNames.map(humanizeToolName).join(', '),
        });
      } else {
        pushProgress({
          icon: 'step',
          title: 'Thinking',
          detail: event.textPreview || undefined,
        });
      }
    } else if (event.type === 'blueprint') {
      setGenerateStage('Finalizing');
      const count = event.blueprint?.allowedTools?.length || 0;
      pushProgress({
        icon: 'done',
        title: 'Setup ready',
        detail: count === 0 ? 'No extra tools needed' : `${count} tool${count === 1 ? '' : 's'} selected`,
      });
    }
  }, [pushProgress]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.desktopAPI.botsGetAvailableTools();
        if (!cancelled && res?.ok && Array.isArray(res.tools)) setAvailableTools(res.tools);
      } catch { /* keep creation usable without the tool registry */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const applyAutomaticSetup = useCallback(async () => {
    const seed = compactWhitespace(goal || systemPrompt || name);
    if (!seed) return;
    setGenerating(true);
    setGenerateError(null);
    setProgressEvents([]);
    setGenerateStage('Connecting');
    const startedAt = Date.now();
    console.info('[bot-blueprint] requesting', { seedLength: seed.length, tools: availableTools.length, name });
    try {
      let blueprint: BotBlueprint;
      try {
        blueprint = await streamBotBlueprintWithAi(seed, availableTools, name, handleStreamEvent);
        console.info(`[bot-blueprint] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`, {
          name: blueprint.name,
          allowedTools: blueprint.allowedTools.length,
          interval: blueprint.interval,
        });
      } catch (e: any) {
        const took = ((Date.now() - startedAt) / 1000).toFixed(1);
        const reason = e?.message || String(e || 'unknown error');
        console.warn(`[bot-blueprint] failed after ${took}s — using local fallback`, e);
        blueprint = buildBotBlueprint(seed, availableTools, name);
        setGenerateError(`Couldn't reach the AI (${reason}). Used a local setup after ${took}s instead.`);
      }
      setName(blueprint.name);
      setEmoji(blueprint.emoji);
      setSystemPrompt(blueprint.systemPrompt);
      setInstructions(blueprint.instructions);
      setSelectedTools(blueprint.allowedTools);
      setInterval(blueprint.interval);
    } finally {
      setGenerating(false);
    }
  }, [availableTools, goal, name, systemPrompt, handleStreamEvent]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const needsBlueprint = (!systemPrompt.trim() || !name.trim()) && compactWhitespace(goal || systemPrompt);
      let fallbackBlueprint: BotBlueprint | null = null;
      if (needsBlueprint) {
        const seed = compactWhitespace(goal || systemPrompt);
        try {
          fallbackBlueprint = await streamBotBlueprintWithAi(seed, availableTools, name, handleStreamEvent);
        } catch (e) {
          console.warn('AI bot blueprint generation failed during create; using local fallback', e);
          fallbackBlueprint = buildBotBlueprint(seed, availableTools, name);
        }
      }

      const finalName = compactWhitespace(name || fallbackBlueprint?.name || '');
      if (!finalName) return;
      const finalPrompt = systemPrompt.trim() || fallbackBlueprint?.systemPrompt || '';
      const finalInstructions = instructions.trim() || fallbackBlueprint?.instructions || '';
      const finalTools = selectedTools.length > 0 ? selectedTools : (fallbackBlueprint?.allowedTools || []);
      const finalInterval = fallbackBlueprint && selectedTools.length === 0 ? fallbackBlueprint.interval : interval;

      // New bots default to local. "Deploy to VM" is an explicit action in
      // the bot's Settings → Deployment section after creation.
      const res = await window.desktopAPI.botsCreate({
        name: finalName,
        emoji,
        systemPrompt: finalPrompt,
        config: {
          interval: finalInterval,
          executionTarget: 'local',
          modelMode: 'balanced',
          instructions: finalInstructions,
          allowedTools: finalTools,
          notificationChannels: ['app'],
          memoryEnabled: true,
        },
      });
      if (res?.ok && res.bot) onCreated(res.bot);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 scrollbar-minimal"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 className="font-stuard text-lg font-semibold text-theme-fg">New Agent</h2>
          <p className="mt-1 text-[12px] text-theme-muted">Describe the outcome, then generate a ready-to-run setup or tune it by hand.</p>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-theme-fg">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Automatic setup
              </label>
              <button
                type="button"
                onClick={applyAutomaticSetup}
                disabled={generating || !compactWhitespace(goal || systemPrompt || name)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generating ? `Generating · ${generateElapsed}s` : 'Generate'}
              </button>
            </div>
            <textarea
              rows={3}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="Watch GitHub issues for billing bugs, summarize what changed, and notify me when something needs a reply."
              className="w-full resize-none rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/70 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setToolPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg transition hover:bg-theme-hover"
              >
                <Wrench className="h-3 w-3" />
                Tools
              </button>
              <span className="text-[11px] text-theme-muted">
                {selectedTools.length === 0 ? 'Default agent tools only' : `${selectedTools.length} tool${selectedTools.length === 1 ? '' : 's'} selected`}
              </span>
              {selectedTools.slice(0, 4).map(tool => (
                <span
                  key={tool}
                  title={tool}
                  className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"
                >
                  {humanizeToolName(tool)}
                </span>
              ))}
              {selectedTools.length > 4 && (
                <span className="rounded-md bg-theme-hover px-2 py-1 text-[10px] text-theme-muted">
                  +{selectedTools.length - 4} more
                </span>
              )}
            </div>
            {generating && progressEvents.length === 0 && (
              <p className="mt-3 flex items-center gap-2 text-[11px] text-theme-muted">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span>{generateStage || 'Working'}</span>
                <span className="text-theme-muted/60">· {generateElapsed}s</span>
              </p>
            )}
            {progressEvents.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-xl border border-theme/40 bg-theme-card/60">
                <div className="flex items-center justify-between border-b border-theme/30 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-theme-fg">
                    {generating ? (
                      <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    ) : (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                    <span>{generating ? (generateStage || 'Working') : 'Setup ready'}</span>
                  </div>
                  <span className="text-[10px] tabular-nums text-theme-muted/70">{generateElapsed}s</span>
                </div>
                <ul className="max-h-56 space-y-0 overflow-y-auto scrollbar-minimal">
                  {progressEvents.map((event, idx) => {
                    const IconCmp =
                      event.icon === 'search' ? Search :
                      event.icon === 'results' ? Check :
                      event.icon === 'step' ? Brain :
                      event.icon === 'phase' ? Sparkles :
                      event.icon === 'done' ? Check :
                      Activity;
                    const iconTone =
                      event.icon === 'done' || event.icon === 'results'
                        ? 'text-emerald-400'
                        : 'text-primary';
                    return (
                      <li
                        key={event.id}
                        className={clsx(
                          'flex items-start gap-2.5 px-3 py-2 text-[11px]',
                          idx !== progressEvents.length - 1 && 'border-b border-theme/20',
                        )}
                      >
                        <span className={clsx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center', iconTone)}>
                          <IconCmp className="h-3 w-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-theme-fg">{event.title}</div>
                          {event.detail && (
                            <div className="mt-0.5 truncate text-theme-muted">{event.detail}</div>
                          )}
                          {event.tools && event.tools.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {event.tools.slice(0, 10).map(t => (
                                <span
                                  key={t.name}
                                  title={t.name}
                                  className="rounded-md border border-theme/40 bg-theme-card px-1.5 py-0.5 text-[10px] text-theme-fg"
                                >
                                  {humanizeToolName(t.name)}
                                </span>
                              ))}
                              {event.tools.length > 10 && (
                                <span className="rounded-md bg-theme-hover px-1.5 py-0.5 text-[10px] text-theme-muted">
                                  +{event.tools.length - 10} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {generateError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="flex-1">{generateError}</span>
              </div>
            )}
          </section>

          {/* Emoji + Name */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl transition hover:bg-zinc-500/20"
              onClick={() => {
                const idx = COMMON_EMOJIS.indexOf(emoji);
                setEmoji(COMMON_EMOJIS[(idx + 1) % COMMON_EMOJIS.length]);
              }}
              title="Click to cycle"
            >
              {emoji}
            </button>
            <input
              autoFocus
              type="text"
              placeholder="Twitter Update Agent"
              value={name}
              onChange={e => setName(e.target.value)}
              className="flex-1 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>

          {/* System prompt */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Structured objective</label>
            <textarea
              rows={6}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Posts a weekly product update to X every Tuesday at 9am. Keeps tone friendly and concise."
              className="w-full resize-none rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Run instructions</label>
            <textarea
              rows={3}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              placeholder="At each wake-up, check the latest context, use tools to complete the next useful step, update memory, and notify only when useful."
              className="w-full resize-none rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Default schedule</label>
            <select
              value={interval}
              onChange={e => setInterval(e.target.value as ScheduleInterval)}
              className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
            >
              {Object.entries(SCHEDULE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-theme-muted">You can add cron, webhook, and Gmail triggers after creating the agent.</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full px-4 py-2 text-[13px] font-medium text-theme-muted transition hover:text-theme-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!compactWhitespace(name || goal || systemPrompt) || submitting}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create Agent
          </button>
        </div>

        {toolPickerOpen && (
          <ToolsPickerModal
            available={availableTools}
            selected={selectedTools}
            onClose={() => setToolPickerOpen(false)}
            onApply={(next) => { setSelectedTools(next); setToolPickerOpen(false); }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Bot detail view (two-column, mirrors ProactiveView layout) ───────────

type DetailTab = 'activity' | 'kanban' | 'memory' | 'settings';

function BotDetailView({ bot, onBack, onChange, scope = 'all' }: { bot: Bot; onBack: () => void; onChange: () => Promise<void> | void; scope?: BotsViewScope }) {
  const [tab, setTab] = useState<DetailTab>('activity');
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [kanbanCards, setKanbanCards] = useState<any[]>([]);
  const [runLog, setRunLog] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [vmRuntime, setVmRuntime] = useState<VmBotRuntime | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const vmRunActive = scope === 'vm' && !!vmRuntime?.isRunning;
  const status = vmRunActive
    ? { dot: 'bg-amber-400', label: 'Running now', textColor: 'text-amber-300', badgeTone: 'warning' as BadgeTone }
    : statusInfo(bot.status);

  const reloadKanban = useCallback(async () => {
    const [cardsRes, logRes] = await Promise.all([
      window.desktopAPI.botsMemoryListCards(bot.id),
      window.desktopAPI.botsMemoryListRunLog(bot.id, 30),
    ]);
    if (cardsRes?.ok && Array.isArray(cardsRes.cards)) setKanbanCards(cardsRes.cards);
    if (logRes?.ok && Array.isArray(logRes.runLog)) setRunLog(logRes.runLog);
  }, [bot.id]);

  const loadVmRuntime = useCallback(async () => {
    if (scope !== 'vm' || !bot.vmDeployedAt) {
      setVmRuntime(null);
      return null;
    }
    const res = await window.desktopAPI.botsGetVmStatus?.(bot.id);
    if (res?.ok && res.bot) {
      setVmRuntime(res.bot as VmBotRuntime);
      return res.bot as VmBotRuntime;
    }
    return null;
  }, [bot.id, bot.vmDeployedAt, scope]);

  const reload = useCallback(async () => {
    const [cfgRes, tasksRes, logsRes] = await Promise.all([
      window.desktopAPI.botsGetConfig(bot.id),
      window.desktopAPI.botsListTasks(bot.id),
      window.desktopAPI.botsGetWakeUpLog(bot.id, 30),
    ]);
    if (cfgRes?.ok && cfgRes.config) setConfig(cfgRes.config);
    if (tasksRes?.ok && Array.isArray(tasksRes.tasks)) setTasks(tasksRes.tasks);
    if (logsRes?.ok && Array.isArray(logsRes.logs)) setLogs(logsRes.logs);
    await reloadKanban();
    await loadVmRuntime();
  }, [bot.id, reloadKanban, loadVmRuntime]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (scope !== 'vm' || !bot.vmDeployedAt) return;
    let lastSeenRunAt: string | null = null;
    const id = window.setInterval(async () => {
      const runtime = await loadVmRuntime();
      const isRunning = !!runtime?.isRunning;
      // Detect a freshly-completed run (lastRunAt changed since the previous
      // tick) so the activity tab picks up its run-log entry even when the
      // run finished between two polls.
      const runAt = runtime?.lastRunAt || null;
      const runChanged = !!runAt && runAt !== lastSeenRunAt;
      if (isRunning || running || runChanged) {
        await reloadKanban();
      }
      if (runAt) lastSeenRunAt = runAt;
    }, 2500);
    return () => window.clearInterval(id);
  }, [bot.vmDeployedAt, loadVmRuntime, reloadKanban, running, scope]);

  // Live-refresh the kanban when the bot (or the user) edits it from another
  // surface — e.g. a wake-up just appended a run-log entry, or another window
  // edited a card. The handler is bot-scoped so we don't repaint for siblings.
  useEffect(() => {
    const off = window.desktopAPI.onBotMemoryChanged?.(({ botId }) => {
      if (botId === bot.id) reloadKanban();
    });
    return () => { off?.(); };
  }, [bot.id, reloadKanban]);

  const handleToggleStatus = async () => {
    setSaving(true);
    try {
      const next = bot.status === 'running' ? 'paused' : 'running';
      await window.desktopAPI.botsSetStatus(bot.id, next);
      await onChange();
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setRunError(null);
    try {
      // Inside the Cloud Engine workspace (`scope === 'vm'`) we want a Run
      // click to fire the VM, not the desktop's local proactive-scheduler —
      // otherwise the user sees the run in their desktop logs even though
      // they're sitting in the VM tab. Fall back to local if the bot isn't
      // actually deployed (e.g. something was opened from a stale list).
      if (scope === 'vm' && bot.vmDeployedAt) {
        const res = await window.desktopAPI.botsTriggerOnVm(bot.id);
        if (!res?.ok) {
          if (res?.error === 'bot_not_deployed_to_vm') {
            // Stale UI — bot was undeployed underneath us. Fall back to local.
            await window.desktopAPI.botsTriggerNow(bot.id);
          } else {
            const reason = humanizeVmError(res?.error);
            console.warn('[bots] VM run failed:', res?.error);
            setRunError(reason);
          }
        } else {
          const now = new Date().toISOString();
          setVmRuntime((prev) => ({
            ...(prev || {}),
            id: bot.id,
            name: bot.name,
            status: 'running',
            isRunning: true,
            lastRunAt: now,
            nextRunAt: prev?.nextRunAt ?? bot.nextRunAt ?? null,
          }));
          window.setTimeout(() => { void loadVmRuntime(); }, 500);
          window.setTimeout(() => { void loadVmRuntime(); void reloadKanban(); }, 2500);
        }
      } else {
        await window.desktopAPI.botsTriggerNow(bot.id);
      }
      // Logs/tasks repopulate as the run progresses; refresh after a beat.
      setTimeout(() => { reload(); setRunning(false); }, 1500);
    } catch (e: any) {
      setRunError(String(e?.message || e || 'Run failed'));
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    const res = await window.desktopAPI.botsDelete(bot.id);
    if (res?.ok) {
      await onChange();
      onBack();
    } else if (res?.error) {
      alert(res.error);
    }
  };

  const updateBotField = async (patch: Partial<Bot>) => {
    setSaving(true);
    try {
      await window.desktopAPI.botsUpdate(bot.id, patch);
      await onChange();
    } finally {
      setSaving(false);
    }
  };

  const updateConfigField = async (patch: Partial<BotConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    setSaving(true);
    try {
      await window.desktopAPI.botsUpdateConfig(bot.id, patch);
    } finally {
      setSaving(false);
    }
  };

  // Map triggerId → trigger so we can label log entries with what fired them.
  const triggersById = useMemo(() => {
    const map = new Map<string, BotTrigger>();
    for (const t of bot.triggers) map.set(t.id, t);
    return map;
  }, [bot.triggers]);

  // Aside summary metrics (mirror Proactive's overview/config/focus brief).
  const modelMode = (config?.modelMode || 'balanced') as ProactiveModelMode;
  const modelModeMeta = PROACTIVE_MODEL_MODE_LABELS[modelMode];
  const executionTargetMeta = config ? EXECUTION_TARGET_LABELS[config.executionTarget] : EXECUTION_TARGET_LABELS.local;
  const triggerSummary = (() => {
    const enabled = bot.triggers.filter(t => t.enabled !== false);
    if (enabled.length === 0) return 'None';
    if (enabled.length > 1) return 'Multiple';
    const t = enabled[0];
    if (t.type === 'schedule.interval') {
      return formatShortScheduleLabel((t.args?.every || '30m') as ScheduleInterval);
    }
    if (t.type === 'schedule.cron') return 'Cron';
    if (t.type === 'webhook') return 'Webhook';
    if (t.type === 'gmail.new_email') return 'Gmail';
    return 'Manual';
  })();
  const nextRunValue = (() => {
    if (vmRunActive) return 'Running now';
    if (scope === 'vm' && vmRuntime?.nextRunAt) return formatClockTime(vmRuntime.nextRunAt);
    if (bot.status === 'errored') return 'Errored';
    if (bot.status !== 'running') return 'Paused';
    if (!bot.nextRunAt) return 'Waiting';
    return formatClockTime(bot.nextRunAt);
  })();

  // VM bots don't write to the local proactive-data.json — their wake-ups land
  // in the bot-memory runLog and their working kanban. Surface that data in
  // the Activity tab so VM runs are visible there, not just in Kanban.
  const isVmActivity = scope === 'vm' && !!bot.vmDeployedAt;
  const vmActivityLogs = useMemo(() => {
    if (!isVmActivity) return null;
    return runLog.map((entry: any) => ({
      id: entry.id,
      botId: bot.id,
      startedAt: entry.at,
      completedAt: entry.at,
      status: entry.outcome === 'failed' ? 'failed' : 'completed',
      agentMessage: entry.summary || '',
      failureReason: entry.outcome === 'failed' ? entry.notes : undefined,
      executionTarget: 'cloud' as const,
      contextUsed: [] as string[],
      tasksProcessed: Array.isArray(entry.cardIds) ? entry.cardIds : [],
    }));
  }, [isVmActivity, runLog, bot.id]);
  const vmActivityTasks = useMemo(() => {
    if (!isVmActivity) return null;
    return kanbanCards
      .filter((c: any) => c.status === 'queued' || c.status === 'in_progress')
      .map((c: any) => ({
        id: c.id,
        title: c.title,
        instructions: c.notes || '',
        status: c.status,
      }));
  }, [isVmActivity, kanbanCards]);
  const displayedTasks = vmActivityTasks ?? tasks;
  const displayedLogs = vmActivityLogs ?? logs;

  const selectedLogIndex = selectedLogId ? displayedLogs.findIndex((l: any) => l.id === selectedLogId) : -1;
  const selectedLog = selectedLogIndex >= 0 ? displayedLogs[selectedLogIndex] : null;
  const selectedLogTrigger = selectedLog?.triggerId ? triggersById.get(selectedLog.triggerId) || null : null;

  const activeKanbanCount = kanbanCards.filter(c => c.status === 'in_progress' || c.status === 'queued').length;
  const tabs: { id: DetailTab; label: string; icon: any; showCount?: boolean; count?: number }[] = [
    { id: 'activity', label: 'Activity', icon: Activity, showCount: true, count: displayedTasks.length },
    { id: 'kanban', label: 'Kanban', icon: LayoutGrid, showCount: true, count: activeKanbanCount },
    { id: 'memory', label: 'Memory', icon: Brain },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col animate-in fade-in duration-300">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-shrink-0 items-start justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-full p-1.5 text-theme-muted transition hover:bg-theme-hover/40 hover:text-theme-fg"
            title="Back to agents"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl">
            {bot.emoji}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-stuard text-[28px] font-semibold leading-none tracking-tight text-theme-fg">{bot.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-[13px] text-theme-muted">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              <span>
                {bot.isLegacyDefault
                  ? 'Default proactive agent — your always-on agent.'
                  : 'Configure how this agent wakes up, thinks, and remembers.'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <button
            onClick={handleRunNow}
            disabled={running || vmRunActive}
            className="inline-flex items-center gap-2 rounded-full border border-theme bg-theme-card px-4 py-2 text-[13px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running || vmRunActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Terminal className="h-3.5 w-3.5" />}
            {running || vmRunActive ? 'Running' : 'Run Now'}
          </button>
          <button
            onClick={handleToggleStatus}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {bot.status === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {bot.status === 'running' ? 'Pause' : 'Deploy'}
          </button>
        </div>
      </div>

      {runError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">Couldn’t run on your VM.</div>
            <div className="mt-0.5 text-red-300/80">{runError}</div>
          </div>
        </div>
      )}

      {/* ─── Body: two-column for most tabs, full-width for kanban ───── */}
      {/*
       * The Kanban tab is a horizontal board — it needs the full container
       * width to breathe. For everything else, the side aside (Overview /
       * Config / Focus Brief) gives quick context. On kanban, that context
       * collapses into a thin summary strip across the top so users still
       * see status at a glance without sacrificing card real-estate.
       */}
      <div className={clsx(
        'grid min-h-0 flex-1 gap-6 overflow-hidden',
        tab === 'kanban'
          ? 'grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]'
          : 'grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]',
      )}>
        {/* ── LEFT aside (hidden on kanban tab) ─────────────────── */}
        {(
          <aside className={clsx(
            'overflow-y-auto px-1 pb-2 scrollbar-minimal',
            tab === 'kanban' ? 'lg:order-2' : 'lg:order-1',
          )}>
            <div className="space-y-7">
              {/* Overview */}
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold text-theme-fg">Overview</h2>
                  <DashboardBadge label={status.label} tone={status.badgeTone} />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <StatCard
                    value={(nextRunValue || '').includes(':') ? nextRunValue.replace(':', ' : ') : nextRunValue}
                    label="Next Check-in"
                  />
                  <StatCard value={padCount(displayedTasks.length)} label="Active Tasks" />
                  <StatCard value={padCount(displayedLogs.length)} label="Total Runs" className="col-span-2 sm:col-span-1" />
                </div>
              </section>

              {/* Config */}
              <section>
                <h2 className="mb-3 text-[15px] font-semibold text-theme-fg">Config</h2>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCard size="md" value={executionTargetMeta.label} label={bot.vmDeployedAt ? 'VM + Local' : 'Executor'} />
                  <StatCard size="md" value={modelModeMeta.label} label="Intelligence" />
                  <StatCard size="md" value={triggerSummary} label="Trigger" />
                </div>
              </section>

              {/* Focus Brief */}
              {config && (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-theme-fg">Focus Brief</h2>
                    {saving && <span className="text-[11px] font-medium text-primary">Saving…</span>}
                  </div>
                  <div className="rounded-2xl border border-theme/30 dark:border-transparent bg-zinc-500/10 px-4 py-3.5">
                    <textarea
                      value={config.instructions || ''}
                      onChange={e => setConfig(prev => prev ? { ...prev, instructions: e.target.value } : prev)}
                      onBlur={() => updateConfigField({ instructions: config.instructions || '' })}
                      placeholder="Today: focus on the launch announcement."
                      rows={5}
                      className="min-h-[128px] w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
                    />
                  </div>
                </section>
              )}
            </div>
          </aside>
        )}

        {/* ── RIGHT/MAIN: Tabs + tab content ────────────────────── */}
        <main className={clsx(
          'flex min-h-0 flex-col overflow-hidden',
          tab === 'kanban' ? 'lg:order-1' : 'lg:order-2',
        )}>
          {/* Tabs */}
          <div className="mb-4 flex flex-shrink-0 items-center gap-2 p-0.5">
            {tabs.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-all',
                    active
                      ? 'border-primary bg-theme-card text-theme-fg shadow-sm ring-2 ring-primary/30'
                      : 'border-theme/40 dark:border-transparent bg-theme-card/40 text-theme-muted hover:bg-theme-card hover:text-theme-fg',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                  {t.showCount && (t.count ?? 0) > 0 && (
                    <span
                      className={clsx(
                        'ml-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold',
                        active ? 'bg-theme-fg text-theme-bg' : 'bg-theme-hover/80 text-theme-muted',
                      )}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 scrollbar-minimal">
            {tab === 'activity' && (
              <div className="animate-in fade-in duration-200">
                <ActivityTab
                  tasks={displayedTasks}
                  logs={displayedLogs}
                  triggersById={triggersById}
                  onSelectLog={(id) => setSelectedLogId(id)}
                  vmActivity={isVmActivity}
                />
              </div>
            )}
            {tab === 'kanban' && (
              <div className="animate-in fade-in duration-200">
                <KanbanTab
                  botId={bot.id}
                  cards={kanbanCards}
                  runLog={runLog}
                  onChanged={reloadKanban}
                />
              </div>
            )}
            {tab === 'memory' && (
              <div className="animate-in fade-in duration-200">
                <MemoryTab
                  bot={bot}
                  logs={logs}
                  onSaveFacts={(storedFacts) => updateBotField({ storedFacts })}
                  onToggleMemory={config ? (memoryEnabled) => updateConfigField({ memoryEnabled }) : undefined}
                  memoryEnabled={config?.memoryEnabled ?? true}
                />
              </div>
            )}
            {tab === 'settings' && config && (
              <div className="animate-in fade-in duration-200">
                <SettingsTab
                  bot={bot}
                  config={config}
                  onUpdateBot={updateBotField}
                  onUpdateConfig={updateConfigField}
                  onDelete={handleDelete}
                  onTriggersChanged={async () => { await onChange(); await reload(); }}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {selectedLog && (
        <TaskDetailModal
          log={selectedLog}
          firedBy={selectedLogTrigger}
          onClose={() => setSelectedLogId(null)}
          onPrev={selectedLogIndex > 0 ? () => setSelectedLogId(displayedLogs[selectedLogIndex - 1].id) : undefined}
          onNext={selectedLogIndex >= 0 && selectedLogIndex < displayedLogs.length - 1 ? () => setSelectedLogId(displayedLogs[selectedLogIndex + 1].id) : undefined}
          hasPrev={selectedLogIndex > 0}
          hasNext={selectedLogIndex >= 0 && selectedLogIndex < displayedLogs.length - 1}
        />
      )}
    </div>
  );
}

// ─── Activity tab ──────────────────────────────────────────────────────────

function ActivityTab({
  tasks,
  logs,
  triggersById,
  onSelectLog,
  vmActivity = false,
}: {
  tasks: any[];
  logs: any[];
  triggersById: Map<string, BotTrigger>;
  onSelectLog: (id: string) => void;
  /** True when this bot lives on the VM and we're surfacing kanban + run-log
   *  data here instead of the desktop's local proactive tasks/wake-up logs. */
  vmActivity?: boolean;
}) {
  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10">
      {/* Tasks */}
      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <ListTodo className="h-4 w-4" /> {vmActivity ? 'Active Cards' : 'Tasks'}
            <span className="text-[12px] font-normal text-theme-muted">({tasks.length})</span>
          </h3>
        </div>
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              {vmActivity
                ? 'No active kanban cards — the agent will add some as it works. See the Kanban tab for the full board.'
                : 'No tasks yet — the agent will create some when it runs.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.slice(0, 30).map(t => (
              <div key={t.id} className="rounded-lg border border-theme/30 dark:border-transparent bg-theme-card px-3.5 py-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-theme-fg">{t.title}</span>
                  <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    t.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300'
                    : t.status === 'failed' ? 'bg-red-500/10 text-red-300'
                    : t.status === 'in_progress' ? 'bg-amber-500/10 text-amber-300'
                    : 'bg-theme-card/70 text-theme-muted',
                  )}>{t.status}</span>
                </div>
                {t.instructions && <div className="mt-1 line-clamp-2 text-[11px] text-theme-muted">{t.instructions}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent runs */}
      <section className="border-t border-theme/30 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Activity className="h-4 w-4" /> Recent Runs
            <span className="text-[12px] font-normal text-theme-muted">({logs.length})</span>
          </h3>
        </div>
        {logs.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              No runs yet. Click "Run Now" or deploy the agent.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {logs.slice(0, 20).map(log => (
              <ActivityCard
                key={log.id}
                log={log}
                firedBy={log.triggerId ? triggersById.get(log.triggerId) : null}
                onOpen={() => onSelectLog(log.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Memory tab ────────────────────────────────────────────────────────────

function MemoryTab({
  bot,
  logs,
  onSaveFacts,
  onToggleMemory,
  memoryEnabled,
}: {
  bot: Bot;
  logs: any[];
  onSaveFacts: (facts: string) => Promise<void> | void;
  onToggleMemory?: (enabled: boolean) => void;
  memoryEnabled: boolean;
}) {
  const [facts, setFacts] = useState(bot.storedFacts || '');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Auto-save on blur to avoid spamming IPC.
  const handleBlur = async () => {
    if (facts === bot.storedFacts) return;
    await onSaveFacts(facts);
    setSavedAt(Date.now());
  };

  const summaries = useMemo(
    () => logs.filter(l => l.status === 'completed' && l.agentMessage).slice(0, 10),
    [logs],
  );

  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-6">
      {/* Memory toggle */}
      {onToggleMemory && (
        <ConfigRow
          label="Memory tool"
          description="Inject recent runs and facts into the agent's system prompt at runtime so it remembers across runs."
          control={<Toggle checked={memoryEnabled} onChange={onToggleMemory} />}
        />
      )}

      {/* Stored facts */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Brain className="h-4 w-4" /> Things to remember
          </h3>
          {savedAt && <span className="text-[11px] font-medium text-emerald-400">Saved</span>}
        </div>
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
          <textarea
            rows={6}
            value={facts}
            onChange={e => { setFacts(e.target.value); setSavedAt(null); }}
            onBlur={handleBlur}
            placeholder={'My X handle is @stuard.\nKeep tone friendly and concise.\nAvoid mentioning competitor products.'}
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
          />
        </div>
      </section>

      {/* Recent summaries */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Recent runs (auto)</h3>
        {summaries.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-theme/40 p-6 text-center">
            <div className="max-w-sm text-[12px] leading-5 text-theme-muted">
              Memory will populate after the agent runs a few times.
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {summaries.map(s => (
              <div key={s.id} className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
                <div className="text-[11px] text-theme-muted">{timeAgo(s.startedAt)}</div>
                <div className="mt-1 line-clamp-3 text-[12px] text-theme-fg/90">{s.agentMessage}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


// ─── Kanban summary strip ──────────────────────────────────────────────────
//
// Slim horizontal context bar shown above the kanban board when that tab is
// active. The kanban tab hides the side aside to give cards room to breathe;
// this strip preserves the at-a-glance status info (next run, tasks, runs,
// executor, model, trigger) without taking real estate from the columns.

function KanbanSummaryStrip({
  status,
  nextRunValue,
  activeTaskCount,
  totalRuns,
  executionLabel,
  modelLabel,
  triggerLabel,
  vmDeployed,
}: {
  status: { dot: string; label: string; textColor: string; badgeTone: BadgeTone };
  nextRunValue: string;
  activeTaskCount: number;
  totalRuns: number;
  executionLabel: string;
  modelLabel: string;
  triggerLabel: string;
  vmDeployed: boolean;
}) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Next', value: nextRunValue },
    { label: 'Tasks', value: padCount(activeTaskCount) },
    { label: 'Runs', value: padCount(totalRuns) },
    { label: vmDeployed ? 'VM + Local' : 'Executor', value: executionLabel },
    { label: 'Intelligence', value: modelLabel },
    { label: 'Trigger', value: triggerLabel },
  ];
  return (
    <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className={clsx('h-2 w-2 rounded-full', status.dot)} />
        <span className={clsx('text-[12px] font-semibold uppercase tracking-wide', status.textColor)}>{status.label}</span>
      </div>
      <div className="h-4 w-px bg-theme/15" />
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <div className="h-4 w-px bg-theme/15" />}
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-theme-muted">{it.label}</span>
            <span className="text-[12.5px] font-semibold text-theme-fg">{it.value}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Settings tab ──────────────────────────────────────────────────────────

function SettingsTab({
  bot,
  config,
  onUpdateBot,
  onUpdateConfig,
  onDelete,
  onTriggersChanged,
}: {
  bot: Bot;
  config: BotConfig;
  onUpdateBot: (patch: Partial<Bot>) => Promise<void> | void;
  onUpdateConfig: (patch: Partial<BotConfig>) => void;
  onDelete: () => void;
  onTriggersChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(bot.name);
  const [emoji, setEmoji] = useState(bot.emoji);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);

  return (
    <div className="rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/10 p-4 space-y-6">
      {/* Identity */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Identity</h3>
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-500/10 text-2xl transition hover:bg-zinc-500/20"
              onClick={() => {
                const idx = COMMON_EMOJIS.indexOf(emoji);
                const next = COMMON_EMOJIS[(idx + 1) % COMMON_EMOJIS.length];
                setEmoji(next);
                onUpdateBot({ emoji: next });
              }}
              title="Click to cycle"
            >
              {emoji}
            </button>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => name !== bot.name && onUpdateBot({ name })}
              className="flex-1 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[14px] font-medium text-theme-fg outline-none transition focus:border-primary/60"
            />
          </div>
        </div>
      </section>

      {/* Personality */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Personality / Objective</h3>
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
          <textarea
            rows={4}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            onBlur={() => systemPrompt !== bot.systemPrompt && onUpdateBot({ systemPrompt })}
            placeholder="You are a focused, friendly assistant that posts weekly product updates to X."
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-theme-fg placeholder:text-theme-muted/50 outline-none"
          />
        </div>
      </section>

      {/* Triggers */}
      <TriggersSection bot={bot} onChanged={onTriggersChanged} />

      {/* Tools */}
      <ToolsSection
        selected={config.allowedTools}
        onChange={(allowedTools) => onUpdateConfig({ allowedTools })}
      />

      {/* Skills */}
      <SkillsSection
        skillIds={config.skillIds}
        onChange={(skillIds) => onUpdateConfig({ skillIds })}
      />

      {/* Deployment */}
      <VmDeploySection bot={bot} onChanged={onTriggersChanged} />

      {/* Model */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Model</h3>
        <div className="space-y-2.5">
          <ConfigRow
            label="Level of Intelligence"
            control={
              <Select<ProactiveModelMode>
                value={config.modelMode}
                options={(Object.entries(PROACTIVE_MODEL_MODE_LABELS) as [ProactiveModelMode, { label: string; description: string }][])
                  .map(([value, meta]) => ({ value, label: meta.label }))}
                onChange={value => onUpdateConfig({ modelMode: value })}
              />
            }
          />
        </div>
      </section>

      {/* Notifications */}
      <section>
        <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Notifications</h3>
        <div className="space-y-2.5">
          {(Object.entries(NOTIFICATION_CHANNEL_LABELS) as Array<[NotificationChannel, { label: string; description: string }]>).map(([ch, info]) => {
            const isActive = config.notificationChannels.includes(ch);
            return (
              <ConfigRow
                key={ch}
                label={info.label}
                description={info.description}
                control={
                  <Toggle
                    checked={isActive}
                    onChange={v => {
                      const next = v
                        ? Array.from(new Set([...config.notificationChannels, ch]))
                        : config.notificationChannels.filter(c => c !== ch);
                      onUpdateConfig({ notificationChannels: next.length ? next : ['app'] });
                    }}
                  />
                }
              />
            );
          })}
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-red-300">Delete agent</div>
            <p className="mt-0.5 text-[12px] text-theme-muted">Removes the agent and stops all scheduled runs. Tasks and run logs will be cleared.</p>
          </div>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-transparent px-4 py-2 text-[13px] font-medium text-red-300 transition hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Tools picker ──────────────────────────────────────────────────────────

function ToolsSection({
  selected,
  onChange,
}: { selected: string[]; onChange: (next: string[]) => void }) {
  const [available, setAvailable] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.desktopAPI.botsGetAvailableTools();
        if (!cancelled && res?.ok && Array.isArray(res.tools)) setAvailable(res.tools);
      } catch { /* fall back to empty list */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const remove = (tool: string) => onChange(selected.filter(t => t !== tool));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Wrench className="h-4 w-4" /> Tools
          </h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">
            {selected.length === 0
              ? 'No extra tools added. Agent can use only its default agent tools.'
              : `${selected.length} extra tool${selected.length === 1 ? '' : 's'} added to this agent.`}
          </p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
        >
          <Plus className="h-3 w-3" />
          Add tools
        </button>
      </div>

      {selected.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          This agent starts with only its default agent tools. Click <span className="font-medium text-theme-fg">Add tools</span> to give it specific extra tools.
        </div>
      ) : (
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-3.5 py-3 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {selected.map(tool => (
              <span
                key={tool}
                title={tool}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-3 pr-1 text-[11px] font-medium text-primary"
              >
                {humanizeToolName(tool)}
                <button
                  onClick={() => remove(tool)}
                  className="rounded-full p-0.5 transition hover:bg-primary/20"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {pickerOpen && (
        <ToolsPickerModal
          available={available}
          selected={selected}
          onClose={() => setPickerOpen(false)}
          onApply={(next) => { onChange(next); setPickerOpen(false); }}
        />
      )}
    </section>
  );
}

function ToolsPickerModal({
  available,
  selected,
  onClose,
  onApply,
}: {
  available: string[];
  selected: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return available;
    return available.filter(t =>
      t.toLowerCase().includes(q) ||
      humanizeToolName(t).toLowerCase().includes(q),
    );
  }, [available, search]);

  const toggle = (tool: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool); else next.add(tool);
      return next;
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-theme/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-stuard text-lg font-semibold text-theme-fg">Add tools</h2>
              <p className="mt-0.5 text-[12px] text-theme-muted">Pick exact extra tools for this agent. Empty = default agent tools only.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{draft.size} selected</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-theme-muted" />
            <input
              autoFocus
              type="text"
              placeholder="Search tools…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-theme-fg outline-none placeholder:text-theme-muted/60"
            />
            {search && (
              <button onClick={() => setSearch('')} className="rounded p-1 text-theme-muted hover:text-theme-fg">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2 scrollbar-minimal">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-theme-muted">No tools match "{search}".</div>
          ) : (
            filtered.map(tool => {
              const checked = draft.has(tool);
              const label = humanizeToolName(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggle(tool)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition',
                    checked ? 'bg-primary/10 text-primary' : 'text-theme-fg hover:bg-theme-hover/40',
                  )}
                >
                  <div className={clsx(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary' : 'border-theme/30',
                  )}>
                    {checked && <Check className="h-3 w-3 text-primary-fg" />}
                  </div>
                  <span className="truncate font-medium" title={tool}>{label}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-theme/15 p-3">
          <button
            onClick={() => setDraft(new Set())}
            className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(Array.from(draft))}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Skills section ────────────────────────────────────────────────────────

type SkillInfo = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  trigger: string;
  isActive: boolean;
};

function SkillsSection({
  skillIds,
  onChange,
}: { skillIds: string[] | undefined; onChange: (next: string[] | undefined) => void }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await window.desktopAPI.skillsList();
        if (!cancelled && res?.ok && Array.isArray(res.skills)) {
          setSkills(res.skills as SkillInfo[]);
        }
      } catch { /* fall back to empty */ }
    };
    load();
    const off = window.desktopAPI.onSkillsUpdated?.((updated: any[]) => {
      if (!cancelled && Array.isArray(updated)) setSkills(updated as SkillInfo[]);
    });
    return () => { cancelled = true; if (typeof off === 'function') off(); };
  }, []);

  const activeSkills = useMemo(() => skills.filter(s => s.isActive), [skills]);
  const isInherit = skillIds === undefined;
  const selected = useMemo(() => {
    if (isInherit) return [];
    const set = new Set(skillIds);
    return activeSkills.filter(s => set.has(s.id));
  }, [activeSkills, skillIds, isInherit]);
  const ghostSelected = useMemo(() => {
    // Skill ids the bot has selected but that no longer exist in the active set.
    if (isInherit) return [];
    const activeIds = new Set(activeSkills.map(s => s.id));
    return (skillIds || []).filter(id => !activeIds.has(id));
  }, [skillIds, activeSkills, isInherit]);

  const remove = (id: string) => {
    onChange((skillIds || []).filter(x => x !== id));
  };

  const description = isInherit
    ? `Inheriting all ${activeSkills.length} active skill${activeSkills.length === 1 ? '' : 's'}. Restrict to give this agent a focused subset.`
    : selected.length === 0
      ? 'Restricted — no skills available to this agent.'
      : `${selected.length} skill${selected.length === 1 ? '' : 's'} enabled.`;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-theme-fg">
            <Sparkles className="h-4 w-4" /> Skills
          </h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">{description}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isInherit && (
            <button
              onClick={() => onChange(undefined)}
              className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
              title="Use all globally-active skills"
            >
              Inherit all
            </button>
          )}
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
          >
            <Plus className="h-3 w-3" />
            {isInherit ? 'Restrict…' : 'Pick skills'}
          </button>
        </div>
      </div>

      {isInherit ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          This agent can use any skill you've enabled globally. Click <span className="font-medium text-theme-fg">Restrict…</span> to scope it down.
        </div>
      ) : selected.length === 0 && ghostSelected.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-theme/40 px-4 py-3 text-[12px] text-theme-muted">
          No skills selected. Click <span className="font-medium text-theme-fg">Pick skills</span> to grant this agent access to specific skills.
        </div>
      ) : (
        <div className="rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-3.5 py-3 shadow-sm">
          <div className="flex flex-wrap gap-1.5">
            {selected.map(skill => (
              <span
                key={skill.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 py-1 pl-2.5 pr-1 text-[11px] font-medium text-primary"
                style={skill.color ? { borderColor: `${skill.color}55`, backgroundColor: `${skill.color}15`, color: skill.color } : undefined}
              >
                <span aria-hidden>{skill.icon || '✨'}</span>
                {skill.name}
                <button
                  onClick={() => remove(skill.id)}
                  className="rounded-full p-0.5 transition hover:bg-current/20"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {ghostSelected.map(id => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 py-1 pl-2.5 pr-1 text-[11px] font-medium text-amber-500"
                title="This skill is currently inactive or has been deleted"
              >
                <AlertCircle className="h-3 w-3" />
                {humanizeToolName(id)}
                <button
                  onClick={() => remove(id)}
                  className="rounded-full p-0.5 transition hover:bg-amber-500/20"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {pickerOpen && (
        <SkillsPickerModal
          skills={activeSkills}
          selected={isInherit ? activeSkills.map(s => s.id) : (skillIds || [])}
          onClose={() => setPickerOpen(false)}
          onApply={(next) => { onChange(next); setPickerOpen(false); }}
        />
      )}
    </section>
  );
}

function SkillsPickerModal({
  skills,
  selected,
  onClose,
  onApply,
}: {
  skills: SkillInfo[];
  selected: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.trigger.toLowerCase().includes(q),
    );
  }, [skills, search]);

  const toggle = (id: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-theme/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-stuard text-lg font-semibold text-theme-fg">Pick skills</h2>
              <p className="mt-0.5 text-[12px] text-theme-muted">Only checked skills are available to this agent at run time.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{draft.size} selected</span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-theme-muted" />
            <input
              autoFocus
              type="text"
              placeholder="Search skills…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-theme-fg outline-none placeholder:text-theme-muted/60"
            />
            {search && (
              <button onClick={() => setSearch('')} className="rounded p-1 text-theme-muted hover:text-theme-fg">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[460px] overflow-y-auto p-3 scrollbar-minimal">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-theme-muted">
              {skills.length === 0 ? 'No active skills yet. Create skills from the Skills tab first.' : `No skills match "${search}".`}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map(skill => {
              const checked = draft.has(skill.id);
              return (
                <button
                  key={skill.id}
                  onClick={() => toggle(skill.id)}
                  className={clsx(
                    'flex min-h-[92px] w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition',
                    checked
                      ? 'border-primary/40 bg-primary/10 shadow-sm'
                      : 'border-theme/30 dark:border-transparent bg-theme-card/50 hover:bg-theme-hover/40',
                  )}
                >
                  <div className={clsx(
                    'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary' : 'border-theme/30',
                  )}>
                    {checked && <Check className="h-3 w-3 text-primary-fg" />}
                  </div>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
                    style={skill.color ? { backgroundColor: `${skill.color}20` } : undefined}
                    aria-hidden
                  >
                    {skill.icon || '✨'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={clsx('text-[13px] font-semibold leading-5', checked ? 'text-primary' : 'text-theme-fg')}>
                      {skill.name}
                    </div>
                    {skill.description && (
                      <div className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-theme-muted">{skill.description}</div>
                    )}
                  </div>
                </button>
              );
            })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-theme/15 p-3">
          <button
            onClick={() => setDraft(new Set())}
            className="rounded-full px-3 py-1.5 text-[12px] text-theme-muted transition hover:text-theme-fg"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(Array.from(draft))}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── VM deploy section ─────────────────────────────────────────────────────

function VmDeploySection({ bot, onChanged }: { bot: Bot; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onVm = !!bot.vmDeployedAt;

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.desktopAPI.botsDeployToVm(bot.id);
      if (!res?.ok) setError(humanizeVmError(res?.error));
      else await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.desktopAPI.botsStopOnVm(bot.id);
      if (!res?.ok) setError(humanizeVmError(res?.error));
      else await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[15px] font-semibold text-theme-fg">Deployment</h3>
      <div className="space-y-2.5">
        {/* Local — always present, can't be turned off */}
        <DeployRow
          icon={Monitor}
          title="This computer"
          subtitle="Always on while Stuard is open. Free."
          status="Running"
          tone="success"
        />
        {/* VM — additive deploy */}
        <DeployRow
          icon={Cloud}
          title="Cloud VM (24/7)"
          subtitle={onVm
            ? `Deployed ${timeAgo(bot.vmDeployedAt)} · the VM keeps running this even when your laptop is closed.`
            : 'Push this agent to your cloud VM so it keeps running when your laptop is closed.'}
          status={onVm ? 'On VM' : 'Not deployed'}
          tone={onVm ? 'primary' : 'neutral'}
          action={
            onVm ? (
              <button
                onClick={stop}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                Stop on VM
              </button>
            ) : (
              <button
                onClick={deploy}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                Deploy to VM
              </button>
            )
          }
        />
      </div>
      {error && (
        <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-theme-muted/80">
        Deployed agents run on the VM alongside local runs, with their private kanban synced back into this tab.
      </p>
    </section>
  );
}

function humanizeVmError(err?: string): string {
  if (!err) return 'Action failed.';
  if (err === 'not_authenticated') return 'Sign in to use the VM.';
  if (err === 'vm_unreachable' || err === 'engine_not_running' || err === 'no_engine_for_user') return 'Could not reach your VM. Make sure it’s running.';
  if (err === 'config_not_found' || err === 'bot_not_found') return 'Agent config not found.';
  if (err === 'bot_id_required') return 'Missing agent id.';
  if (err === 'bot_not_deployed_to_vm') return 'This agent isn’t deployed to the VM yet.';
  if (err === 'http_404') return 'Your cloud-ai service is missing the /v1/bot/run route. Redeploy cloud-ai to pick it up.';
  if (err.startsWith('http_')) return `Cloud-ai responded ${err.replace('http_', '')}.`;
  return err;
}

function DeployRow({
  icon: Icon,
  title,
  subtitle,
  status,
  tone,
  action,
}: {
  icon: any;
  title: string;
  subtitle: string;
  status: string;
  tone: BadgeTone;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-theme/40 dark:border-transparent bg-theme-card px-4 py-3 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-500/10 text-theme-fg">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-theme-fg">{title}</span>
          <DashboardBadge label={status} tone={tone} />
        </div>
        <p className="mt-0.5 text-[12px] text-theme-muted">{subtitle}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Triggers section ─────────────────────────────────────────────────────

function TriggersSection({ bot, onChanged }: { bot: Bot; onChanged: () => Promise<void> | void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async (type: BotTriggerType) => {
    setPickerOpen(false);
    const res = await window.desktopAPI.botsAddTrigger(bot.id, { type });
    if (res?.ok && res.trigger) {
      await onChanged();
      // For types with config, open the editor immediately. Manual triggers
      // have nothing to edit.
      if (type !== 'manual') setEditingId(res.trigger.id);
    } else if (res?.error === 'invalid_input') {
      alert('That trigger type is already on this agent. Pick a different one or edit the existing trigger.');
    }
  };

  const handleRemove = async (triggerId: string) => {
    const res = await window.desktopAPI.botsRemoveTrigger(bot.id, triggerId);
    if (!res?.ok) {
      alert('An agent must keep at least one trigger. Switch this one to "Manual" if you want no automation.');
      return;
    }
    await onChanged();
  };

  const handleToggleEnabled = async (trigger: BotTrigger) => {
    await window.desktopAPI.botsUpdateTrigger(bot.id, trigger.id, { enabled: !(trigger.enabled !== false) });
    await onChanged();
  };

  const editingTrigger = editingId ? bot.triggers.find(t => t.id === editingId) : null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-theme-fg">When should this agent run?</h3>
          <p className="mt-0.5 text-[12px] text-theme-muted">Add as many triggers as you want. Any one firing wakes the agent.</p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3 py-1.5 text-[12px] font-medium text-theme-fg shadow-sm transition hover:bg-theme-hover"
        >
          <Plus className="h-3 w-3" />
          Add trigger
        </button>
      </div>

      <div className="space-y-2.5">
        {bot.triggers.map(trigger => (
          <TriggerRow
            key={trigger.id}
            trigger={trigger}
            onEdit={() => setEditingId(trigger.id)}
            onToggle={() => handleToggleEnabled(trigger)}
            onRemove={bot.triggers.length > 1 ? () => handleRemove(trigger.id) : undefined}
          />
        ))}
      </div>

      {pickerOpen && (
        <TriggerPickerModal
          existing={bot.triggers}
          onClose={() => setPickerOpen(false)}
          onPick={handleAdd}
        />
      )}

      {editingTrigger && (
        <TriggerEditModal
          botId={bot.id}
          trigger={editingTrigger}
          onClose={() => setEditingId(null)}
          onSaved={async () => { setEditingId(null); await onChanged(); }}
        />
      )}
    </section>
  );
}

function TriggerRow({
  trigger,
  onEdit,
  onToggle,
  onRemove,
}: {
  trigger: BotTrigger;
  onEdit: () => void;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const meta = TRIGGER_META[trigger.type];
  const Icon = meta?.icon || Zap;
  const enabled = trigger.enabled !== false;
  const desc = describeTrigger(trigger);

  return (
    <div className={clsx(
      'flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm transition',
      enabled
        ? 'border-theme/40 dark:border-transparent bg-theme-card'
        : 'border-theme/30 bg-theme-card/40 opacity-70',
    )}>
      <div className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        enabled ? 'bg-primary/10 text-primary' : 'bg-zinc-500/10 text-theme-muted',
      )}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-theme-fg">{meta?.label || trigger.type}</span>
          {trigger.requiresCloud && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              <AlertCircle className="h-2.5 w-2.5" />
              cloud delivery pending
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-theme-muted">{desc}</div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Toggle checked={enabled} onChange={onToggle} />
        {trigger.type !== 'manual' && (
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-theme-muted transition hover:bg-zinc-500/10 hover:text-theme-fg"
            title="Edit"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="rounded-lg p-1.5 text-theme-muted transition hover:bg-rose-500/10 hover:text-rose-500"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function TriggerPickerModal({
  existing,
  onClose,
  onPick,
}: {
  existing: BotTrigger[];
  onClose: () => void;
  onPick: (type: BotTriggerType) => void;
}) {
  // 'gmail.new_email' removed pending Google CASA verification (requires gmail.readonly restricted scope).
  const types: BotTriggerType[] = ['schedule.interval', 'schedule.cron', 'webhook', /* 'gmail.new_email', */ 'manual'];
  const hasInterval = existing.some(t => t.type === 'schedule.interval');

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4">
          <h2 className="font-stuard text-lg font-semibold text-theme-fg">Add a trigger</h2>
          <p className="mt-0.5 text-[12px] text-theme-muted">Pick how this agent should wake up.</p>
        </div>
        <div className="space-y-2">
          {types.map(t => {
            const meta = TRIGGER_META[t];
            const Icon = meta.icon;
            const disabled = t === 'schedule.interval' && hasInterval;
            return (
              <button
                key={t}
                onClick={() => onPick(t)}
                disabled={disabled}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition',
                  disabled
                    ? 'cursor-not-allowed border-theme/20 bg-zinc-500/5 opacity-50'
                    : 'border-theme/40 dark:border-transparent bg-theme-card/40 hover:border-primary/50 hover:bg-primary/5',
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-theme-fg">{meta.label}</div>
                  <div className="text-[11px] text-theme-muted">{meta.tagline}</div>
                  {disabled && <div className="mt-0.5 text-[10px] text-amber-400">Already on this agent</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TriggerEditModal({
  botId,
  trigger,
  onClose,
  onSaved,
}: {
  botId: string;
  trigger: BotTrigger;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const meta = TRIGGER_META[trigger.type];
  const [args, setArgs] = useState<Record<string, any>>({ ...trigger.args });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await window.desktopAPI.botsUpdateTrigger(botId, trigger.id, { args });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      style={{ WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-theme/50 dark:border-transparent bg-theme-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <meta.icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-theme-fg">{meta.label}</h2>
            <p className="text-[11px] text-theme-muted">{meta.tagline}</p>
          </div>
        </div>

        <div className="mb-4">
          {trigger.type === 'schedule.interval' && (
            <IntervalEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'schedule.cron' && (
            <CronEditor args={args} setArgs={setArgs} />
          )}
          {trigger.type === 'webhook' && (
            <WebhookEditor args={args} />
          )}
          {trigger.type === 'gmail.new_email' && (
            <GmailEditor args={args} setArgs={setArgs} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-1.5 text-[13px] text-theme-muted transition hover:text-theme-fg"
          >
            Cancel
          </button>
          {trigger.type !== 'webhook' && (
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
          )}
          {trigger.type === 'webhook' && (
            <button
              onClick={onClose}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-fg shadow-sm transition hover:opacity-90"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Per-type editors ─────────────────────────────────────────────────────

function IntervalEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const value = (args.every || '30m') as ScheduleInterval;
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">How often?</label>
      <select
        value={value}
        onChange={e => setArgs({ ...args, every: e.target.value })}
        className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
      >
        {Object.entries(SCHEDULE_LABELS).map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}

function CronEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  const expr = String(args.expr || '');
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Cron expression</label>
      <input
        type="text"
        value={expr}
        onChange={e => setArgs({ ...args, expr: e.target.value })}
        placeholder="0 9 * * 2"
        className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 font-mono text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
      />
      <div className="mt-2.5">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-theme-muted">Quick presets</div>
        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map(p => (
            <button
              key={p.expr}
              onClick={() => setArgs({ ...args, expr: p.expr })}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-[11px] transition',
                expr === p.expr
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-theme/30 bg-theme-card text-theme-muted hover:border-theme/60',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2.5 text-[11px] text-theme-muted">
        Format: <span className="font-mono">minute hour day-of-month month day-of-week</span>. Uses your system timezone.
      </p>
    </div>
  );
}

function WebhookEditor({ args }: { args: Record<string, any> }) {
  const [copied, setCopied] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'err' | null>(null);
  const slug = String(args.slug || '');
  // Reserved cloud URL — works once the cloud relay lands in a follow-up.
  const cloudUrl = `https://api.stuard.ai/webhooks/incoming/${slug}`;

  // Resolve the local webhook server URL through main so we use the actual
  // bound port (it falls back to an ephemeral port if 18080 is busy).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.desktopAPI.webhooksLocalUrl(slug);
        if (!cancelled && res?.ok && res.url) setLocalUrl(res.url);
      } catch { /* ignore — UI shows just the cloud URL */ }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const copy = (value: string) => {
    try {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const test = async () => {
    if (!localUrl) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, source: 'bot-webhook-editor', at: new Date().toISOString() }),
      });
      setTestResult(r.ok ? 'ok' : 'err');
    } catch {
      setTestResult('err');
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Local URL — actually works today */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Local URL (works now)</label>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            <Zap className="h-2.5 w-2.5" /> live
          </span>
        </div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={localUrl || 'Resolving local port…'}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 rounded-xl border border-theme/40 dark:border-transparent bg-zinc-500/10 px-3 py-2.5 font-mono text-[12px] text-theme-fg outline-none"
          />
          <button
            onClick={() => localUrl && copy(localUrl)}
            disabled={!localUrl}
            className="inline-flex items-center gap-1.5 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 text-[12px] font-medium text-theme-fg transition hover:border-primary/40 disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={test}
            disabled={!localUrl || testing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 text-[12px] font-medium text-theme-fg transition hover:border-primary/40 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : testResult === 'ok' ? <Check className="h-3.5 w-3.5 text-emerald-500" />
              : testResult === 'err' ? <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
              : <Zap className="h-3.5 w-3.5" />}
            Test
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-theme-muted">
          POST to this URL from anything on your machine (Zapier desktop agents, curl, scripts). The agent wakes immediately and the request body is passed in as the trigger payload.
        </p>
      </div>

      {/* Cloud URL — reserved */}
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Public cloud URL (coming soon)</label>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={cloudUrl}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 rounded-xl border border-theme/30 dark:border-transparent bg-zinc-500/5 px-3 py-2.5 font-mono text-[12px] text-theme-muted outline-none"
          />
          <button
            onClick={() => copy(cloudUrl)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 text-[12px] font-medium text-theme-muted transition hover:border-primary/40"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>
      </div>

      {args.secret && (
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Optional shared secret</label>
          <input
            readOnly
            value={String(args.secret)}
            className="w-full rounded-xl border border-theme/40 dark:border-transparent bg-zinc-500/10 px-3 py-2.5 font-mono text-[12px] text-theme-fg outline-none"
          />
          <p className="mt-1.5 text-[11px] text-theme-muted">Senders can include this in the <span className="font-mono">x-signature</span> header to verify the request came from a trusted source.</p>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-400">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-3 w-3" />
          Cloud delivery pending
        </div>
        <p className="mt-0.5 opacity-90">The local URL above works today against this machine. The public cloud URL is reserved; routing it through the cloud relay lands in a follow-up.</p>
      </div>
    </div>
  );
}

function GmailEditor({ args, setArgs }: { args: Record<string, any>; setArgs: (next: Record<string, any>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Only fire when email is from</label>
        <input
          type="text"
          value={String(args.from || '')}
          onChange={e => setArgs({ ...args, from: e.target.value })}
          placeholder="updates@example.com (leave empty to match any sender)"
          className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-theme-muted">Only fire when subject contains</label>
        <input
          type="text"
          value={String(args.subjectContains || '')}
          onChange={e => setArgs({ ...args, subjectContains: e.target.value })}
          placeholder="weekly digest (leave empty to match any subject)"
          className="w-full rounded-xl border border-theme/30 dark:border-transparent bg-theme-card/60 px-3 py-2.5 text-[13px] text-theme-fg outline-none transition focus:border-primary/60"
        />
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] text-amber-400">
        <div className="flex items-center gap-1.5 font-medium">
          <AlertCircle className="h-3 w-3" />
          Cloud delivery pending
        </div>
        <p className="mt-0.5 opacity-90">Requires Google connected and Pub/Sub registration. The trigger is stored; wiring it up lands in the next release.</p>
      </div>
    </div>
  );
}
