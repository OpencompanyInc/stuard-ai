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
  /**
   * How autonomous this agent is when it hits a sensitive tool (writing/deleting
   * files, running commands, using the terminal) during a local run:
   * - 'auto'      → never ask; run everything.
   * - 'selective' → auto-run the tools in `autoApproveTools`; pop a blocking
   *                 approval prompt for any other sensitive tool.
   * - 'manual'    → pop a blocking approval prompt for every sensitive tool.
   * Read-only/non-sensitive tools never prompt regardless of mode.
   */
  permissionMode: 'auto' | 'selective' | 'manual';
  /** Sensitive tool names auto-approved when `permissionMode === 'selective'`. */
  autoApproveTools: string[];
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
  config?: BotConfig;
}

interface BotsFile {
  version: 1;
  bots: Bot[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_BOT_ID = 'bot_default';

// Identity of the agent Stuard ships with — Scout, a proactive companion that
// checks in on a schedule. It's a normal bot the user can rename, reconfigure,
// pause, or delete; these are just the seed values for a fresh install.
const DEFAULT_BOT_NAME = 'Scout';
const DEFAULT_BOT_EMOJI = '🔭';
// Fallback name for an unnamed/corrupt bot row (create() always supplies one).
const FALLBACK_BOT_NAME = 'Agent';

/**
 * Scout's personality + operating contract. Distinct from the generic proactive
 * scaffolding the scheduler injects for every bot (buildLocalProactiveHiddenContext);
 * this is what makes the default agent "Scout". Encodes the human-in-the-loop
 * rule: it proposes destructive/outbound actions for approval instead of
 * performing them autonomously during an unattended run.
 */
const DEFAULT_PROACTIVE_SYSTEM_PROMPT = [
  "You are Scout, Stuard's built-in proactive companion. You wake up on a schedule to move the user's work forward between conversations — act, don't just observe.",
  '',
  'How you operate:',
  "- DO THE WORK. Research, draft, organize, prepare — finish what you can each run and report results, not intentions. Never end a run with only a plan when you could have executed part of it.",
  "- TRUST YOUR PERMISSIONS. File and command tools are governed by the user's permission settings: tools they've allowed just run — use them freely without asking twice — and the rest automatically prompt the user for approval. Never pre-ask in chat for something your permissions already cover.",
  '- CONFIRM OUTBOUND & IRREVERSIBLE ACTIONS. Sending emails or messages, posting publicly, purchases, or anything hard to undo: prepare it completely, then create a task or notification proposing exactly what you intend to do, and act only after the user confirms.',
  '- KEEP A WATCHLIST. Your private kanban is your heartbeat checklist. Keep standing cards for deadlines, follow-ups, and routines you are watching; each wake-up, scan it, advance in-progress cards, and log what you learned.',
  '- LEARN REUSABLE ROUTINES. After finishing something multi-step, save how you did it — steps, tools, gotchas — to your memory so future runs are faster and better.',
  '- PROACTIVELY SET REMINDERS. When you notice something time-sensitive — a deadline, a follow-up, an appointment — set a reminder instead of relying on the user to remember.',
  "- CHECK IN, don't nag. Lead with a useful observation, real progress, or a finished draft — never an empty \"just checking in\" ping. If nothing is genuinely worth surfacing this run, skip the notification.",
].join('\n');

// Previous stock prompts, verbatim. If the default agent still carries one of
// these (user never customized it), upgradeDefaultBotIfNeeded swaps in the
// current contract so existing installs pick up new behavior too.
const LEGACY_PROACTIVE_SYSTEM_PROMPTS = new Set<string>([
  [
    "You are Scout, Stuard's built-in proactive companion. You wake up on a schedule to check in on the user, surface time-sensitive things, and quietly move their work forward between conversations.",
    '',
    'How you operate:',
    "- CHECK IN, don't nag. Lead with a useful observation, real progress, or a finished draft — never an empty \"just checking in\" ping. If nothing is genuinely worth surfacing this run, skip the notification.",
    '- PROACTIVELY SET REMINDERS. When you notice something time-sensitive — a deadline, a follow-up, an appointment — use the reminder tool to set a reminder instead of relying on the user to remember.',
    '- CONFIRM BEFORE ACTING. Never autonomously perform destructive or outbound/write actions: deleting, sending messages or emails, posting, modifying or overwriting files, purchases, or anything hard to undo. Prepare it and ask first — create a task or set a reminder describing exactly what you propose to do, notify the user, and only carry it out once they have confirmed.',
    '- READ-ONLY WORK NEEDS NO CONFIRMATION. Researching, drafting, summarizing, organizing your private kanban, and setting reminders are always fair game — do them and report the result.',
  ].join('\n'),
]);

// Default sensitive tools auto-approved in 'selective' mode: common file
// writes/edits. Destructive (move/delete), run_command, and terminal_* are
// intentionally NOT here, so they still pop a blocking approval prompt.
export const DEFAULT_BOT_AUTO_APPROVE_TOOLS = [
  'write_file',
  'write_file_base64',
  'create_directory',
  'copy_file',
  'file_edit',
];

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
  permissionMode: 'selective',
  autoApproveTools: [...DEFAULT_BOT_AUTO_APPROVE_TOOLS],
};

/**
 * Seed (or re-seed) the shipped default Proactive agent. Used by fresh-install
 * initialization and by the idempotent upgrade path for installs that still
 * have the old blank default bot.
 */
function buildDefaultProactiveBot(now: string): Bot {
  return {
    id: DEFAULT_BOT_ID,
    name: DEFAULT_BOT_NAME,
    emoji: DEFAULT_BOT_EMOJI,
    systemPrompt: DEFAULT_PROACTIVE_SYSTEM_PROMPT,
    storedFacts: '',
    triggers: [{
      id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'schedule.interval',
      args: { every: '30m' },
      enabled: true,
      label: 'Schedule',
      requiresCloud: false,
    }],
    status: 'paused',
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: null,
    vmDeployedAt: null,
    config: {
      ...DEFAULT_BOT_CONFIG,
      // Ships able to set reminders so it can act on time-sensitive things.
      allowedTools: ['task_reminders'],
    },
  };
}

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
  const isDefault = String(raw?.id || '') === DEFAULT_BOT_ID;
  const triggers = normalizeTriggers(raw?.triggers, raw, config);
  return {
    id: String(raw?.id || ''),
    name: typeof raw?.name === 'string' && raw.name.trim()
      ? raw.name
      : (isDefault ? DEFAULT_BOT_NAME : FALLBACK_BOT_NAME),
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
    permissionMode: (raw?.permissionMode === 'auto' || raw?.permissionMode === 'manual' || raw?.permissionMode === 'selective')
      ? raw.permissionMode
      : DEFAULT_BOT_CONFIG.permissionMode,
    autoApproveTools: Array.isArray(raw?.autoApproveTools)
      ? raw.autoApproveTools.map((x: any) => String(x).trim().toLowerCase()).filter(Boolean)
      : [...DEFAULT_BOT_AUTO_APPROVE_TOOLS],
  };
}

// ─── Migration ─────────────────────────────────────────────────────────────

/**
 * Builds the initial bots.json for a fresh install: just the shipped default
 * Proactive agent, with its config stored inline like every other bot.
 */
function buildInitialBotsFile(): BotsFile {
  return { version: 1, bots: [buildDefaultProactiveBot(new Date().toISOString())] };
}

/**
 * Returns the bots file, initializing it on first run. Once bots.json exists,
 * even an empty list is intentional because the default agent can be deleted.
 */
function getOrInitBotsFile(): BotsFile {
  const existing = loadBotsFile();
  if (existing) return upgradeDefaultBotIfNeeded(existing);
  const fresh = buildInitialBotsFile();
  saveBotsFile(fresh);
  logger.info('[bot-service] Initialized bots.json with the default Proactive agent');
  return fresh;
}

/**
 * Idempotent in-place upgrade for installs created before the Proactive default
 * agent existed: the old default bot shipped with a blank system prompt and
 * delegated its config to proactiveService. If we still see that shape, give it
 * the Proactive identity so the user gets the new behavior without losing run
 * history. No-ops once seeded or if the user customized the prompt or deleted
 * the bot.
 */
function upgradeDefaultBotIfNeeded(file: BotsFile): BotsFile {
  const idx = file.bots.findIndex(b => b.id === DEFAULT_BOT_ID);
  if (idx < 0) return file; // user deleted the default bot — respect that
  const bot = file.bots[idx];
  // Stock-prompt refresh: the user never touched the prompt, so move them to
  // the current contract. Customized prompts are left alone.
  if (bot.systemPrompt && LEGACY_PROACTIVE_SYSTEM_PROMPTS.has(bot.systemPrompt.trim())) {
    file.bots[idx] = {
      ...bot,
      systemPrompt: DEFAULT_PROACTIVE_SYSTEM_PROMPT,
      updatedAt: new Date().toISOString(),
    };
    saveBotsFile(file);
    logger.info('[bot-service] Refreshed the default agent\'s stock system prompt');
    return file;
  }
  if (bot.systemPrompt && bot.systemPrompt.trim()) return file; // already seeded/customized
  const seed = buildDefaultProactiveBot(bot.createdAt || new Date().toISOString());
  file.bots[idx] = {
    ...bot,
    name: bot.name && bot.name !== 'Stuard' ? bot.name : seed.name,
    emoji: bot.emoji && bot.emoji !== '🤖' ? bot.emoji : seed.emoji,
    systemPrompt: seed.systemPrompt,
    triggers: bot.triggers.length ? bot.triggers : seed.triggers,
    config: {
      ...(seed.config as BotConfig),
      ...(bot.config || {}),
      allowedTools: Array.from(new Set([...(bot.config?.allowedTools || []), 'task_reminders'])),
    },
    updatedAt: new Date().toISOString(),
  };
  saveBotsFile(file);
  logger.info('[bot-service] Upgraded the legacy default bot to the Proactive agent');
  return file;
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

  /** Resolves the bot's effective config from its inline config row. */
  resolveConfig(id: string): BotConfig | null {
    const bot = this.get(id);
    if (!bot) return null;
    return bot.config || { ...DEFAULT_BOT_CONFIG };
  },

  updateConfig(id: string, patch: Partial<BotConfig>): BotConfig | null {
    const bot = this.get(id);
    if (!bot) return null;
    const merged: BotConfig = { ...DEFAULT_BOT_CONFIG, ...(bot.config || {}), ...patch };
    this.update(id, { config: merged });
    return merged;
  },

  /** Sets the bot's status (running/paused/errored). */
  setStatus(id: string, status: BotStatus): Bot | null {
    const bot = this.get(id);
    if (!bot) return null;
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
 * so callers that read the flat interval (e.g. the VM deploy payload's
 * intervalFromBotTriggers fallback) see a consistent value. If there's no
 * interval trigger, falls back to 'manual'.
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
