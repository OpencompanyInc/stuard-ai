/**
 * VM Proactive Scheduler
 *
 * Runs a periodic proactive agent on the VM that:
 * - Checks for pending tasks and follow-ups
 * - Monitors system health and workflow status
 * - Sends notifications via cloud-ai (SMS, desktop)
 * - Maintains a local task kanban
 *
 * This mirrors the desktop proactive scheduler but runs headlessly.
 * Communication with cloud-ai happens via HTTP relay.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { mintVMToken } from '../services/vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProactiveTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deferred' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: 'agent' | 'user' | 'workflow' | 'system';
  createdAt: string;
  updatedAt: string;
  dueAt?: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface ProactiveConfig {
  enabled: boolean;
  intervalMs: number;     // How often to wake up (default: 15 min)
  modelMode: 'fast' | 'balanced' | 'smart';
  channels: string[];     // 'sms', 'desktop-notification'
  maxFollowUps: number;
  quietHoursStart?: number; // 0-23 (hour in UTC)
  quietHoursEnd?: number;
}

interface WakeupResult {
  text: string;
  taskUpdates: Array<{ id: string; status: string }>;
  newTasks: ProactiveTask[];
  deletedTaskIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROACTIVE_ROOT = process.env.STUARD_PROACTIVE_ROOT || '/home/stuard/proactive';
const TASKS_FILE = 'tasks.json';
const CONFIG_FILE = 'config.json';
const LOG_FILE = 'proactive.log';

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  intervalMs: 15 * 60 * 1000, // 15 minutes
  modelMode: 'balanced',
  channels: [],
  maxFollowUps: 20,
};

// ─────────────────────────────────────────────────────────────────────────────
// Proactive Scheduler
// ─────────────────────────────────────────────────────────────────────────────

export class VMProactiveScheduler {
  private tasks = new Map<string, ProactiveTask>();
  private config: ProactiveConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private lastWakeup: number = 0;
  private consecutiveFailures = 0;

  constructor() {
    this.ensureDirectories();
    this.config = this.loadConfig();
    this.loadTasks();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(PROACTIVE_ROOT, { recursive: true });
  }

  // ── Config ──

  private loadConfig(): ProactiveConfig {
    const configPath = path.join(PROACTIVE_ROOT, CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return { ...DEFAULT_CONFIG, ...data };
      } catch { /* ignore */ }
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    fs.writeFileSync(
      path.join(PROACTIVE_ROOT, CONFIG_FILE),
      JSON.stringify(this.config, null, 2)
    );
  }

  getConfig(): ProactiveConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ProactiveConfig>): ProactiveConfig {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    // Restart scheduler if interval changed
    if (updates.intervalMs !== undefined || updates.enabled !== undefined) {
      this.stop();
      if (this.config.enabled) this.start();
    }

    return { ...this.config };
  }

  // ── Tasks ──

  private loadTasks(): void {
    const tasksPath = path.join(PROACTIVE_ROOT, TASKS_FILE);
    if (fs.existsSync(tasksPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const task of data) {
            if (task?.id) this.tasks.set(task.id, task);
          }
        }
      } catch { /* ignore */ }
    }
  }

  private saveTasks(): void {
    const arr = Array.from(this.tasks.values());
    fs.writeFileSync(
      path.join(PROACTIVE_ROOT, TASKS_FILE),
      JSON.stringify(arr, null, 2)
    );
  }

  addTask(task: Omit<ProactiveTask, 'id' | 'createdAt' | 'updatedAt'>): ProactiveTask {
    const now = new Date().toISOString();
    const fullTask: ProactiveTask = {
      id: randomUUID(),
      ...task,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(fullTask.id, fullTask);
    this.saveTasks();
    return fullTask;
  }

  updateTask(id: string, updates: Partial<ProactiveTask>): ProactiveTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    if (updates.status === 'completed') {
      task.completedAt = new Date().toISOString();
    }
    this.saveTasks();
    return task;
  }

  deleteTask(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) this.saveTasks();
    return existed;
  }

  listTasks(filters?: { status?: string; priority?: string }): ProactiveTask[] {
    let results = Array.from(this.tasks.values());
    if (filters?.status) {
      results = results.filter(t => t.status === filters.status);
    }
    if (filters?.priority) {
      results = results.filter(t => t.priority === filters.priority);
    }
    return results.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  // ── Scheduler ──

  start(): void {
    if (this.timer || !this.config.enabled) return;

    this.log('Proactive scheduler started', `interval=${this.config.intervalMs}ms`);
    this.timer = setInterval(() => {
      this.wakeup().catch(err => {
        this.log('Wakeup failed:', String(err?.message || err));
      });
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.log('Proactive scheduler stopped');
  }

  getStatus(): {
    enabled: boolean;
    running: boolean;
    lastWakeup: number;
    nextWakeup: number;
    taskCount: number;
    pendingTasks: number;
    consecutiveFailures: number;
  } {
    return {
      enabled: this.config.enabled,
      running: this.isRunning,
      lastWakeup: this.lastWakeup,
      nextWakeup: this.lastWakeup > 0 ? this.lastWakeup + this.config.intervalMs : 0,
      taskCount: this.tasks.size,
      pendingTasks: Array.from(this.tasks.values()).filter(t => t.status === 'pending' || t.status === 'in_progress').length,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Perform a proactive wakeup — call cloud-ai's proactive endpoint.
   */
  async wakeup(): Promise<WakeupResult | null> {
    if (this.isRunning) return null;

    // Quiet hours check
    if (this.config.quietHoursStart !== undefined && this.config.quietHoursEnd !== undefined) {
      const hour = new Date().getUTCHours();
      const { quietHoursStart, quietHoursEnd } = this.config;
      if (quietHoursStart < quietHoursEnd) {
        if (hour >= quietHoursStart && hour < quietHoursEnd) return null;
      } else {
        if (hour >= quietHoursStart || hour < quietHoursEnd) return null;
      }
    }

    this.isRunning = true;
    this.lastWakeup = Date.now();

    try {
      const cloudAiUrl = process.env.CLOUD_AI_URL
        || process.env.CLOUD_PUBLIC_URL
        || 'http://localhost:8082';
      const userId = process.env.STUARD_USER_ID || '';
      const vmSecret = process.env.VM_TOKEN_SECRET || '';

      if (!userId || !vmSecret) {
        this.log('Skipping wakeup: missing STUARD_USER_ID or VM_TOKEN_SECRET');
        return null;
      }

      const token = mintVMToken(vmSecret, userId, 'vm-proactive');
      const pendingTasks = this.listTasks({ status: 'pending' });
      const inProgressTasks = this.listTasks({ status: 'in_progress' });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000); // 3 min timeout

      try {
        const resp = await fetch(`${cloudAiUrl}/v1/proactive/wakeup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-VM-User-Id': userId,
            'X-Source': 'vm-proactive',
          },
          body: JSON.stringify({
            tasks: [...pendingTasks, ...inProgressTasks],
            config: {
              modelMode: this.config.modelMode,
            },
            channels: this.config.channels,
            vmContext: {
              isVM: true,
              hostname: require('os').hostname(),
              uptime: process.uptime(),
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!resp.ok) {
          const err = await resp.text().catch(() => '');
          this.log(`Wakeup HTTP ${resp.status}: ${err}`);
          this.consecutiveFailures++;
          return null;
        }

        const result: WakeupResult = await resp.json() as any;
        this.consecutiveFailures = 0;

        // Apply task updates
        if (result.taskUpdates) {
          for (const update of result.taskUpdates) {
            this.updateTask(update.id, { status: update.status as any });
          }
        }

        // Add new tasks
        if (result.newTasks) {
          for (const task of result.newTasks) {
            this.addTask(task);
          }
        }

        // Delete tasks
        if (result.deletedTaskIds) {
          for (const id of result.deletedTaskIds) {
            this.deleteTask(id);
          }
        }

        if (result.text) {
          this.log(`Proactive response: ${result.text.slice(0, 200)}`);
        }

        return result;
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      this.consecutiveFailures++;
      this.log(`Wakeup error: ${e?.message || e}`);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  // ── Logging ──

  private log(...args: string[]): void {
    const line = `[${new Date().toISOString()}] [proactive] ${args.join(' ')}`;
    console.log(line);
    try {
      const logPath = path.join(PROACTIVE_ROOT, LOG_FILE);
      fs.appendFileSync(logPath, line + '\n');
      // Truncate log if too large
      const stats = fs.statSync(logPath);
      if (stats.size > 2 * 1024 * 1024) {
        const content = fs.readFileSync(logPath, 'utf-8');
        fs.writeFileSync(logPath, content.split('\n').slice(-500).join('\n'));
      }
    } catch { /* ignore */ }
  }

  destroy(): void {
    this.stop();
    this.saveTasks();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: VMProactiveScheduler | null = null;

export function getVMProactiveScheduler(): VMProactiveScheduler {
  if (!_instance) {
    _instance = new VMProactiveScheduler();
  }
  return _instance;
}
