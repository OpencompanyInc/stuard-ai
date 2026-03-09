import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

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

interface WakeUpLog {
  id: string;
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

  listTasks(): { ok: true; tasks: ProactiveTask[] } {
    return { ok: true, tasks: loadData().tasks };
  },

  addTask(task: Partial<ProactiveTask>): { ok: true; task: ProactiveTask; tasks: ProactiveTask[] } {
    const data = loadData();
    const now = new Date().toISOString();
    const newTask: ProactiveTask = {
      id: `ptask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

  getQueuedTasks(): ProactiveTask[] {
    return loadData().tasks.filter(t => t.status === 'queued');
  },

  getActiveTasks(): ProactiveTask[] {
    return loadData().tasks.filter(t => t.status === 'queued' || t.status === 'in_progress');
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

  applyNewTasks(newTasks: Array<{ title: string; instructions?: string; status?: ProactiveTask['status'] }>): { ok: true; tasks: ProactiveTask[] } {
    const data = loadData();
    const now = new Date().toISOString();
    for (const t of newTasks) {
      const task: ProactiveTask = {
        id: `ptask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
    data.wakeUpLog.unshift(log);
    if (data.wakeUpLog.length > 100) data.wakeUpLog = data.wakeUpLog.slice(0, 100);
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

  getWakeUpLog(limit = 20): { ok: true; logs: WakeUpLog[] } {
    const data = loadData();
    return { ok: true, logs: data.wakeUpLog.slice(0, limit) };
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
};
