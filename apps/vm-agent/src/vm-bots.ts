/**
 * VM Bot Scheduler
 *
 * Runs the user's cloud-target bots on the VM autonomously. A multi-bot
 * scheduler that:
 *
 *  - Persists `bots.json` (the cloud-target subset of the user's bots) on disk
 *  - Registers a node-cron job per `schedule.cron` trigger (TZ-aware)
 *  - Runs a master 30s tick that fires `schedule.interval` triggers when due
 *  - Calls cloud-ai's `/v1/bot/wakeup` per fire and applies kanban mutations
 *
 * Source-of-truth split:
 *   - Desktop owns the bot *config* (system prompt, triggers, allowedTools, …)
 *     and pushes it via the `bots_sync` command.
 *   - VM owns *runtime state* (lastRunAt / nextRunAt / lastOutcome) for cloud
 *     bots; the desktop UI fetches it via the `bots_status` command.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { mintVMToken } from './lib/vm-token-mint';
import { buildVMMemoryContext } from './vm-agent-ws';
import { getActiveSkillsForBot } from './vm-skills';
import { appendVMBotRunLog, deleteVMBotMemory, formatVMBotMemoryForPrompt, mergeVMBotMemory } from './vm-bot-memory';
import { intervalDelayMs } from '@stuardai/bots-core';

let nodeCron: any = null;
try { nodeCron = require('node-cron'); } catch { /* optional — interval triggers still work */ }

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the desktop's BotConfig / Bot / BotTrigger shapes
// ─────────────────────────────────────────────────────────────────────────────

export type VMBotStatus = 'paused' | 'running' | 'errored';
export type VMBotTriggerType =
  | 'schedule.interval'
  | 'schedule.cron'
  | 'webhook'
  | 'gmail.new_email'
  | 'manual';

export interface VMBotTrigger {
  id: string;
  type: VMBotTriggerType;
  args: Record<string, any>;
  enabled?: boolean;
}

export interface VMBotConfig {
  interval: string;            // '10m' | '15m' | '30m' | '1h' | '2h' | 'random' | 'manual'
  modelMode: 'auto' | 'fast' | 'balanced' | 'smart';
  modelId?: string;
  modelConfig?: any;
  instructions: string;        // composed: identity + facts + focus, built on desktop
  allowedTools: string[];
  permissionMode?: 'auto' | 'selective' | 'manual';
  autoApproveTools?: string[];
  notificationChannels: string[];
  memoryEnabled: boolean;
  skillIds?: string[];         // undefined = inherit all globally-active
  skills?: Array<{             // resolved skill payloads, sent at sync time
    id: string;
    name: string;
    description: string;
    trigger: string;
    icon?: string;
    color?: string;
    isActive?: boolean;
    steps?: any[];
  }>;
}

export interface VMBot {
  id: string;
  name: string;
  emoji: string;
  status: VMBotStatus;
  triggers: VMBotTrigger[];
  config: VMBotConfig;
  /** Last server-known run timestamps (set by VM at fire time). */
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: 'success' | 'partial' | 'failed';
  lastError?: string;
}

interface BotsFileShape {
  version: 1;
  bots: VMBot[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BOTS_ROOT = process.env.STUARD_BOTS_ROOT || '/home/stuard/bots';
const BOTS_FILE = 'bots.json';
const LOG_FILE = 'bots.log';

const TICK_MS = 30_000;

// Interval→delay math (incl. the 'random' check-in window) is single-sourced
// with the desktop scheduler in @stuardai/bots-core/schedule — see
// computeNextIntervalRunAt below for the VM's last-run anchoring.

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

export class VMBotScheduler {
  private bots = new Map<string, VMBot>();
  private cronJobs = new Map<string, any>();           // `${botId}:${triggerId}` → cron job
  private masterTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>();                // bot ids currently executing
  private started = false;

  constructor() {
    this.ensureDirectories();
    this.load();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private ensureDirectories(): void {
    try { fs.mkdirSync(BOTS_ROOT, { recursive: true }); } catch { /* best-effort */ }
  }

  private load(): void {
    const file = path.join(BOTS_ROOT, BOTS_FILE);
    if (!fs.existsSync(file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw && raw.version === 1 && Array.isArray(raw.bots)) {
        this.bots.clear();
        for (const b of raw.bots) {
          if (b?.id) this.bots.set(String(b.id), normalizeBot(b));
        }
      }
    } catch (e: any) {
      this.log(`Failed to load bots.json: ${e?.message || e}`);
    }
  }

  private save(): void {
    const file: BotsFileShape = { version: 1, bots: Array.from(this.bots.values()) };
    try {
      fs.writeFileSync(path.join(BOTS_ROOT, BOTS_FILE), JSON.stringify(file, null, 2));
    } catch (e: any) {
      this.log(`Failed to save bots.json: ${e?.message || e}`);
    }
  }

  // ── Public surface ──────────────────────────────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;

    // Re-register cron jobs for every bot we have on disk.
    for (const bot of this.bots.values()) this.registerBotCronJobs(bot);

    // Master tick handles interval triggers + cron-fallback dispatching.
    this.masterTimer = setInterval(() => {
      this.tick().catch(err => this.log(`tick failed: ${err?.message || err}`));
    }, TICK_MS);

    this.log(`Scheduler started (${this.bots.size} bot${this.bots.size === 1 ? '' : 's'} loaded)`);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.masterTimer) {
      clearInterval(this.masterTimer);
      this.masterTimer = null;
    }
    for (const job of this.cronJobs.values()) {
      try { job.stop?.(); } catch { /* ignore */ }
    }
    this.cronJobs.clear();
    this.log('Scheduler stopped');
  }

  /**
   * Replace the bot set with `incoming` (full sync from the desktop). Bots
   * not present in `incoming` are removed; new ones get a freshly-computed
   * `nextRunAt` so they fire at the right time without an immediate burst.
   */
  syncBots(incoming: VMBot[]): VMBot[] {
    const incomingById = new Map<string, VMBot>();
    for (const raw of incoming) {
      if (!raw?.id) continue;
      const id = String(raw.id);
      const existing = this.bots.get(id);
      const next = normalizeBot(raw);
      if (existing) {
        // Preserve runtime state across config updates.
        next.lastRunAt = existing.lastRunAt ?? next.lastRunAt ?? null;
        next.lastOutcome = existing.lastOutcome ?? next.lastOutcome;
        next.lastError = existing.lastError ?? next.lastError;
      }
      next.nextRunAt = computeNextIntervalRunAt(next, next.lastRunAt);
      if ((raw as any).memory && typeof (raw as any).memory === 'object') {
        mergeVMBotMemory(id, (raw as any).memory);
      }
      incomingById.set(id, next);
    }

    // Tear down cron jobs for removed bots (or ones whose triggers changed).
    for (const id of Array.from(this.bots.keys())) {
      if (!incomingById.has(id)) this.unregisterBotCronJobs(id);
    }
    for (const [id] of incomingById) {
      this.unregisterBotCronJobs(id); // idempotent — re-register fresh below
    }

    this.bots = incomingById;
    this.save();

    if (this.started) {
      for (const bot of this.bots.values()) this.registerBotCronJobs(bot);
    }

    this.log(`Synced ${this.bots.size} bot${this.bots.size === 1 ? '' : 's'}`);
    return Array.from(this.bots.values());
  }

  listBots(): VMBot[] {
    return Array.from(this.bots.values());
  }

  getBot(id: string): VMBot | null {
    return this.bots.get(id) || null;
  }

  deleteBot(id: string): { ok: boolean; error?: string; bot?: VMBot } {
    const bot = this.bots.get(id);
    if (!bot) return { ok: false, error: 'agent_not_found' };

    this.unregisterBotCronJobs(id);
    this.inFlight.delete(id);
    this.bots.delete(id);
    this.save();
    deleteVMBotMemory(id);
    this.log(`Deleted agent ${id} (${bot.name})`);
    return { ok: true, bot };
  }

  /** Status snapshot suitable for shipping back to the desktop. */
  getStatus(): {
    started: boolean;
    botCount: number;
    bots: Array<{
      id: string;
      name: string;
      status: VMBotStatus;
      lastRunAt: string | null;
      nextRunAt: string | null;
      lastOutcome?: 'success' | 'partial' | 'failed';
      lastError?: string;
      isRunning: boolean;
    }>;
  } {
    return {
      started: this.started,
      botCount: this.bots.size,
      bots: Array.from(this.bots.values()).map(b => ({
        id: b.id,
        name: b.name,
        status: b.status,
        lastRunAt: b.lastRunAt ?? null,
        nextRunAt: b.nextRunAt ?? null,
        lastOutcome: b.lastOutcome,
        lastError: b.lastError,
        isRunning: this.inFlight.has(b.id),
      })),
    };
  }

  /** Force-run a bot now, regardless of nextRunAt. Returns the wakeup result. */
  async runBotManual(id: string): Promise<{ ok: boolean; error?: string; text?: string }> {
    const bot = this.bots.get(id);
    if (!bot) return { ok: false, error: 'bot_not_found' };
    return this.runBot(bot, { manual: true });
  }

  /**
   * Start a manual bot run and return as soon as the VM accepted it.
   * Cloud-ai's command relay has a short HTTP timeout, while wakeups can take
   * minutes; the final outcome is recorded by recordRun when the wakeup ends.
   */
  triggerBotManual(id: string): { ok: boolean; accepted?: boolean; error?: string } {
    const bot = this.bots.get(id);
    if (!bot) return { ok: false, error: 'bot_not_found' };
    if (this.inFlight.has(id)) return { ok: false, error: 'already_running' };

    this.runBot(bot, { manual: true }).catch(err =>
      this.log(`manual bot ${id} run failed: ${err?.message || err}`),
    );

    return { ok: true, accepted: true };
  }

  // ── Tick loop ───────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const bot of this.bots.values()) {
      if (bot.status !== 'running') continue;
      if (this.inFlight.has(bot.id)) continue;
      if (!bot.nextRunAt) continue;
      const due = new Date(bot.nextRunAt).getTime();
      if (Number.isFinite(due) && due <= now) {
        // Fire-and-forget — the runner schedules the next nextRunAt itself.
        this.runBot(bot, {}).catch(err =>
          this.log(`bot ${bot.id} run failed: ${err?.message || err}`),
        );
      }
    }
  }

  // ── Cron registration ───────────────────────────────────────────────────────

  private registerBotCronJobs(bot: VMBot): void {
    if (bot.status !== 'running') return;
    if (!nodeCron || typeof nodeCron.schedule !== 'function') return;

    for (const trigger of bot.triggers) {
      if (trigger.enabled === false) continue;
      if (trigger.type !== 'schedule.cron') continue;
      const expr = String(trigger.args?.expr || '').trim();
      if (!expr) continue;
      const tz = (typeof trigger.args?.tz === 'string' && trigger.args.tz) || process.env.TZ;

      const jobKey = `${bot.id}:${trigger.id}`;
      try {
        const job = nodeCron.schedule(
          expr,
          () => {
            this.runBot(bot, { triggerId: trigger.id }).catch(err =>
              this.log(`cron fire ${jobKey} failed: ${err?.message || err}`),
            );
          },
          tz ? { timezone: tz } : undefined,
        );
        try { job.start?.(); } catch { /* some versions auto-start */ }
        this.cronJobs.set(jobKey, job);
        this.log(`Registered cron ${expr} for ${jobKey}${tz ? ` (tz=${tz})` : ''}`);
      } catch (e: any) {
        this.log(`Failed to register cron "${expr}" for ${jobKey}: ${e?.message || e}`);
      }
    }
  }

  private unregisterBotCronJobs(botId: string): void {
    for (const [key, job] of Array.from(this.cronJobs.entries())) {
      if (!key.startsWith(`${botId}:`)) continue;
      try { job.stop?.(); } catch { /* ignore */ }
      this.cronJobs.delete(key);
    }
  }

  // ── Run a bot ───────────────────────────────────────────────────────────────

  private async runBot(
    bot: VMBot,
    opts: { triggerId?: string; manual?: boolean },
  ): Promise<{ ok: boolean; error?: string; text?: string }> {
    if (this.inFlight.has(bot.id)) return { ok: false, error: 'already_running' };
    this.inFlight.add(bot.id);
    const startedAt = new Date().toISOString();
    bot.lastRunAt = startedAt;
    bot.nextRunAt = computeNextIntervalRunAt(bot, startedAt);
    this.save();

    try {
      const cloudUrl = (process.env.CLOUD_AI_URL || process.env.CLOUD_PUBLIC_URL || 'http://localhost:8082').replace(/\/+$/, '');
      const userId = process.env.STUARD_USER_ID || '';
      const vmSecret = process.env.VM_TOKEN_SECRET || '';
      if (!userId || !vmSecret) {
        const error = 'missing STUARD_USER_ID or VM_TOKEN_SECRET';
        this.recordRun(bot, { startedAt, ok: false, error });
        return { ok: false, error };
      }

      // Memory context from the VM's local Python agent — keeps responses
      // personalised even though the run originates here.
      let memoryContext: string | undefined;
      let kanbanContext: string | undefined;
      if (bot.config.memoryEnabled !== false) {
        try {
          memoryContext = await buildVMMemoryContext(bot.config.instructions || `${bot.name} check-in`);
        } catch { /* non-fatal */ }
        kanbanContext = formatVMBotMemoryForPrompt(bot.id);
      }

      const token = mintVMToken(vmSecret, userId, 'vm-bots');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);

      let text = '';
      try {
        const resp = await fetch(`${cloudUrl}/v1/bot/wakeup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-VM-User-Id': userId,
            'X-Source': 'vm-bots',
          },
          body: JSON.stringify({
            botId: bot.id,
            botName: bot.name,
            triggerId: opts.triggerId,
            manual: !!opts.manual,
            config: {
              instructions: bot.config.instructions || '',
              allowedTools: bot.config.allowedTools || [],
              permissionMode: bot.config.permissionMode || 'selective',
              autoApproveTools: bot.config.autoApproveTools || [],
              modelMode: bot.config.modelMode || 'balanced',
              modelId: bot.config.modelId,
              modelConfig: bot.config.modelConfig,
              notificationChannels: bot.config.notificationChannels || ['app'],
              memoryEnabled: bot.config.memoryEnabled !== false,
            },
            memoryContext,
            kanbanContext,
            skills: getActiveSkillsForBot(bot.config.skillIds),
            context: {
              isVM: true,
              hostname: os.hostname(),
              uptime: process.uptime(),
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          const error = `wakeup http ${resp.status}: ${body.slice(0, 200)}`;
          this.recordRun(bot, { startedAt, ok: false, error });
          return { ok: false, error };
        }

        const data = await resp.json() as any;
        text = String(data?.text || '');
        const ok = data?.ok !== false;
        this.recordRun(bot, {
          startedAt,
          ok,
          partial: ok && !!data?.failureReason,
          error: ok ? undefined : (typeof data?.error === 'string' ? data.error : 'wakeup_failed'),
          text,
        });
        return { ok, text, error: ok ? undefined : (typeof data?.error === 'string' ? data.error : undefined) };
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      const error = e?.name === 'AbortError' ? 'wakeup_timeout' : (e?.message || 'wakeup_failed');
      this.recordRun(bot, { startedAt, ok: false, error });
      return { ok: false, error };
    } finally {
      this.inFlight.delete(bot.id);
    }
  }

  private recordRun(
    bot: VMBot,
    info: { startedAt: string; ok: boolean; partial?: boolean; error?: string; text?: string },
  ): void {
    bot.lastRunAt = info.startedAt;
    bot.lastOutcome = info.ok ? (info.partial ? 'partial' : 'success') : 'failed';
    bot.lastError = info.ok ? undefined : info.error;
    bot.nextRunAt = computeNextIntervalRunAt(bot, info.startedAt);
    this.save();

    const summary = info.ok
      ? `ok${info.partial ? ' (partial)' : ''}: ${(info.text || '').slice(0, 120)}`
      : `failed: ${info.error || 'unknown'}`;
    appendVMBotRunLog(bot.id, {
      summary,
      outcome: info.ok ? (info.partial ? 'partial' : 'success') : 'failed',
    });
    this.log(`Ran ${bot.id} (${bot.name}) → ${summary}`);
  }

  // ── Logging ─────────────────────────────────────────────────────────────────

  private log(...args: string[]): void {
    const line = `[${new Date().toISOString()}] [vm-bots] ${args.join(' ')}`;
    console.log(line);
    try {
      const p = path.join(BOTS_ROOT, LOG_FILE);
      fs.appendFileSync(p, line + '\n');
      const stat = fs.statSync(p);
      if (stat.size > 2 * 1024 * 1024) {
        const buf = fs.readFileSync(p, 'utf-8');
        fs.writeFileSync(p, buf.split('\n').slice(-500).join('\n'));
      }
    } catch { /* ignore */ }
  }

  destroy(): void {
    this.stop();
    this.save();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeBot(raw: any): VMBot {
  const triggers: VMBotTrigger[] = Array.isArray(raw?.triggers)
    ? raw.triggers.map((t: any) => ({
        id: String(t?.id || `trig_${Math.random().toString(36).slice(2, 8)}`),
        type: String(t?.type || 'manual') as VMBotTriggerType,
        args: t?.args && typeof t.args === 'object' ? t.args : {},
        enabled: t?.enabled !== false,
      }))
    : [];

  const cfgRaw = raw?.config || {};
  const config: VMBotConfig = {
    interval: typeof cfgRaw.interval === 'string' ? cfgRaw.interval : '30m',
    modelMode: (cfgRaw.modelMode === 'auto' || cfgRaw.modelMode === 'fast' || cfgRaw.modelMode === 'smart') ? cfgRaw.modelMode : 'balanced',
    modelId: typeof cfgRaw.modelId === 'string' ? cfgRaw.modelId : undefined,
    modelConfig: cfgRaw.modelConfig && typeof cfgRaw.modelConfig === 'object' ? cfgRaw.modelConfig : undefined,
    instructions: typeof cfgRaw.instructions === 'string' ? cfgRaw.instructions : '',
    allowedTools: Array.isArray(cfgRaw.allowedTools) ? cfgRaw.allowedTools.map((x: any) => String(x)) : [],
    permissionMode: (cfgRaw.permissionMode === 'auto' || cfgRaw.permissionMode === 'manual' || cfgRaw.permissionMode === 'selective')
      ? cfgRaw.permissionMode
      : 'selective',
    autoApproveTools: Array.isArray(cfgRaw.autoApproveTools) ? cfgRaw.autoApproveTools.map((x: any) => String(x)) : [],
    notificationChannels: Array.isArray(cfgRaw.notificationChannels) && cfgRaw.notificationChannels.length
      ? cfgRaw.notificationChannels.map((x: any) => String(x))
      : ['app'],
    memoryEnabled: cfgRaw.memoryEnabled !== false,
    skillIds: Array.isArray(cfgRaw.skillIds) ? cfgRaw.skillIds.map((x: any) => String(x)) : undefined,
    skills: Array.isArray(cfgRaw.skills) ? cfgRaw.skills : undefined,
  };

  return {
    id: String(raw?.id || ''),
    name: typeof raw?.name === 'string' && raw.name ? raw.name : 'Bot',
    emoji: typeof raw?.emoji === 'string' ? raw.emoji : '🤖',
    status: (raw?.status === 'running' || raw?.status === 'errored') ? raw.status : 'paused',
    triggers,
    config,
    lastRunAt: typeof raw?.lastRunAt === 'string' ? raw.lastRunAt : null,
    nextRunAt: typeof raw?.nextRunAt === 'string' ? raw.nextRunAt : null,
    lastOutcome: raw?.lastOutcome,
    lastError: typeof raw?.lastError === 'string' ? raw.lastError : undefined,
  };
}

/**
 * For a bot, find the soonest time the schedule.interval trigger should fire
 * relative to the supplied anchor (typically the last run time, or now if the
 * bot has never run). Cron triggers don't go through this — node-cron owns
 * their dispatch.
 */
function computeNextIntervalRunAt(bot: VMBot, anchor: string | null | undefined): string | null {
  const intervalTrigger = bot.triggers.find(
    t => t.type === 'schedule.interval' && t.enabled !== false,
  );
  if (!intervalTrigger) return null;
  const every = String(intervalTrigger.args?.every || bot.config.interval || '30m');
  const ms = intervalDelayMs(every);
  if (ms === null) return null;
  const baseMs = anchor ? new Date(anchor).getTime() : Date.now();
  if (!Number.isFinite(baseMs)) return new Date(Date.now() + ms).toISOString();
  return new Date(baseMs + ms).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let _instance: VMBotScheduler | null = null;

export function getVMBotScheduler(): VMBotScheduler {
  if (!_instance) _instance = new VMBotScheduler();
  return _instance;
}
