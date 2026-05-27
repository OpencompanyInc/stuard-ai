import { SCHEDULE_LABELS, type ScheduleInterval } from './proactive-types';
import type { BotTrigger } from './types';
import { CRON_PRESETS, INTERNAL_BOT_TOOLS } from './constants';

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function humanizeToolName(name: string): string {
  if (!name) return '';
  const stripped = name.replace(/^(gmail|google|github|slack|notion|linear|discord|twitter|reddit|browser)[._]/i, (m) => `${m.replace(/[._]$/, '')} `);
  return stripped
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function humanizeModelName(id: string): string {
  if (!id) return '';
  const slash = id.lastIndexOf('/');
  const raw = slash >= 0 ? id.slice(slash + 1) : id;
  return raw
    .split('-')
    .filter(Boolean)
    .map(part => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => {
    const key = keyword.trim().toLowerCase();
    if (!key) return false;
    if (key.length <= 2) return new RegExp(`(^|\\W)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(text);
    return text.includes(key);
  });
}

export function titleFromGoal(goal: string): string {
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

export function inferInterval(goal: string): ScheduleInterval {
  const text = goal.toLowerCase();
  if (hasAnyKeyword(text, ['manual', 'on demand', 'when i ask'])) return 'manual';
  if (hasAnyKeyword(text, ['random', 'random day', 'random days', 'at least every week', 'multiple days a week', 'weekly random'])) return 'random';
  if (hasAnyKeyword(text, ['urgent', 'live', 'asap', 'realtime', 'real-time'])) return '10m';
  if (hasAnyKeyword(text, ['often', 'frequent', 'watch', 'monitor'])) return '15m';
  if (hasAnyKeyword(text, ['daily', 'morning', 'evening', 'weekly'])) return '2h';
  return '30m';
}

export function isInternalBotTool(tool: string): boolean {
  return INTERNAL_BOT_TOOLS.has(tool)
    || tool.startsWith('proactive_task_')
    || tool.startsWith('bot_memory_');
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function timeUntil(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'Any moment';
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)}m`;
  return `${Math.round(diff / 3600_000 * 10) / 10}h`;
}

export function padCount(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0');
}

export function formatClockTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
}

export function formatShortScheduleLabel(interval: ScheduleInterval): string {
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

export function formatDuration(startedAt: string, completedAt?: string | null): string | null {
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt || Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatElapsedFrom(startedAt: string, at: string): string {
  const start = new Date(startedAt).getTime();
  const current = new Date(at).getTime();
  if (Number.isNaN(start) || Number.isNaN(current) || current < start) return '0s';
  const totalSeconds = Math.max(0, Math.round((current - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function buildLogPreview(log: any): string {
  if (log?.timedOut) return log.failureReason || 'Timed out';
  if (log?.status === 'running') {
    const history = Array.isArray(log.stageHistory) ? log.stageHistory : [];
    return history.length > 0 ? history[history.length - 1].label : 'Running...';
  }
  return log?.agentMessage?.slice(0, 140) || log?.partialResponse?.slice(0, 140) || log?.failureReason || 'No message';
}

export function describeTrigger(t: BotTrigger): string {
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
    case 'fs.watch': {
      const path = String(t.args?.path || '').trim();
      return path ? `Watching ${path}` : 'File/folder watcher (no path set)';
    }
    case 'command.watch': {
      const cmd = String(t.args?.command || '').trim();
      return cmd ? `Watching: ${cmd}` : 'Custom watcher (no command set)';
    }
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

export function humanizeVmError(err?: string): string {
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

export function statusInfo(status: 'paused' | 'running' | 'errored'): { dot: string; label: string; textColor: string; badgeTone: 'neutral' | 'primary' | 'warning' | 'success' | 'danger' } {
  if (status === 'running') return { dot: 'bg-emerald-500', label: 'Running', textColor: 'text-emerald-400', badgeTone: 'success' };
  if (status === 'errored') return { dot: 'bg-rose-500', label: 'Errored', textColor: 'text-rose-400', badgeTone: 'danger' };
  return { dot: 'bg-zinc-400', label: 'Paused', textColor: 'text-theme-muted', badgeTone: 'neutral' };
}
