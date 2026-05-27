import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { proactiveService } from './proactive-service';
import type {
  ScheduleInterval,
  ExecutionTarget,
  ProactiveModelMode,
  ProactiveContextPermissions,
  NotificationChannel,
} from '../../renderer/types/proactive';

// ─── Types ─────────────────────────────────────────────────────────────────

export type BotStatus = 'paused' | 'running' | 'errored';
export type DeployTarget = ExecutionTarget; // 'local' | 'cloud'; 'vm' coming later

/**
 * A trigger is one way a bot can wake up. A bot can have many triggers; ANY
 * one firing causes a run. Type strings intentionally mirror the workflow
 * trigger taxonomy (`schedule.cron`, `webhook`, `gmail.new_email`, …) so the
 * cloud dispatch pipeline can route the same primitives to either subscribers.
 *
 * args is intentionally loose — each type defines its own shape:
 *   schedule.interval: { every: '10m' | '15m' | '30m' | '1h' | '2h' | 'random' }
 *   schedule.cron:     { expr: string; tz?: string }
 *   webhook:           { slug: string; url?: string; secret?: string; createdAt: string; lastFiredAt?: string | null }
 *   fs.watch:          { path: string; pattern?: string; recursive?: boolean; events?: string[]; debounceMs?: number }
 *   command.watch:     { cmd: string; args?: string[]; cwd?: string; fireOn?: Array<'stdout' | 'stderr' | 'exit'> }
 *   gmail.new_email:   { from?: string; subjectContains?: string; integrationId?: string }
 *   manual:            {}
 */
export type BotTriggerType =
  | 'schedule.interval'
  | 'schedule.cron'
  | 'webhook'
  | 'fs.watch'
  | 'command.watch'
  | 'gmail.new_email'
  | 'manual';

export interface BotTrigger {
  id: string;
  type: BotTriggerType;
  args: Record<string, any>;
  enabled?: boolean;
  label?: string;
  /**
   * Whether the trigger requires cloud-side registration to actually fire
   * (webhooks, Gmail). Kept on the row for the UI; the dispatcher reads it.
   */
  requiresCloud?: boolean;
}

export interface BotConfig {
  interval: ScheduleInterval;
  executionTarget: DeployTarget;
  modelMode: ProactiveModelMode;
  modelId?: string;
  instructions: string;
  contextPermissions: ProactiveContextPermissions;
  allowedTools: string[];
  notificationChannels: NotificationChannel[];
  /**
   * If true, the bot may use the memory tool (search_past_conversations etc.)
   * to recall past runs and user context. On by default.
   */
  memoryEnabled: boolean;
  /**
   * Per-bot skill selection. Each entry is a skill id from skills.json.
   * - undefined  → inherit all globally-active skills (legacy behavior, kept for migration)
   * - []         → no skills (explicit opt-out)
   * - [ids…]     → only these skills (intersected with globally-active)
   */
  skillIds?: string[];
}

export interface Bot {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  /**
   * User-curated memory facts. Concatenated into the bot's system prompt at
   * run time so the bot "remembers" them across runs. Free-form, plain text,
   * one fact per line is the convention but not enforced.
   */
  storedFacts: string;
  /**
   * Wake-up triggers. ANY firing causes a run. Pre-trigger-system bots are
   * migrated on read by synthesizing a single `schedule.interval` trigger
   * from their `BotConfig.interval` — see `migrateBotTriggers`.
   */
  triggers: BotTrigger[];
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  /**
   * VM mirror state. When non-null, the bot's config has been pushed to the
   * user's cloud VM and the VM is also running it 24/7. Local execution
   * continues regardless — VM deploy is additive ("also run in the cloud"),
   * not a swap. `vmDeployedAt` records the last successful push.
   */
  vmDeployedAt?: string | null;
  /**
   * The legacy default bot delegates its config to proactiveService so the
   * existing proactive-data.json remains the single source of truth during
   * migration. New bots store their config inline.
   */
  isLegacyDefault?: boolean;
  config?: BotConfig;
}

interface BotsFile {
  version: 1;
  bots: Bot[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_BOT_ID = 'bot_default';

const DEFAULT_BOT_NAME = 'Stuard';
const DEFAULT_BOT_EMOJI = '🤖';

const DEFAULT_BOT_CONFIG: BotConfig = {
  interval: '30m',
  executionTarget: 'local',
  modelMode: 'balanced',
  modelId: '',
  instructions: '',
  contextPermissions: { screenshot: false, systemAudio: false, micAudio: false },
  allowedTools: [],
  notificationChannels: ['app'],
  memoryEnabled: true,
};

// ─── Persistence ───────────────────────────────────────────────────────────

function botsFilePath(): string {
  return path.join(app.getPath('userData'), 'bots.json');
}

function loadBotsFile(): BotsFile | null {
  try {
    const p = botsFilePath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw || raw.version !== 1 || !Array.isArray(raw.bots)) return null;
    return { version: 1, bots: raw.bots.map(normalizeBot) };
  } catch (e) {
    logger.warn('[bot-service] Failed to load bots.json:', e);
    return null;
  }
}

function saveBotsFile(file: BotsFile): void {
  try {
    fs.writeFileSync(botsFilePath(), JSON.stringify(file, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('[bot-service] Failed to save bots.json:', e);
  }
}

function normalizeBot(raw: any): Bot {
  const now = new Date().toISOString();
  const config = raw?.config ? normalizeConfig(raw.config) : undefined;
  const isLegacyDefault = !!raw?.isLegacyDefault;
  // For the legacy default bot, the authoritative interval lives in
  // proactive-data.json. Pull it so the synthesized trigger matches reality.
  let legacyInterval: string | undefined;
  if (isLegacyDefault) {
    try {
      legacyInterval = proactiveService.getConfig().config.interval;
    } catch { /* fall back to default */ }
  }
  const triggers = normalizeTriggers(raw?.triggers, { ...raw, legacyInterval }, config);
  return {
    id: String(raw?.id || ''),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : DEFAULT_BOT_NAME,
    emoji: typeof raw?.emoji === 'string' && raw.emoji ? raw.emoji : DEFAULT_BOT_EMOJI,
    systemPrompt: typeof raw?.systemPrompt === 'string' ? raw.systemPrompt : '',
    storedFacts: typeof raw?.storedFacts === 'string' ? raw.storedFacts : '',
    triggers,
    status: normalizeStatus(raw?.status),
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : now,
    lastRunAt: raw?.lastRunAt ?? null,
    nextRunAt: raw?.nextRunAt ?? null,
    vmDeployedAt: raw?.vmDeployedAt ?? null,
    isLegacyDefault,
    config,
  };
}

const VALID_TRIGGER_TYPES: BotTriggerType[] = [
  'schedule.interval', 'schedule.cron', 'webhook', 'fs.watch', 'command.watch', 'gmail.new_email', 'manual',
];

function normalizeTriggers(rawTriggers: any, rawBot: any, config: BotConfig | undefined): BotTrigger[] {
  if (Array.isArray(rawTriggers) && rawTriggers.length > 0) {
    return rawTriggers
      .map(normalizeTrigger)
      .filter((t): t is BotTrigger => !!t);
  }
  // Migration: synthesize a single schedule.interval trigger from the legacy
  // BotConfig.interval (or the legacy default bot's interval if no inline
  // config exists). This is the safe default that preserves today's behavior.
  const interval = (config?.interval || rawBot?.legacyInterval || '30m') as string;
  const synthesized: BotTrigger = {
    id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'schedule.interval',
    args: { every: interval },
    enabled: true,
    label: 'Schedule',
    requiresCloud: false,
  };
  return [synthesized];
}

function normalizeTrigger(raw: any): BotTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '');
  if (!VALID_TRIGGER_TYPES.includes(type as BotTriggerType)) return null;
  return {
    id: String(raw.id || `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    type: type as BotTriggerType,
    args: raw.args && typeof raw.args === 'object' ? raw.args : {},
    enabled: raw.enabled !== false,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    requiresCloud: type === 'webhook' ? false : typeof raw.requiresCloud === 'boolean'
      ? raw.requiresCloud
      : type === 'gmail.new_email',
  };
}

/**
 * Fills in sensible per-type defaults for any args the caller left blank, so a
 * trigger is never created with an undefined field. Critically this is where a
 * webhook gets its slug/secret — without it a blueprint-provided webhook would
 * have no URL. Mutates and returns the trigger. `botIdHint`/`fallbackInterval`
 * let create() and addTrigger() share identical seeding.
 */
function seedTriggerDefaults(
  trigger: BotTrigger,
  opts: { botIdHint: string; fallbackInterval?: string },
): BotTrigger {
  const args = trigger.args && typeof trigger.args === 'object' ? trigger.args : {};
  if (trigger.type === 'schedule.interval' && !args.every) {
    trigger.args = { ...args, every: opts.fallbackInterval || '30m' };
  } else if (trigger.type === 'schedule.cron' && !args.expr) {
    trigger.args = { ...args, expr: '0 9 * * 2' }; // sensible default: Tue 9am
  } else if (trigger.type === 'webhook' && !args.slug) {
    trigger.args = {
      ...args,
      slug: `bot_${opts.botIdHint.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`,
      secret: Math.random().toString(36).slice(2, 18),
      createdAt: new Date().toISOString(),
      lastFiredAt: null,
    };
  } else if (trigger.type === 'fs.watch' && !args.path) {
    trigger.args = {
      ...args,
      path: '',
      pattern: args.pattern || '**/*',
      recursive: args.recursive !== false,
      events: Array.isArray(args.events) && args.events.length ? args.events : ['add', 'change', 'unlink'],
      debounceMs: typeof args.debounceMs === 'number' ? args.debounceMs : 750,
    };
  } else if (trigger.type === 'command.watch' && !args.cmd) {
    trigger.args = {
      ...args,
      cmd: 'python',
      args: Array.isArray(args.args) ? args.args : ['watcher.py'],
      cwd: args.cwd || '',
      fireOn: Array.isArray(args.fireOn) && args.fireOn.length ? args.fireOn : ['stdout'],
    };
  }
  return trigger;
}

function normalizeStatus(value: any): BotStatus {
  return value === 'running' || value === 'errored' ? value : 'paused';
}

function normalizeConfig(raw: any): BotConfig {
  return {
    ...DEFAULT_BOT_CONFIG,
    ...raw,
    contextPermissions: {
      ...DEFAULT_BOT_CONFIG.contextPermissions,
      ...(raw?.contextPermissions || {}),
    },
    allowedTools: Array.isArray(raw?.allowedTools) ? raw.allowedTools : [],
    notificationChannels: Array.isArray(raw?.notificationChannels) && raw.notificationChannels.length
      ? raw.notificationChannels
      : ['app'],
    memoryEnabled: raw?.memoryEnabled !== false,
    // Preserve `undefined` (legacy → inherit) vs `[]` (explicit opt-out).
    skillIds: Array.isArray(raw?.skillIds) ? raw.skillIds.map((x: any) => String(x)) : undefined,
  };
}

// ─── Migration ─────────────────────────────────────────────────────────────

/**
 * Builds the initial bots.json from the existing proactive-data.json.
 * The legacy default bot delegates its config to proactiveService so we don't
 * duplicate state; new bots will store config inline going forward.
 */
function buildInitialBotsFile(): BotsFile {
  const now = new Date().toISOString();
  // Read the legacy config so we can mirror status/lastRunAt/nextRunAt onto
  // the bot header (config itself stays in proactive-data.json for now).
  let status: BotStatus = 'paused';
  let lastRunAt: string | null = null;
  let nextRunAt: string | null = null;
  try {
    const { config } = proactiveService.getConfig();
    status = config.enabled ? 'running' : 'paused';
    lastRunAt = config.lastWakeUpAt ?? null;
    nextRunAt = config.nextWakeUpAt ?? null;
  } catch (e) {
    logger.warn('[bot-service] Could not read legacy proactive config during migration:', e);
  }

  // Synthesize an initial schedule.interval trigger from the legacy interval
  // so the migrated default bot keeps firing on schedule out of the box.
  let legacyInterval = '30m';
  try { legacyInterval = proactiveService.getConfig().config.interval || '30m'; } catch { /* fallback */ }
  const initialTrigger: BotTrigger = {
    id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: 'schedule.interval',
    args: { every: legacyInterval },
    enabled: true,
    label: 'Schedule',
    requiresCloud: false,
  };

  const defaultBot: Bot = {
    id: DEFAULT_BOT_ID,
    name: DEFAULT_BOT_NAME,
    emoji: DEFAULT_BOT_EMOJI,
    systemPrompt: '',
    storedFacts: '',
    triggers: [initialTrigger],
    status,
    createdAt: now,
    updatedAt: now,
    lastRunAt,
    nextRunAt,
    isLegacyDefault: true,
  };

  return { version: 1, bots: [defaultBot] };
}

/**
 * Returns the bots file, migrating from the legacy single-config layout if
 * this is the first run after upgrade. Once bots.json exists, even an empty
 * list is intentional because the legacy default agent can now be deleted.
 */
function getOrInitBotsFile(): BotsFile {
  const existing = loadBotsFile();
  if (existing) return existing;
  const fresh = buildInitialBotsFile();
  saveBotsFile(fresh);
  logger.info('[bot-service] Initialized bots.json with default bot from legacy proactive config');
  return fresh;
}

// ─── Config bridging (legacy default vs new bots) ──────────────────────────

function legacyConfigToBotConfig(): BotConfig {
  const { config } = proactiveService.getConfig();
  return {
    interval: config.interval as ScheduleInterval,
    executionTarget: config.executionTarget,
    modelMode: config.modelMode,
    modelId: config.modelId,
    instructions: config.instructions || '',
    contextPermissions: { ...config.contextPermissions },
    allowedTools: Array.isArray(config.allowedTools) ? config.allowedTools : [],
    notificationChannels: Array.isArray(config.notificationChannels) && config.notificationChannels.length
      ? (config.notificationChannels as NotificationChannel[])
      : ['app'],
    memoryEnabled: true,
  };
}

function applyConfigPatchToLegacy(patch: Partial<BotConfig>): BotConfig {
  // memoryEnabled and skillIds are bot-row fields, not in legacy proactive config.
  const { memoryEnabled: _omitMem, skillIds: _omitSkills, ...legacyPatch } = patch;
  proactiveService.updateConfig(legacyPatch as any);
  return legacyConfigToBotConfig();
}

// ─── Public API ────────────────────────────────────────────────────────────

export const botService = {
  list(): Bot[] {
    return getOrInitBotsFile().bots;
  },

  get(id: string): Bot | null {
    const file = getOrInitBotsFile();
    return file.bots.find(b => b.id === id) || null;
  },

  create(input: Partial<Bot> & { name: string }): Bot {
    const file = getOrInitBotsFile();
    const now = new Date().toISOString();
    const config = { ...DEFAULT_BOT_CONFIG, ...(input.config || {}) };
    const botId = input.id || `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Seed triggers from the input or synthesize one from the requested interval.
    // Blueprint-provided triggers arrive with partial args; seedTriggerDefaults
    // fills the gaps (notably the webhook slug/secret) the same way addTrigger does.
    const triggers: BotTrigger[] = Array.isArray(input.triggers) && input.triggers.length > 0
      ? input.triggers
          .map(normalizeTrigger)
          .filter((t): t is BotTrigger => !!t)
          .map(t => seedTriggerDefaults(t, { botIdHint: botId, fallbackInterval: config.interval }))
      : [{
          id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'schedule.interval',
          args: { every: config.interval },
          enabled: true,
          label: 'Schedule',
          requiresCloud: false,
        }];

    const bot: Bot = {
      id: botId,
      name: input.name,
      emoji: input.emoji || DEFAULT_BOT_EMOJI,
      systemPrompt: input.systemPrompt || '',
      storedFacts: input.storedFacts || '',
      triggers,
      status: input.status || 'paused',
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: null,
      isLegacyDefault: false,
      config,
    };
    file.bots.push(bot);
    saveBotsFile(file);
    return bot;
  },

  update(id: string, patch: Partial<Bot>): Bot | null {
    const file = getOrInitBotsFile();
    const idx = file.bots.findIndex(b => b.id === id);
    if (idx < 0) return null;
    const next: Bot = {
      ...file.bots[idx],
      ...patch,
      id: file.bots[idx].id,
      isLegacyDefault: file.bots[idx].isLegacyDefault,
      updatedAt: new Date().toISOString(),
    };
    file.bots[idx] = next;
    saveBotsFile(file);
    return next;
  },

  delete(id: string): { ok: boolean; error?: string } {
    const file = getOrInitBotsFile();
    const before = file.bots.length;
    file.bots = file.bots.filter(b => b.id !== id);
    if (file.bots.length === before) return { ok: false, error: 'Agent not found' };
    saveBotsFile(file);
    try { proactiveService.deleteBotData(id); } catch (e) { logger.warn('[bot-service] Failed to delete proactive bot data:', e); }
    return { ok: true };
  },

  /**
   * Resolves the bot's effective config. For the legacy default bot this
   * reads through proactiveService (proactive-data.json); for new bots it
   * returns the inline config stored on the bot row.
   */
  resolveConfig(id: string): BotConfig | null {
    const bot = this.get(id);
    if (!bot) return null;
    if (bot.isLegacyDefault) {
      const cfg = legacyConfigToBotConfig();
      // memoryEnabled and skillIds are bot-level; pull from row
      return {
        ...cfg,
        memoryEnabled: bot.config?.memoryEnabled !== false,
        skillIds: bot.config?.skillIds,
      };
    }
    return bot.config || { ...DEFAULT_BOT_CONFIG };
  },

  updateConfig(id: string, patch: Partial<BotConfig>): BotConfig | null {
    const bot = this.get(id);
    if (!bot) return null;

    if (bot.isLegacyDefault) {
      const nextCfg = applyConfigPatchToLegacy(patch);
      // memoryEnabled and skillIds live on the bot row even for the legacy default
      if (patch.memoryEnabled !== undefined || patch.skillIds !== undefined) {
        this.update(id, {
          config: {
            ...(bot.config || DEFAULT_BOT_CONFIG),
            ...(patch.memoryEnabled !== undefined ? { memoryEnabled: patch.memoryEnabled } : {}),
            ...(patch.skillIds !== undefined ? { skillIds: patch.skillIds } : {}),
          },
        });
      }
      const stored = this.get(id)?.config;
      return {
        ...nextCfg,
        memoryEnabled: stored?.memoryEnabled !== false,
        skillIds: stored?.skillIds,
      };
    }

    const merged: BotConfig = { ...DEFAULT_BOT_CONFIG, ...(bot.config || {}), ...patch };
    this.update(id, { config: merged });
    return merged;
  },

  /**
   * Sets the bot's status. For the legacy default bot, also flips
   * proactiveService's `enabled` flag so the existing scheduler keeps working.
   */
  setStatus(id: string, status: BotStatus): Bot | null {
    const bot = this.get(id);
    if (!bot) return null;
    if (bot.isLegacyDefault) {
      proactiveService.updateConfig({ enabled: status === 'running' });
    }
    return this.update(id, { status });
  },

  /**
   * Convenience: mirror the legacy "enabled" toggle as a status change.
   */
  setEnabled(id: string, enabled: boolean): Bot | null {
    return this.setStatus(id, enabled ? 'running' : 'paused');
  },

  /**
   * Stamp the last/next run timestamps on the bot header. The scheduler
   * should call this whenever it runs or schedules a wake-up.
   */
  recordRun(id: string, opts: { lastRunAt?: string | null; nextRunAt?: string | null }): void {
    this.update(id, {
      ...(opts.lastRunAt !== undefined ? { lastRunAt: opts.lastRunAt } : {}),
      ...(opts.nextRunAt !== undefined ? { nextRunAt: opts.nextRunAt } : {}),
    });
  },

  // ─── Trigger CRUD ────────────────────────────────────────────────────────

  /**
   * Adds a trigger to the bot. Generates an id and webhook slug as needed,
   * persists, and returns the new trigger. Caller should ask the dispatcher
   * to register it (the service deliberately doesn't import the dispatcher
   * to avoid a circular dependency).
   */
  addTrigger(botId: string, input: Partial<BotTrigger> & { type: BotTriggerType }): BotTrigger | null {
    const bot = this.get(botId);
    if (!bot) return null;
    // v1 invariant: at most one schedule.interval trigger per bot.
    if (input.type === 'schedule.interval' && bot.triggers.some(t => t.type === 'schedule.interval')) {
      return null;
    }
    const trigger: BotTrigger = seedTriggerDefaults({
      id: input.id || `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: input.type,
      args: input.args || {},
      enabled: input.enabled !== false,
      label: input.label,
      requiresCloud: input.type === 'gmail.new_email',
    }, { botIdHint: botId, fallbackInterval: bot.config?.interval });
    const next = [...bot.triggers, trigger];
    this.update(botId, { triggers: next });
    syncLegacyIntervalMirror(this, botId);
    return trigger;
  },

  updateTrigger(botId: string, triggerId: string, patch: Partial<BotTrigger>): BotTrigger | null {
    const bot = this.get(botId);
    if (!bot) return null;
    const idx = bot.triggers.findIndex(t => t.id === triggerId);
    if (idx < 0) return null;
    const merged: BotTrigger = {
      ...bot.triggers[idx],
      ...patch,
      id: bot.triggers[idx].id,
      type: bot.triggers[idx].type, // type is immutable post-creation
      args: { ...bot.triggers[idx].args, ...(patch.args || {}) },
    };
    const next = bot.triggers.map((t, i) => (i === idx ? merged : t));
    this.update(botId, { triggers: next });
    syncLegacyIntervalMirror(this, botId);
    return merged;
  },

  removeTrigger(botId: string, triggerId: string): boolean {
    const bot = this.get(botId);
    if (!bot) return false;
    if (bot.triggers.length <= 1) {
      // Always keep at least one trigger so the bot has *some* way to wake.
      // The remaining one can be `manual` if the user wants no automation.
      return false;
    }
    const next = bot.triggers.filter(t => t.id !== triggerId);
    if (next.length === bot.triggers.length) return false;
    this.update(botId, { triggers: next });
    syncLegacyIntervalMirror(this, botId);
    return true;
  },
};

/**
 * Mirrors the bot's primary schedule.interval trigger back into BotConfig.interval
 * so legacy callers (e.g. ProactiveView reading proactiveService.getConfig())
 * see a consistent value. If there's no interval trigger, falls back to 'manual'.
 */
function syncLegacyIntervalMirror(svc: typeof botService, botId: string): void {
  const bot = svc.get(botId);
  if (!bot) return;
  const intervalTrigger = bot.triggers.find(t => t.type === 'schedule.interval' && t.enabled !== false);
  const every = intervalTrigger ? String(intervalTrigger.args?.every || 'manual') : 'manual';
  const cfg = svc.resolveConfig(botId);
  if (!cfg) return;
  if (cfg.interval === every) return;
  svc.updateConfig(botId, { interval: every as any });
}

export type { BotConfig as BotConfigType };
