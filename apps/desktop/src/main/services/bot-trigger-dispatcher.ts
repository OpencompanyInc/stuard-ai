/**
 * Bot Trigger Dispatcher
 *
 * Owns the side effects of bot triggers: cron jobs, file/folder watchers,
 * command/script watchers, and local/cloud webhook routing. The bot-service is
 * the data layer; this module is what makes persisted triggers actually fire.
 */

import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import logger from '../utils/logger';
import { getTimezone } from '../settings';
import { botService } from './bot-service';
import type { Bot, BotTrigger, BotTriggerType } from './bot-service';
import { executeWakeUpForBot } from './proactive-scheduler';
import {
  registerSocialNativeTrigger,
  unregisterSocialNativeTrigger,
  registerGoogleNativeTriggerForOwner,
  unregisterGoogleNativeTriggerForOwner,
  socialTriggerSourceKey,
  type SocialNativeTriggerType,
  type GoogleNativeTriggerType,
} from './social-trigger-client';

const CLOUD_SOCIAL_TRIGGER_TYPES = new Set<BotTriggerType>([
  'x.new_mention',
  'x.new_comment',
  'x.new_dm',
  'x.new_follower',
  'x.user_post',
  'instagram.new_comment',
  'instagram.new_mention',
  'instagram.new_message',
]);

const CLOUD_GOOGLE_TRIGGER_TYPES = new Set<BotTriggerType>([
  'gmail.new_email',
]);

function isCloudTriggerType(type: BotTriggerType): boolean {
  return CLOUD_SOCIAL_TRIGGER_TYPES.has(type) || CLOUD_GOOGLE_TRIGGER_TYPES.has(type);
}

let nodeCron: any = null;
try { nodeCron = require('node-cron'); } catch { /* optional */ }

let chokidar: any = null;
try { chokidar = require('chokidar'); } catch { /* optional */ }

interface ActiveRegistrations {
  cronJobs: Map<string /*triggerId*/, any /*ScheduledTask*/>;
  fsWatchers: Map<string /*triggerId*/, any /*FSWatcher*/>;
  commandWatchers: Map<string /*triggerId*/, ChildProcessWithoutNullStreams>;
  debounceTimers: Map<string /*triggerId:event:path*/, NodeJS.Timeout>;
}

const active = new Map<string /*botId*/, ActiveRegistrations>();
let started = false;

function getActive(botId: string): ActiveRegistrations {
  let entry = active.get(botId);
  if (!entry) {
    entry = {
      cronJobs: new Map(),
      fsWatchers: new Map(),
      commandWatchers: new Map(),
      debounceTimers: new Map(),
    };
    active.set(botId, entry);
  }
  return entry;
}

function cleanString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function fireBotTrigger(bot: Bot, trigger: BotTrigger, payload: Record<string, any>) {
  try {
    executeWakeUpForBot({
      botId: bot.id,
      triggerId: trigger.id,
      triggerPayload: {
        triggerType: trigger.type,
        ...payload,
      },
    });
  } catch (e) {
    logger.warn(`[bot-triggers] fire failed for ${bot.id}/${trigger.id}:`, e);
  }
}

function registerCron(bot: Bot, trigger: BotTrigger) {
  if (!nodeCron || typeof nodeCron.schedule !== 'function') {
    logger.warn(`[bot-triggers] node-cron not available; skipping ${bot.id}/${trigger.id}`);
    return;
  }
  const expr = cleanString(trigger.args?.expr);
  if (!expr) return;
  let tz: string | undefined;
  try { tz = cleanString(trigger.args?.tz) || getTimezone(); } catch { /* fall back to system tz */ }

  try {
    const job = nodeCron.schedule(expr, () => {
      fireBotTrigger(bot, trigger, {
        source: 'schedule.cron',
        expr,
        firedAt: new Date().toISOString(),
      });
    }, tz ? { timezone: tz } : undefined);

    try { job.start?.(); } catch { /* some versions auto-start */ }

    getActive(bot.id).cronJobs.set(trigger.id, job);
    logger.info(`[bot-triggers] Registered cron ${expr} for ${bot.id}/${trigger.id}`);
  } catch (e) {
    logger.warn(`[bot-triggers] Failed to register cron "${expr}" for ${bot.id}/${trigger.id}:`, e);
  }
}

function unregisterCron(botId: string, triggerId: string) {
  const entry = active.get(botId);
  const job = entry?.cronJobs.get(triggerId);
  if (job) {
    try { job.stop?.(); } catch { /* ignore */ }
    entry?.cronJobs.delete(triggerId);
  }
}

function registerFileWatch(bot: Bot, trigger: BotTrigger) {
  if (!chokidar || typeof chokidar.watch !== 'function') {
    logger.warn(`[bot-triggers] chokidar not available; skipping ${bot.id}/${trigger.id}`);
    return;
  }
  const watchPath = cleanString(trigger.args?.path);
  if (!watchPath) {
    logger.warn(`[bot-triggers] fs.watch missing path for ${bot.id}/${trigger.id}`);
    return;
  }

  const pattern = cleanString(trigger.args?.pattern);
  const target = pattern ? path.join(watchPath, pattern) : watchPath;
  const recursive = trigger.args?.recursive !== false;
  const debounceMs = Math.min(Math.max(Number(trigger.args?.debounceMs ?? 750), 0), 60_000);
  const configuredEvents = asStringArray(trigger.args?.events);
  const events = new Set(configuredEvents.length ? configuredEvents : ['add', 'change', 'unlink', 'addDir', 'unlinkDir']);

  // awaitWriteFinish: hold the add/change event until the file has stopped
  // growing. Without it chokidar fires the instant a file appears — i.e. on the
  // first byte of a still-recording video or a sync client's partial download —
  // so the agent gets a truncated/locked file. Enabled by default; pass
  // args.awaitWriteFinish = false to opt out, or an object to tune the timings.
  const awaitArg = (trigger.args as any)?.awaitWriteFinish;
  const awaitWriteFinish = awaitArg === false
    ? false
    : {
        stabilityThreshold: Math.min(Math.max(Number(awaitArg?.stabilityThreshold ?? 2000), 0), 600_000),
        pollInterval: Math.min(Math.max(Number(awaitArg?.pollInterval ?? 100), 10), 10_000),
      };

  // Ignore in-progress/temp artifacts so a sync client's scratch file (OneDrive
  // .partial, browser .crdownload, Office ~$, editor foo~, *.tmp) never fires the
  // trigger. Matched on the basename and merged with any caller-supplied rule.
  const isTempArtifact = (p: string) => {
    const base = path.basename(String(p || '')).toLowerCase();
    return /\.(tmp|temp|partial|part|crdownload|download)$/.test(base)
      || base.endsWith('~')
      || base.startsWith('~$')
      || base.startsWith('.~');
  };
  const userIgnore = trigger.args?.ignored || trigger.args?.ignore;
  const ignored = userIgnore ? [isTempArtifact, userIgnore] : isTempArtifact;

  const options: Record<string, any> = {
    ignoreInitial: trigger.args?.ignoreInitial !== false,
    persistent: true,
    ...(recursive ? {} : { depth: 0 }),
    ignored,
    ...(awaitWriteFinish ? { awaitWriteFinish } : {}),
  };

  try {
    const watcher = chokidar.watch(target, options);
    const entry = getActive(bot.id);
    const fire = (event: string, filePath: string, stats?: any) => {
      if (!events.has(event)) return;
      const key = `${trigger.id}:${event}:${filePath}`;
      const send = () => {
        entry.debounceTimers.delete(key);
        let relativePath = filePath;
        try { relativePath = path.relative(watchPath, filePath); } catch { /* keep absolute */ }
        fireBotTrigger(bot, trigger, {
          source: 'fs.watch',
          event,
          path: filePath,
          filePath,
          relativePath,
          basename: path.basename(filePath),
          watchedPath: watchPath,
          pattern: pattern || null,
          size: typeof stats?.size === 'number' ? stats.size : undefined,
          firedAt: new Date().toISOString(),
        });
      };
      const existing = entry.debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      if (debounceMs > 0) entry.debounceTimers.set(key, setTimeout(send, debounceMs));
      else send();
    };

    watcher
      .on('add', (p: string, s: any) => fire('add', p, s))
      .on('change', (p: string, s: any) => fire('change', p, s))
      .on('unlink', (p: string) => fire('unlink', p))
      .on('addDir', (p: string, s: any) => fire('addDir', p, s))
      .on('unlinkDir', (p: string) => fire('unlinkDir', p))
      .on('error', (e: any) => logger.warn(`[bot-triggers] fs.watch error for ${bot.id}/${trigger.id}:`, e));

    entry.fsWatchers.set(trigger.id, watcher);
    logger.info(`[bot-triggers] Registered fs.watch ${target} for ${bot.id}/${trigger.id}`);
  } catch (e) {
    logger.warn(`[bot-triggers] Failed to register fs.watch for ${bot.id}/${trigger.id}:`, e);
  }
}

function registerCommandWatch(bot: Bot, trigger: BotTrigger) {
  const cmd = cleanString(trigger.args?.cmd || trigger.args?.command);
  if (!cmd) {
    logger.warn(`[bot-triggers] command.watch missing cmd for ${bot.id}/${trigger.id}`);
    return;
  }
  const args = asStringArray(trigger.args?.args);
  const cwd = cleanString(trigger.args?.cwd);
  const fireOn = new Set(asStringArray(trigger.args?.fireOn));
  if (fireOn.size === 0) fireOn.add('stdout');

  try {
    const child = spawn(cmd, args, {
      cwd: cwd || undefined,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env },
    });

    const emitLine = (stream: 'stdout' | 'stderr', line: string) => {
      const text = line.trim();
      if (!text || !fireOn.has(stream)) return;
      let parsed: any = undefined;
      try { parsed = JSON.parse(text); } catch { /* plain text line */ }
      fireBotTrigger(bot, trigger, {
        source: 'command.watch',
        stream,
        line: text,
        json: parsed,
        cmd,
        args,
        cwd: cwd || null,
        firedAt: new Date().toISOString(),
      });
    };

    const attachLineReader = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
      let buffer = '';
      stream.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) emitLine(name, line);
      });
      stream.on('end', () => {
        if (buffer) emitLine(name, buffer);
        buffer = '';
      });
    };

    attachLineReader(child.stdout, 'stdout');
    attachLineReader(child.stderr, 'stderr');
    child.on('exit', (code, signal) => {
      if (fireOn.has('exit')) {
        fireBotTrigger(bot, trigger, {
          source: 'command.watch',
          event: 'exit',
          code,
          signal,
          cmd,
          args,
          cwd: cwd || null,
          firedAt: new Date().toISOString(),
        });
      }
      getActive(bot.id).commandWatchers.delete(trigger.id);
      logger.info(`[bot-triggers] command.watch exited for ${bot.id}/${trigger.id} code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
    child.on('error', (e) => {
      logger.warn(`[bot-triggers] command.watch error for ${bot.id}/${trigger.id}:`, e);
    });

    getActive(bot.id).commandWatchers.set(trigger.id, child);
    logger.info(`[bot-triggers] Registered command.watch "${cmd}" for ${bot.id}/${trigger.id}`);
  } catch (e) {
    logger.warn(`[bot-triggers] Failed to register command.watch for ${bot.id}/${trigger.id}:`, e);
  }
}

function unregisterAll(botId: string) {
  const entry = active.get(botId);
  if (!entry) return;
  for (const [, job] of entry.cronJobs) {
    try { job.stop?.(); } catch { /* ignore */ }
  }
  entry.cronJobs.clear();
  for (const [, watcher] of entry.fsWatchers) {
    try { watcher.close?.(); } catch { /* ignore */ }
  }
  entry.fsWatchers.clear();
  for (const [, timer] of entry.debounceTimers) {
    try { clearTimeout(timer); } catch { /* ignore */ }
  }
  entry.debounceTimers.clear();
  for (const [, child] of entry.commandWatchers) {
    try { if (!child.killed) child.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch { /* ignore */ }
  }
  entry.commandWatchers.clear();
}

// ── Cloud trigger sync ───────────────────────────────────────────────────────
// Cloud-registered triggers (social webhooks + Gmail watches) live in cloud-ai,
// so syncing them is async. Two invariants:
//  1. Syncs for the same bot are serialized via a per-bot promise chain —
//     a blanket unregister must never race a follow-up register.
//  2. We diff against the last-synced snapshot instead of unregistering
//     everything first, so a trigger that stays enabled never has a window
//     where events are dropped, and a deleted bot still gets its last
//     registrations cleaned up (the bot record is gone by sync time).

// botId -> triggerId -> type, as of the last completed sync.
const lastCloudTriggers = new Map<string, Map<string, BotTriggerType>>();
const cloudSyncQueues = new Map<string, Promise<void>>();

async function unregisterCloudTrigger(botId: string, triggerId: string, type: BotTriggerType): Promise<void> {
  const sourceKey = socialTriggerSourceKey('bot', botId, triggerId);
  if (CLOUD_GOOGLE_TRIGGER_TYPES.has(type)) {
    await unregisterGoogleNativeTriggerForOwner({
      ownerId: botId, triggerId, type: type as GoogleNativeTriggerType, sourceKey,
    });
  } else {
    await unregisterSocialNativeTrigger({ ownerId: botId, triggerId, sourceKey });
  }
}

async function registerCloudTrigger(botId: string, trigger: BotTrigger): Promise<boolean> {
  const sourceKey = socialTriggerSourceKey('bot', botId, trigger.id);
  const result = CLOUD_GOOGLE_TRIGGER_TYPES.has(trigger.type)
    ? await registerGoogleNativeTriggerForOwner({
        ownerId: botId, triggerId: trigger.id,
        type: trigger.type as GoogleNativeTriggerType,
        args: trigger.args || {}, sourceKey,
      })
    : await registerSocialNativeTrigger({
        ownerId: botId, triggerId: trigger.id,
        type: trigger.type as SocialNativeTriggerType,
        args: trigger.args || {}, sourceKey,
      });
  if (result.ok) {
    logger.info(`[bot-triggers] Registered ${trigger.type} for ${botId}/${trigger.id}`);
  }
  return result.ok;
}

async function syncCloudTriggersForBot(botId: string): Promise<void> {
  const bot = botService.get(botId);
  const desired = new Map<string, BotTrigger>();
  if (bot && bot.status === 'running') {
    for (const trigger of bot.triggers) {
      if (trigger.enabled === false) continue;
      if (!isCloudTriggerType(trigger.type)) continue;
      desired.set(trigger.id, trigger);
    }
  }

  const previous = lastCloudTriggers.get(botId) || new Map<string, BotTriggerType>();

  // Unregister triggers that are gone, disabled, or changed type.
  for (const [triggerId, prevType] of previous) {
    const want = desired.get(triggerId);
    if (want && want.type === prevType) continue;
    try {
      await unregisterCloudTrigger(botId, triggerId, prevType);
    } catch (e) {
      logger.warn(`[bot-triggers] cloud unregister failed for ${botId}/${triggerId}:`, e);
    }
  }

  // Register (or refresh args of) everything desired — idempotent upsert cloud-side.
  for (const trigger of desired.values()) {
    try {
      await registerCloudTrigger(botId, trigger);
    } catch (e) {
      logger.warn(`[bot-triggers] cloud register failed for ${botId}/${trigger.id}:`, e);
    }
  }

  if (desired.size === 0) {
    lastCloudTriggers.delete(botId);
  } else {
    lastCloudTriggers.set(botId, new Map(Array.from(desired.values()).map(t => [t.id, t.type])));
  }
}

function queueCloudTriggerSync(botId: string): void {
  const prev = cloudSyncQueues.get(botId) || Promise.resolve();
  const next = prev
    .then(() => syncCloudTriggersForBot(botId))
    .catch((e) => {
      logger.warn(`[bot-triggers] cloud trigger sync failed for ${botId}:`, e);
    });
  cloudSyncQueues.set(botId, next);
}

/**
 * Sync all triggers for a single bot. Idempotent: call this whenever a bot's
 * status flips, triggers change, or the bot is created/deleted.
 */
export function syncBotTriggers(botId: string): void {
  unregisterAll(botId);
  queueCloudTriggerSync(botId);

  const bot = botService.get(botId);
  if (!bot) {
    active.delete(botId);
    return;
  }

  if (bot.status !== 'running') return;

  for (const trigger of bot.triggers) {
    if (trigger.enabled === false) continue;
    switch (trigger.type) {
      case 'schedule.cron':
        registerCron(bot, trigger);
        break;
      case 'fs.watch':
        registerFileWatch(bot, trigger);
        break;
      case 'command.watch':
        registerCommandWatch(bot, trigger);
        break;
      case 'webhook':
        logger.info(`[bot-triggers] webhook slug "${trigger.args?.slug || ''}" active for ${bot.id}/${trigger.id}`);
        break;
      case 'schedule.interval':
      case 'manual':
        break;
      case 'gmail.new_email':
      case 'x.new_mention':
      case 'x.new_comment':
      case 'x.new_dm':
      case 'x.new_follower':
      case 'x.user_post':
      case 'instagram.new_comment':
      case 'instagram.new_mention':
      case 'instagram.new_message':
        // Cloud-registered — handled by queueCloudTriggerSync above.
        break;
    }
  }
}

export function syncAllBotTriggers(): void {
  const ids = botService.list().map(b => b.id);
  for (const id of ids) syncBotTriggers(id);
  for (const botId of Array.from(active.keys())) {
    if (!ids.includes(botId)) {
      unregisterAll(botId);
      active.delete(botId);
    }
  }
}

export function startBotTriggerDispatcher(): void {
  if (started) return;
  started = true;
  logger.info('[bot-triggers] Dispatcher starting');
  try {
    syncAllBotTriggers();
  } catch (e) {
    logger.error('[bot-triggers] Initial sync failed:', e);
  }
}

export function stopBotTriggerDispatcher(): void {
  if (!started) return;
  started = false;
  logger.info('[bot-triggers] Dispatcher stopping');
  for (const botId of Array.from(active.keys())) {
    unregisterAll(botId);
  }
  active.clear();
}

export function getDispatcherSnapshot(): { totalBots: number; cronJobs: number; fsWatchers: number; commandWatchers: number } {
  let cronJobs = 0;
  let fsWatchers = 0;
  let commandWatchers = 0;
  for (const entry of active.values()) {
    cronJobs += entry.cronJobs.size;
    fsWatchers += entry.fsWatchers.size;
    commandWatchers += entry.commandWatchers.size;
  }
  return { totalBots: active.size, cronJobs, fsWatchers, commandWatchers };
}

interface WebhookRouteHit {
  botId: string;
  triggerId: string;
}

function findBotWebhookSubscribers(slug: string): WebhookRouteHit[] {
  const target = cleanString(slug);
  if (!target) return [];
  const hits: WebhookRouteHit[] = [];
  for (const bot of botService.list()) {
    if (bot.status !== 'running') continue;
    for (const trigger of bot.triggers) {
      if (trigger.type !== 'webhook') continue;
      if (trigger.enabled === false) continue;
      if (String(trigger.args?.slug || '') !== target) continue;
      hits.push({ botId: bot.id, triggerId: trigger.id });
    }
  }
  return hits;
}

export function routeWebhookToBots(slug: string, payload: any): number {
  const hits = findBotWebhookSubscribers(slug);
  if (hits.length === 0) return 0;
  const firedAt = new Date().toISOString();
  let fired = 0;
  for (const { botId, triggerId } of hits) {
    try {
      botService.updateTrigger(botId, triggerId, {
        args: { lastFiredAt: firedAt },
      });
    } catch (e) {
      logger.warn(`[bot-triggers] Failed to stamp lastFiredAt on ${botId}/${triggerId}:`, e);
    }

    const bot = botService.get(botId);
    const trigger = bot?.triggers.find(t => t.id === triggerId);
    if (!bot || !trigger) continue;
    try {
      const payloadObject = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      fireBotTrigger(bot, trigger, {
        source: 'webhook',
        ...payloadObject,
        body: payload,
        payload,
        firedAt,
      });
      fired++;
    } catch (e) {
      logger.warn(`[bot-triggers] webhook fire failed for ${botId}/${triggerId}:`, e);
    }
  }
  if (fired > 0) {
    logger.info(`[bot-triggers] webhook slug "${slug}" fired ${fired} bot(s)`);
  }
  return fired;
}

/** Apply gmail.new_email trigger args ({ from?, subjectContains? }) to an incoming event. */
function gmailEventMatchesTriggerArgs(trigger: BotTrigger, data: any): boolean {
  if (trigger.type !== 'gmail.new_email') return true;
  const message = data?.message || data?.data?.message || {};
  const from = cleanString(trigger.args?.from).toLowerCase();
  if (from && !String(message?.from || '').toLowerCase().includes(from)) return false;
  const subjectContains = cleanString(trigger.args?.subjectContains).toLowerCase();
  if (subjectContains && !String(message?.subject || '').toLowerCase().includes(subjectContains)) return false;
  return true;
}

export function routeProviderWebhookToBot(
  botId: string,
  triggerId: string | undefined,
  eventType: string | undefined,
  data: any,
  provider?: string,
): number {
  const bot = botService.get(botId);
  if (!bot || bot.status !== 'running') return 0;

  const normalizedEvent = String(eventType || data?.event || '').trim();
  const matches = bot.triggers.filter((trigger) => {
    if (trigger.enabled === false) return false;
    if (!isCloudTriggerType(trigger.type)) return false;
    if (triggerId && trigger.id !== triggerId) return false;
    if (normalizedEvent && trigger.type !== normalizedEvent) return false;
    if (!gmailEventMatchesTriggerArgs(trigger, data)) return false;
    return true;
  });

  let fired = 0;
  for (const trigger of matches) {
    try {
      fireBotTrigger(bot, trigger, {
        source: 'provider_webhook',
        provider: provider || undefined,
        eventType: normalizedEvent || trigger.type,
        data,
        payload: data,
        firedAt: new Date().toISOString(),
      });
      fired++;
    } catch (e) {
      logger.warn(`[bot-triggers] provider webhook fire failed for ${botId}/${trigger.id}:`, e);
    }
  }
  if (fired > 0) {
    logger.info(`[bot-triggers] provider webhook fired ${fired} bot trigger(s) on ${botId}`);
  }
  return fired;
}

export { unregisterCron, unregisterAll, registerCron, registerFileWatch, registerCommandWatch };
