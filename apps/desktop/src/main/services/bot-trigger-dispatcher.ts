/**
 * Bot Trigger Dispatcher
 *
 * Owns the side-effects of bot triggers: starting/stopping cron jobs,
 * registering cloud webhooks, etc. The bot-service is a pure data layer;
 * this module is what makes triggers actually fire.
 *
 * Today only `schedule.cron` requires per-trigger registration here.
 * `schedule.interval` is handled by `proactive-scheduler.checkSchedule` (it
 * already polls per-bot every 15s using `nextRunAt`). `manual` is a no-op.
 * `webhook` and `gmail.new_email` will be wired through the cloud relay in
 * a follow-up phase.
 */

import logger from '../utils/logger';
import { getTimezone } from '../settings';
import { botService } from './bot-service';
import type { Bot, BotTrigger } from './bot-service';
import { executeWakeUpForBot } from './proactive-scheduler';

let nodeCron: any = null;
try { nodeCron = require('node-cron'); } catch { /* optional */ }

interface ActiveRegistrations {
  cronJobs: Map<string /*triggerId*/, any /*ScheduledTask*/>;
}

const active = new Map<string /*botId*/, ActiveRegistrations>();
let started = false;

function getActive(botId: string): ActiveRegistrations {
  let entry = active.get(botId);
  if (!entry) {
    entry = { cronJobs: new Map() };
    active.set(botId, entry);
  }
  return entry;
}

function registerCron(bot: Bot, trigger: BotTrigger) {
  if (!nodeCron || typeof nodeCron.schedule !== 'function') {
    logger.warn(`[bot-triggers] node-cron not available; skipping ${bot.id}/${trigger.id}`);
    return;
  }
  const expr = String(trigger.args?.expr || '').trim();
  if (!expr) return;
  let tz: string | undefined;
  try { tz = getTimezone(); } catch { /* fall back to system tz */ }

  try {
    const job = nodeCron.schedule(expr, () => {
      try {
        executeWakeUpForBot({ botId: bot.id, triggerId: trigger.id });
      } catch (e) {
        logger.warn(`[bot-triggers] cron fire failed for ${bot.id}/${trigger.id}:`, e);
      }
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

function unregisterAll(botId: string) {
  const entry = active.get(botId);
  if (!entry) return;
  for (const [, job] of entry.cronJobs) {
    try { job.stop?.(); } catch { /* ignore */ }
  }
  entry.cronJobs.clear();
}

/**
 * Sync all triggers for a single bot. Idempotent — call this whenever a
 * bot's status flips, triggers change, or the bot is created/deleted.
 *
 * Strategy: tear down everything for this bot, then re-register what should
 * be active. Simple, correct, costs nothing for a typical bot's <5 triggers.
 */
export function syncBotTriggers(botId: string): void {
  unregisterAll(botId);

  const bot = botService.get(botId);
  if (!bot) {
    active.delete(botId);
    return;
  }
  // Paused / errored bots have no active registrations.
  if (bot.status !== 'running') return;

  for (const trigger of bot.triggers) {
    if (trigger.enabled === false) continue;
    switch (trigger.type) {
      case 'schedule.cron':
        registerCron(bot, trigger);
        break;
      case 'schedule.interval':
      case 'manual':
        // Handled by the proactive-scheduler poll loop — no per-trigger work.
        break;
      case 'webhook':
      case 'gmail.new_email':
        // Phase 5c: cloud-side registration. The trigger is stored and
        // surfaced in the UI; firing it requires the cloud relay to know
        // about bots (currently only knows about workflows).
        logger.info(
          `[bot-triggers] ${trigger.type} on ${bot.id}/${trigger.id} stored — ` +
          `cloud delivery pending Phase 5c`
        );
        break;
    }
  }
}

/**
 * Sync all bots. Called on dispatcher start and when invariants need to be
 * re-established (e.g. after bulk imports). Cheap.
 */
export function syncAllBotTriggers(): void {
  const ids = botService.list().map(b => b.id);
  for (const id of ids) syncBotTriggers(id);
  // Tear down anything for bots that no longer exist.
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

/**
 * Returns whether the dispatcher has any active cron jobs (handy for tests
 * and for the renderer to display "is anything wired up" state).
 */
export function getDispatcherSnapshot(): { totalBots: number; cronJobs: number } {
  let cronJobs = 0;
  for (const entry of active.values()) cronJobs += entry.cronJobs.size;
  return { totalBots: active.size, cronJobs };
}

// ─── Webhook routing ─────────────────────────────────────────────────────
//
// Webhook triggers are stored on the bot row with a unique slug. When a
// request hits either the local webhook server (workflows.ts) or arrives
// from the cloud relay (handleCloudWebhookEvent), the handler asks us
// whether any bot owns that slug and, if so, we fire it.
//
// We deliberately keep the lookup pull-based (re-scan on each call) rather
// than maintaining a slug→bot index — bots count is tiny (<100), webhooks
// are infrequent, and the simpler code avoids an entire class of "stale
// index after edit/delete" bugs.

interface WebhookRouteHit {
  botId: string;
  triggerId: string;
}

function findBotWebhookSubscribers(slug: string): WebhookRouteHit[] {
  const target = String(slug || '').trim();
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

/**
 * Route an incoming webhook to any bot whose webhook trigger matches `slug`.
 * Returns the number of bots fired so the caller can decide whether to fall
 * through to the workflow router. Stamps `lastFiredAt` on each matched
 * trigger for the UI ("last fired 3m ago").
 */
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
    try {
      executeWakeUpForBot({ botId, triggerId, triggerPayload: payload });
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

export { unregisterCron, unregisterAll, registerCron };
