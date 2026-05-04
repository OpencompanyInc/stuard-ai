import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// Inlined to avoid circular dep with ./bot-service. Must match.
const DEFAULT_BOT_ID = 'bot_default';

/**
 * Returns the effective botId for a record/query. Legacy entries that pre-date
 * the multi-bot refactor have no botId; we treat them as the default bot.
 */
function effectiveBotId(value: string | undefined): string {
  return (value && value.trim()) || DEFAULT_BOT_ID;
}

interface ProactiveContextPermissions {
  screenshot: boolean;
  systemAudio: boolean;
  micAudio: boolean;
}

interface ProactiveConfig {
  enabled: boolean;
  interval: string;
  executionTarget: 'local' | 'cloud';
  modelMode: 'auto' | 'fast' | 'balanced' | 'smart';
  modelId?: string;
  instructions: string;
  contextPermissions: ProactiveContextPermissions;
  allowedTools: string[];
  notificationChannels: string[];
  lastWakeUpAt?: string | null;
  nextWakeUpAt?: string | null;
}

interface ProactiveTask {
  id: string;
  /**
   * Owner bot id. Optional in the type for back-compat with legacy entries
   * that pre-date the multi-bot refactor; reads default unfiltered entries
   * to the legacy default bot.
   */
  botId?: string;
  title: string;
  instructions: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  createdAt: string;
  updatedAt: string;
}

interface WakeUpStageEvent {
  stage: string;
  label: string;
  progress: number;
  detail?: string;
  at: string;
}

interface WakeUpToolCall {
  id: string;
  tool: string;
  status?: string;
  description?: string;
  args?: any;
  result?: any;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

interface WakeUpActivityEvent {
  id: string;
  kind: 'lifecycle' | 'routing' | 'reasoning' | 'tool' | 'status';
  event: string;
  label: string;
  detail?: string;
  at: string;
}

type NotificationEngagement = 'pending' | 'replied' | 'dismissed' | 'ignored';

interface WakeUpLog {
  id: string;
  /** Owner bot id; missing on legacy entries → treat as the default bot. */
  botId?: string;
  /** Which trigger fired this run (if any). Useful for activity attribution. */
  triggerId?: string;
  startedAt: string;
  completedAt?: string | null;
  status: 'running' | 'completed' | 'failed';
  contextUsed: string[];
  tasksProcessed: string[];
  agentMessage?: string;
  executionTarget?: 'local' | 'cloud';
  modelMode?: 'auto' | 'fast' | 'balanced' | 'smart';
  modelId?: string;
  timeoutMs?: number;
  timedOut?: boolean;
  failureReason?: string;
  partialResponse?: string;
  stageHistory?: WakeUpStageEvent[];
  reasoningText?: string;
  toolCalls?: WakeUpToolCall[];
  activityEvents?: WakeUpActivityEvent[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedPromptTokens?: number;
    thinkingTokens?: number;
    reasoningTokens?: number;
    [key: string]: any;
  };
  parentWakeUpId?: string;
}

interface ProactiveData {
  config: ProactiveConfig;
  tasks: ProactiveTask[];
  wakeUpLog: WakeUpLog[];
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  interval: '30m',
  executionTarget: 'local',
  modelMode: 'balanced',
  modelId: '',
  instructions: '',
  contextPermissions: { screenshot: false, systemAudio: false, micAudio: false },
  allowedTools: [],
  notificationChannels: ['app'],
};

const dataPath = () => path.join(app.getPath('userData'), 'proactive-data.json');

function loadData(): ProactiveData {
  try {
    const p = dataPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return {
        config: { ...DEFAULT_CONFIG, ...raw.config },
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        wakeUpLog: Array.isArray(raw.wakeUpLog)
          ? raw.wakeUpLog.map((log: any) => ({
            ...log,
            contextUsed: Array.isArray(log?.contextUsed) ? log.contextUsed : [],
            tasksProcessed: Array.isArray(log?.tasksProcessed) ? log.tasksProcessed : [],
            stageHistory: Array.isArray(log?.stageHistory) ? log.stageHistory : [],
            reasoningText: typeof log?.reasoningText === 'string' ? log.reasoningText : '',
            toolCalls: Array.isArray(log?.toolCalls) ? log.toolCalls : [],
            activityEvents: Array.isArray(log?.activityEvents) ? log.activityEvents : [],
            usage: log?.usage && typeof log.usage === 'object' ? log.usage : undefined,
          }))
          : [],
      };
    }
  } catch (e) {
    logger.warn('[proactive] Failed to load data:', e);
  }
  return { config: { ...DEFAULT_CONFIG }, tasks: [], wakeUpLog: [] };
}

function saveData(data: ProactiveData) {
  try {
    fs.writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('[proactive] Failed to save data:', e);
  }
}

export const proactiveService = {
  getConfig(): { ok: true; config: ProactiveConfig } {
    return { ok: true, config: loadData().config };
  },

  updateConfig(updates: Partial<ProactiveConfig>): { ok: true; config: ProactiveConfig } {
    const data = loadData();
    data.config = { ...data.config, ...updates };
    saveData(data);
    return { ok: true, config: data.config };
  },

  listTasks(opts?: { status?: string; limit?: number; offset?: number; botId?: string }): { ok: true; tasks: ProactiveTask[]; total: number; hasMore: boolean } {
    const botId = opts?.botId !== undefined ? effectiveBotId(opts.botId) : undefined;
    let tasks = loadData().tasks;
    if (botId) tasks = tasks.filter(t => effectiveBotId(t.botId) === botId);
    const total = tasks.length;

    if (opts?.status) {
      tasks = tasks.filter(t => t.status === opts.status);
    }

    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 20;
    const paged = tasks.slice(offset, offset + limit);

    return { ok: true, tasks: paged, total, hasMore: offset + limit < tasks.length };
  },

  addTask(task: Partial<ProactiveTask> & { botId?: string }): { ok: true; task: ProactiveTask; tasks: ProactiveTask[] } {
    const data = loadData();
    const now = new Date().toISOString();
    const newTask: ProactiveTask = {
      id: `ptask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      botId: effectiveBotId(task.botId),
      title: task.title || 'Untitled Task',
      instructions: task.instructions || '',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      ...task,
    };
    data.tasks.unshift(newTask);
    saveData(data);
    return { ok: true, task: newTask, tasks: data.tasks };
  },

  updateTask(taskId: string, updates: Partial<ProactiveTask>): { ok: boolean; task?: ProactiveTask; tasks?: ProactiveTask[]; error?: string } {
    const data = loadData();
    const idx = data.tasks.findIndex(t => t.id === taskId);
    if (idx < 0) return { ok: false, error: 'Task not found' };
    data.tasks[idx] = { ...data.tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    saveData(data);
    return { ok: true, task: data.tasks[idx], tasks: data.tasks };
  },

  deleteTask(taskId: string): { ok: true; tasks: ProactiveTask[] } {
    const data = loadData();
    data.tasks = data.tasks.filter(t => t.id !== taskId);
    saveData(data);
    return { ok: true, tasks: data.tasks };
  },

  getQueuedTasks(botId?: string): ProactiveTask[] {
    const tasks = loadData().tasks.filter(t => t.status === 'queued');
    if (!botId) return tasks;
    const id = effectiveBotId(botId);
    return tasks.filter(t => effectiveBotId(t.botId) === id);
  },

  getActiveTasks(botId?: string): ProactiveTask[] {
    const tasks = loadData().tasks.filter(t => t.status === 'queued' || t.status === 'in_progress');
    if (!botId) return tasks;
    const id = effectiveBotId(botId);
    return tasks.filter(t => effectiveBotId(t.botId) === id);
  },

  applyTaskUpdates(updates: Array<{ id: string; status: ProactiveTask['status']; result?: string }>): { ok: true; tasks: ProactiveTask[] } {
    const data = loadData();
    const now = new Date().toISOString();
    for (const u of updates) {
      const idx = data.tasks.findIndex(t => t.id === u.id);
      if (idx >= 0) {
        data.tasks[idx].status = u.status;
        if (u.result !== undefined) data.tasks[idx].result = u.result;
        data.tasks[idx].updatedAt = now;
      }
    }
    saveData(data);
    return { ok: true, tasks: data.tasks };
  },

  applyNewTasks(newTasks: Array<{ title: string; instructions?: string; status?: ProactiveTask['status']; botId?: string }>, defaults?: { botId?: string }): { ok: true; tasks: ProactiveTask[] } {
    const data = loadData();
    const now = new Date().toISOString();
    for (const t of newTasks) {
      const task: ProactiveTask = {
        id: `ptask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        botId: effectiveBotId(t.botId || defaults?.botId),
        title: t.title,
        instructions: t.instructions || '',
        status: t.status || 'queued',
        createdAt: now,
        updatedAt: now,
      };
      data.tasks.unshift(task);
    }
    saveData(data);
    return { ok: true, tasks: data.tasks };
  },

  addWakeUpLog(log: WakeUpLog): { ok: true } {
    const data = loadData();
    const stamped: WakeUpLog = { ...log, botId: effectiveBotId(log.botId) };
    data.wakeUpLog.unshift(stamped);
    if (data.wakeUpLog.length > 200) data.wakeUpLog = data.wakeUpLog.slice(0, 200);
    saveData(data);
    return { ok: true };
  },

  updateWakeUpLog(logId: string, updates: Partial<WakeUpLog>): { ok: true } {
    const data = loadData();
    const idx = data.wakeUpLog.findIndex(l => l.id === logId);
    if (idx >= 0) {
      data.wakeUpLog[idx] = { ...data.wakeUpLog[idx], ...updates };
      saveData(data);
    }
    return { ok: true };
  },

  appendWakeUpStage(logId: string, stage: WakeUpStageEvent): { ok: true } {
    const data = loadData();
    const idx = data.wakeUpLog.findIndex(l => l.id === logId);
    if (idx >= 0) {
      const history = Array.isArray(data.wakeUpLog[idx].stageHistory) ? data.wakeUpLog[idx].stageHistory : [];
      data.wakeUpLog[idx] = {
        ...data.wakeUpLog[idx],
        stageHistory: [...history, stage],
      };
      saveData(data);
    }
    return { ok: true };
  },

  appendWakeUpReasoning(logId: string, chunk: string): { ok: true } {
    if (!chunk) return { ok: true };
    const data = loadData();
    const idx = data.wakeUpLog.findIndex(l => l.id === logId);
    if (idx >= 0) {
      const current = typeof data.wakeUpLog[idx].reasoningText === 'string' ? data.wakeUpLog[idx].reasoningText : '';
      data.wakeUpLog[idx] = {
        ...data.wakeUpLog[idx],
        reasoningText: current + chunk,
      };
      saveData(data);
    }
    return { ok: true };
  },

  upsertWakeUpToolCall(logId: string, toolCall: WakeUpToolCall): { ok: true } {
    const data = loadData();
    const idx = data.wakeUpLog.findIndex(l => l.id === logId);
    if (idx >= 0) {
      const current = Array.isArray(data.wakeUpLog[idx].toolCalls) ? data.wakeUpLog[idx].toolCalls : [];
      const existingIdx = current.findIndex(call => call.id === toolCall.id);
      const nextCalls = existingIdx >= 0
        ? current.map((call, i) => i === existingIdx ? { ...call, ...toolCall, startedAt: call.startedAt || toolCall.startedAt } : call)
        : [...current, toolCall];
      data.wakeUpLog[idx] = {
        ...data.wakeUpLog[idx],
        toolCalls: nextCalls.slice(-50),
      };
      saveData(data);
    }
    return { ok: true };
  },

  appendWakeUpActivity(logId: string, activity: WakeUpActivityEvent): { ok: true } {
    const data = loadData();
    const idx = data.wakeUpLog.findIndex(l => l.id === logId);
    if (idx >= 0) {
      const current = Array.isArray(data.wakeUpLog[idx].activityEvents) ? data.wakeUpLog[idx].activityEvents : [];
      data.wakeUpLog[idx] = {
        ...data.wakeUpLog[idx],
        activityEvents: [...current, activity].slice(-80),
      };
      saveData(data);
    }
    return { ok: true };
  },

  getWakeUpLog(limit = 20, opts?: { botId?: string }): { ok: true; logs: WakeUpLog[] } {
    const data = loadData();
    let logs = data.wakeUpLog;
    if (opts?.botId !== undefined) {
      const id = effectiveBotId(opts.botId);
      logs = logs.filter(l => effectiveBotId(l.botId) === id);
    }
    return { ok: true, logs: logs.slice(0, limit) };
  },

  setNextWakeUp(nextAt: string | null): void {
    const data = loadData();
    data.config.nextWakeUpAt = nextAt;
    saveData(data);
  },

  setLastWakeUp(at: string): void {
    const data = loadData();
    data.config.lastWakeUpAt = at;
    saveData(data);
  },

  // ── Session Summary Storage ──────────────────────────────────────────────

  addSessionSummary(summary: string, opts?: {
    wakeUpId?: string;
    notificationEngagement?: NotificationEngagement;
    userReplyPreview?: string;
    botId?: string;
  }): void {
    if (!summary?.trim()) return;
    try {
      const p = sessionSummariesPath();
      const existing = loadSessionSummaries();
      const nextEntry: SessionSummaryEntry = {
        summary: summary.trim(),
        at: new Date().toISOString(),
        wakeUpId: typeof opts?.wakeUpId === 'string' && opts.wakeUpId.trim() ? opts.wakeUpId.trim() : undefined,
        notificationEngagement: opts?.notificationEngagement,
        userReplyPreview: normalizeSummaryPreview(opts?.userReplyPreview),
        botId: effectiveBotId(opts?.botId),
      };
      const existingIdx = nextEntry.wakeUpId
        ? existing.findIndex((entry) => entry.wakeUpId === nextEntry.wakeUpId)
        : -1;
      if (existingIdx >= 0) {
        existing[existingIdx] = { ...existing[existingIdx], ...nextEntry };
      } else {
        existing.unshift(nextEntry);
      }
      // Keep last 100 summaries (bumped from 50 since we're now multi-bot).
      const trimmed = existing.slice(0, 100);
      fs.writeFileSync(p, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch (e) {
      logger.warn('[proactive] Failed to save session summary:', e);
    }
  },

  updateSessionSummary(wakeUpId: string, updates: Partial<Pick<SessionSummaryEntry, 'notificationEngagement' | 'userReplyPreview'>>): void {
    const id = String(wakeUpId || '').trim();
    if (!id) return;
    try {
      const p = sessionSummariesPath();
      const existing = loadSessionSummaries();
      const idx = existing.findIndex((entry) => entry.wakeUpId === id);
      if (idx >= 0) {
        existing[idx] = {
          ...existing[idx],
          ...(updates.notificationEngagement !== undefined ? { notificationEngagement: updates.notificationEngagement } : {}),
          ...(updates.userReplyPreview !== undefined ? { userReplyPreview: normalizeSummaryPreview(updates.userReplyPreview) } : {}),
        };
        fs.writeFileSync(p, JSON.stringify(existing, null, 2), 'utf-8');
      }
    } catch (e) {
      logger.warn('[proactive] Failed to update session summary:', e);
    }
  },

  getRecentSessionSummaries(limit = 5, opts?: { botId?: string }): string[] {
    try {
      let summaries = loadSessionSummaries();
      if (opts?.botId !== undefined) {
        const id = effectiveBotId(opts.botId);
        summaries = summaries.filter(s => effectiveBotId(s.botId) === id);
      }
      return summaries.slice(0, limit).map(s => {
        const timeAgo = getTimeAgo(s.at);
        const parts = [`[${timeAgo}] ${s.summary}`];
        if (s.notificationEngagement) parts.push(`Notification: ${describeNotificationEngagement(s.notificationEngagement)}`);
        if (s.userReplyPreview) parts.push(`Reply: "${s.userReplyPreview}"`);
        return parts.join(' | ');
      });
    } catch {
      return [];
    }
  },

  // ── Notification Log ───────────────────────────────────────────────────
  // Tracks what was said, when, and whether the user engaged — so the agent
  // can avoid repeating itself and learn what kinds of check-ins get replies.

  logNotification(entry: Omit<NotificationLogEntry, 'id' | 'at'> & { botId?: string }): void {
    try {
      const p = notificationLogPath();
      const existing = loadNotificationLog();
      existing.unshift({
        ...entry,
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        at: new Date().toISOString(),
        botId: effectiveBotId(entry.botId),
      });
      // Keep last 200 entries (bumped from 100 since we're now multi-bot).
      fs.writeFileSync(p, JSON.stringify(existing.slice(0, 200), null, 2), 'utf-8');
    } catch (e) {
      logger.warn('[proactive] Failed to save notification log:', e);
    }
  },

  markNotificationEngagement(
    wakeUpId: string,
    engagement: NotificationLogEntry['engagement'],
    opts?: { replyText?: string },
  ): void {
    try {
      const p = notificationLogPath();
      const log = loadNotificationLog();
      const idx = log.findIndex(e => e.wakeUpId === wakeUpId);
      const replyPreview = normalizeSummaryPreview(opts?.replyText);
      if (idx >= 0) {
        log[idx].engagement = engagement;
        if (replyPreview) log[idx].replyPreview = replyPreview;
        fs.writeFileSync(p, JSON.stringify(log, null, 2), 'utf-8');
      }
      proactiveService.updateSessionSummary(wakeUpId, {
        notificationEngagement: engagement,
        ...(replyPreview ? { userReplyPreview: replyPreview } : {}),
      });
    } catch (e) {
      logger.warn('[proactive] Failed to update notification engagement:', e);
    }
  },

  getRecentNotifications(limit = 15, opts?: { botId?: string }): NotificationLogEntry[] {
    try {
      let log = loadNotificationLog();
      if (opts?.botId !== undefined) {
        const id = effectiveBotId(opts.botId);
        log = log.filter(e => effectiveBotId(e.botId) === id);
      }
      return log.slice(0, limit);
    } catch {
      return [];
    }
  },

  /** Build a compact digest of recent notifications for the agent's context */
  getNotificationDigest(limit = 8, opts?: { botId?: string }): string[] {
    try {
      let log = loadNotificationLog();
      if (opts?.botId !== undefined) {
        const id = effectiveBotId(opts.botId);
        log = log.filter(e => effectiveBotId(e.botId) === id);
      }
      return log.slice(0, limit).map(entry => {
        const timeAgo = getTimeAgo(entry.at);
        const eng = entry.engagement === 'replied' ? '(user replied)'
          : entry.engagement === 'dismissed' ? '(dismissed)'
          : entry.engagement === 'ignored' ? '(no response)'
          : '(pending)';
        const msg = (entry.message || '').slice(0, 120);
        const replyPreview = entry.replyPreview ? ` Reply: "${entry.replyPreview}"` : '';
        return `[${timeAgo}] ${msg} ${eng}${replyPreview}`;
      });
    } catch {
      return [];
    }
  },
};

// ── Session summaries persistence ────────────────────────────────────────────

interface SessionSummaryEntry {
  summary: string;
  at: string;
  wakeUpId?: string;
  notificationEngagement?: NotificationEngagement;
  userReplyPreview?: string;
  botId?: string;
}

function sessionSummariesPath(): string {
  return path.join(app.getPath('userData'), 'proactive-session-summaries.json');
}

function loadSessionSummaries(): SessionSummaryEntry[] {
  try {
    const p = sessionSummariesPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Array.isArray(data)
        ? data
          .map((entry: any) => ({
            summary: typeof entry?.summary === 'string' ? entry.summary : '',
            at: typeof entry?.at === 'string' ? entry.at : new Date().toISOString(),
            wakeUpId: typeof entry?.wakeUpId === 'string' && entry.wakeUpId.trim() ? entry.wakeUpId.trim() : undefined,
            notificationEngagement: normalizeNotificationEngagement(entry?.notificationEngagement),
            userReplyPreview: normalizeSummaryPreview(entry?.userReplyPreview),
            botId: typeof entry?.botId === 'string' && entry.botId.trim() ? entry.botId.trim() : undefined,
          }))
          .filter((entry: SessionSummaryEntry) => !!entry.summary.trim())
        : [];
    }
  } catch {}
  return [];
}

// ── Notification log persistence ─────────────────────────────────────────────

export interface NotificationLogEntry {
  id: string;
  wakeUpId: string;
  message: string;
  channel: string;
  urgency: string;
  engagement: NotificationEngagement;
  at: string;
  replyPreview?: string;
  botId?: string;
}

function notificationLogPath(): string {
  return path.join(app.getPath('userData'), 'proactive-notification-log.json');
}

function loadNotificationLog(): NotificationLogEntry[] {
  try {
    const p = notificationLogPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Array.isArray(data)
        ? data
          .map((entry: any) => ({
            id: String(entry?.id || `notif_${Date.now()}`),
            wakeUpId: String(entry?.wakeUpId || ''),
            message: String(entry?.message || ''),
            channel: String(entry?.channel || ''),
            urgency: String(entry?.urgency || ''),
            engagement: normalizeNotificationEngagement(entry?.engagement) || 'pending',
            at: typeof entry?.at === 'string' ? entry.at : new Date().toISOString(),
            replyPreview: normalizeSummaryPreview(entry?.replyPreview),
            botId: typeof entry?.botId === 'string' && entry.botId.trim() ? entry.botId.trim() : undefined,
          }))
          .filter((entry: NotificationLogEntry) => !!entry.wakeUpId)
        : [];
    }
  } catch {}
  return [];
}

function normalizeNotificationEngagement(value: any): NotificationEngagement | undefined {
  if (value === 'pending' || value === 'replied' || value === 'dismissed' || value === 'ignored') return value;
  return undefined;
}

function normalizeSummaryPreview(value: any): string | undefined {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

function describeNotificationEngagement(value: NotificationEngagement): string {
  if (value === 'replied') return 'user replied';
  if (value === 'dismissed') return 'dismissed';
  if (value === 'ignored') return 'ignored';
  return 'pending';
}

function getTimeAgo(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return 'recently';
  }
}
