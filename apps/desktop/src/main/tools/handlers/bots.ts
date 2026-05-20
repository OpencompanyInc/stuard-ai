import { botService, type Bot, type BotConfig, type BotTrigger, type BotTriggerType } from '../../services/bot-service';
import { proactiveService } from '../../services/proactive-service';
import { syncBotTriggers } from '../../services/bot-trigger-dispatcher';
import { deployBotToVm, pullBotMemoryFromVm, stopBotOnVm } from '../../services/bot-vm-deploy';
import { botMemoryService } from '../../services/bot-memory-service';
import { executeWakeUpForBot } from '../../services/proactive-scheduler';
import type { RouterContext } from '../types';

const VALID_INTERVALS = new Set(['10m', '15m', '30m', '1h', '2h', 'random', 'manual']);
const VALID_MODEL_MODES = new Set(['auto', 'fast', 'balanced', 'smart']);
const VALID_EXECUTION_TARGETS = new Set(['local', 'cloud']);
const VALID_BOT_STATUSES = new Set(['paused', 'running', 'errored']);

function cleanString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripBotProtocol(value: string): string {
  return value.replace(/^(bot|agent):\/\//i, '').replace(/^@+/, '').trim();
}

function normalizeBotName(value: any): string {
  return stripBotProtocol(String(value || '')).toLowerCase();
}

function normalizeDeployMode(value: any): 'paused' | 'local' | 'vm' | 'both' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'both' || raw === 'local' || raw === 'vm') return raw;
  if (raw === 'start' || raw === 'running' || raw === 'deploy') return 'local';
  return 'paused';
}

function arrayOfStrings(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function genTriggerId(): string {
  return `trig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function summarizeTrigger(trigger: BotTrigger): Record<string, any> {
  return {
    id: trigger.id,
    type: trigger.type,
    label: trigger.label,
    enabled: trigger.enabled !== false,
    args: trigger.args || {},
    requiresCloud: !!trigger.requiresCloud,
  };
}

function summarizeBot(bot: Bot, config?: BotConfig | null): Record<string, any> {
  return {
    id: bot.id,
    name: bot.name,
    emoji: bot.emoji,
    systemPrompt: bot.systemPrompt || '',
    storedFacts: bot.storedFacts || '',
    status: bot.status,
    lastRunAt: bot.lastRunAt ?? null,
    nextRunAt: bot.nextRunAt ?? null,
    vmDeployedAt: bot.vmDeployedAt ?? null,
    isLegacyDefault: !!bot.isLegacyDefault,
    triggers: (bot.triggers || []).map(summarizeTrigger),
    config: config ? summarizeConfig(config) : undefined,
  };
}

function summarizeConfig(config: BotConfig): Record<string, any> {
  return {
    interval: config.interval,
    executionTarget: config.executionTarget,
    modelMode: config.modelMode,
    modelId: config.modelId || '',
    instructions: config.instructions || '',
    allowedTools: Array.isArray(config.allowedTools) ? config.allowedTools : [],
    notificationChannels: Array.isArray(config.notificationChannels) ? config.notificationChannels : [],
    memoryEnabled: config.memoryEnabled !== false,
    skillIds: Array.isArray(config.skillIds) ? config.skillIds : undefined,
    contextPermissions: config.contextPermissions || {},
  };
}

function resolveBot(args: any): Bot | null {
  const id = stripBotProtocol(String(args?.agent_id || args?.agentId || args?.bot_id || args?.botId || args?.id || '').trim());
  if (id) {
    const byId = botService.get(id);
    if (byId) return byId;
  }

  const name = normalizeBotName(args?.name || args?.bot_name || args?.mention);
  if (!name) return null;

  return botService.list().find((bot) => normalizeBotName(bot.name) === name) || null;
}

function botNotFound(args: any): Record<string, any> {
  return {
    ok: false,
    error: 'bot_not_found',
    availableBots: botService.list().map((bot) => ({ id: bot.id, name: bot.name, status: bot.status })),
    requested: {
      agent_id: args?.agent_id || args?.agentId || args?.bot_id || args?.botId || args?.id || null,
      name: args?.name || args?.bot_name || args?.mention || null,
    },
  };
}

function buildTriggers(args: any): BotTrigger[] {
  const schedule = args?.schedule && typeof args.schedule === 'object' ? args.schedule : {};
  const trigger = args?.trigger && typeof args.trigger === 'object' ? args.trigger : {};
  const kind = String(schedule.kind || trigger.kind || args?.schedule_kind || args?.trigger_type || '').trim().toLowerCase();
  const cron = cleanString(schedule.cron || schedule.expr || trigger.cron || trigger.expr || args?.cron);
  const every = cleanString(schedule.every || schedule.interval || trigger.every || trigger.interval || args?.interval);
  const tz = cleanString(schedule.tz || schedule.timezone || trigger.tz || trigger.timezone || args?.timezone);

  if (kind === 'cron' || cron) {
    return [{
      id: genTriggerId(),
      type: 'schedule.cron',
      args: { expr: cron || '0 9 * * 1', ...(tz ? { tz } : {}) },
      enabled: true,
      label: cleanString(schedule.label || trigger.label) || 'Schedule',
      requiresCloud: false,
    }];
  }

  if (kind === 'manual' || every === 'manual') {
    return [{
      id: genTriggerId(),
      type: 'manual',
      args: {},
      enabled: true,
      label: cleanString(schedule.label || trigger.label) || 'Manual',
      requiresCloud: false,
    }];
  }

  if (kind === 'webhook' || trigger.type === 'webhook') {
    const slug = cleanString(trigger.slug || schedule.slug) || `bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return [{
      id: genTriggerId(),
      type: 'webhook',
      args: {
        slug,
        ...(cleanString(trigger.secret || schedule.secret) ? { secret: cleanString(trigger.secret || schedule.secret) } : {}),
        createdAt: new Date().toISOString(),
        lastFiredAt: null,
      },
      enabled: true,
      label: cleanString(trigger.label || schedule.label) || 'Webhook',
      requiresCloud: true,
    }];
  }

  if (kind === 'gmail.new_email' || trigger.type === 'gmail.new_email') {
    return [{
      id: genTriggerId(),
      type: 'gmail.new_email',
      args: {
        ...(cleanString(trigger.from || schedule.from) ? { from: cleanString(trigger.from || schedule.from) } : {}),
        ...(cleanString(trigger.subjectContains || schedule.subjectContains) ? { subjectContains: cleanString(trigger.subjectContains || schedule.subjectContains) } : {}),
      },
      enabled: true,
      label: cleanString(trigger.label || schedule.label) || 'Gmail',
      requiresCloud: true,
    }];
  }

  if (kind === 'interval' || every) {
    const normalizedEvery = VALID_INTERVALS.has(every) && every !== 'manual' ? every : '30m';
    return [{
      id: genTriggerId(),
      type: 'schedule.interval',
      args: { every: normalizedEvery },
      enabled: true,
      label: cleanString(schedule.label || trigger.label) || 'Schedule',
      requiresCloud: false,
    }];
  }

  return [{
    id: genTriggerId(),
    type: 'manual',
    args: {},
    enabled: true,
    label: 'Manual',
    requiresCloud: false,
  }];
}

function buildConfig(args: any, triggers: BotTrigger[]): BotConfig {
  const scheduleInterval = triggers.find((trigger) => trigger.type === 'schedule.interval')?.args?.every;
  const interval = VALID_INTERVALS.has(scheduleInterval) ? scheduleInterval : 'manual';
  const modelMode = cleanString(args?.model_mode || args?.modelMode);
  const executionTarget = cleanString(args?.execution_target || args?.executionTarget);
  const instructions = cleanString(args?.instructions || args?.focus || args?.goal);
  const allowedTools = arrayOfStrings(args?.allowed_tools || args?.allowedTools);
  const notificationChannels = arrayOfStrings(args?.notification_channels || args?.notificationChannels);
  const skillIds = arrayOfStrings(args?.skill_ids || args?.skillIds);

  return {
    interval: interval as any,
    executionTarget: VALID_EXECUTION_TARGETS.has(executionTarget) ? executionTarget as any : 'local',
    modelMode: VALID_MODEL_MODES.has(modelMode) ? modelMode as any : 'balanced',
    modelId: cleanString(args?.model_id || args?.modelId),
    instructions,
    contextPermissions: {
      screenshot: false,
      systemAudio: false,
      micAudio: false,
      ...(args?.context_permissions || args?.contextPermissions || {}),
    },
    allowedTools: allowedTools || [],
    notificationChannels: (notificationChannels || ['app']) as any,
    ...(skillIds ? { skillIds } : {}),
    memoryEnabled: args?.memory_enabled === false || args?.memoryEnabled === false ? false : true,
  };
}

async function buildBotStatusSnapshot(bot: Bot, opts: { pullVmMemory?: boolean; taskLimit?: number; wakeLimit?: number; memoryLimit?: number } = {}) {
  const latestBot = botService.get(bot.id) || bot;
  const config = botService.resolveConfig(latestBot.id);
  let vmMemorySync: any = undefined;
  if (opts.pullVmMemory !== false && latestBot.vmDeployedAt) {
    try {
      vmMemorySync = await pullBotMemoryFromVm(latestBot.id);
    } catch (e: any) {
      vmMemorySync = { ok: false, error: String(e?.message || e || 'vm_memory_pull_failed') };
    }
  }

  const taskLimit = Math.min(Math.max(Number(opts.taskLimit || 10), 1), 50);
  const wakeLimit = Math.min(Math.max(Number(opts.wakeLimit || 5), 1), 20);
  const memoryLimit = Math.min(Math.max(Number(opts.memoryLimit || 12), 1), 50);
  const tasks = proactiveService.listTasks({ botId: latestBot.id, limit: taskLimit });
  const activeTasks = proactiveService.listTasks({ botId: latestBot.id, limit: taskLimit, status: 'queued' });
  const inProgressTasks = proactiveService.listTasks({ botId: latestBot.id, limit: taskLimit, status: 'in_progress' });
  const wakeUps = proactiveService.getWakeUpLog(wakeLimit, { botId: latestBot.id });
  const cards = botMemoryService.listCards(latestBot.id).slice(0, memoryLimit);
  const runLog = botMemoryService.listRunLog(latestBot.id, memoryLimit);

  return {
    bot: summarizeBot(latestBot, config),
    tasks: tasks.tasks,
    activeTasks: [...activeTasks.tasks, ...inProgressTasks.tasks],
    recentWakeUps: wakeUps.logs,
    memory: {
      cards,
      runLog,
      vmSync: vmMemorySync,
    },
  };
}

export async function execBotList(args: any, _ctx: RouterContext): Promise<any> {
  const includePaused = args?.include_paused !== false && args?.includePaused !== false;
  const includeConfig = !!(args?.include_config || args?.includeConfig);
  const bots = botService
    .list()
    .filter((bot) => includePaused || bot.status !== 'paused')
    .map((bot) => summarizeBot(bot, includeConfig ? botService.resolveConfig(bot.id) : null));
  return { ok: true, bots, total: bots.length };
}

export async function execBotGetStatus(args: any, _ctx: RouterContext): Promise<any> {
  const bot = resolveBot(args);
  if (!bot) return botNotFound(args);
  const snapshot = await buildBotStatusSnapshot(bot, {
    pullVmMemory: args?.pull_vm_memory !== false && args?.pullVmMemory !== false,
    taskLimit: args?.task_limit || args?.taskLimit,
    wakeLimit: args?.wake_limit || args?.wakeLimit,
    memoryLimit: args?.memory_limit || args?.memoryLimit,
  });
  return { ok: true, ...snapshot };
}

export async function execBotCreate(args: any, _ctx: RouterContext): Promise<any> {
  const name = cleanString(args?.name || args?.bot_name);
  if (!name) return { ok: false, error: 'name is required' };

  const triggers = buildTriggers(args);
  const config = buildConfig(args, triggers);
  const deployMode = normalizeDeployMode(args?.deploy || args?.deploy_mode || args?.deployMode || (args?.deploy_to_vm || args?.deployToVm ? 'vm' : args?.start ? 'local' : 'paused'));
  const status = VALID_BOT_STATUSES.has(cleanString(args?.status)) ? cleanString(args?.status) as any : (deployMode === 'paused' ? 'paused' : 'running');

  const bot = botService.create({
    name,
    emoji: cleanString(args?.emoji) || undefined,
    systemPrompt: cleanString(args?.system_prompt || args?.systemPrompt || args?.prompt),
    storedFacts: cleanString(args?.stored_facts || args?.storedFacts),
    triggers,
    status,
    config,
  });

  if (status === 'running') {
    try { syncBotTriggers(bot.id); } catch { /* best effort */ }
  }

  let vmDeployment: any = undefined;
  if (deployMode === 'vm' || deployMode === 'both') {
    vmDeployment = await deployBotToVm(bot.id);
  }

  const latest = botService.get(bot.id) || bot;
  return {
    ok: vmDeployment ? !!vmDeployment.ok : true,
    bot: summarizeBot(latest, botService.resolveConfig(latest.id)),
    vmDeployment,
    error: vmDeployment && !vmDeployment.ok ? vmDeployment.error : undefined,
  };
}

export async function execBotDeploy(args: any, _ctx: RouterContext): Promise<any> {
  const bot = resolveBot(args);
  if (!bot) return botNotFound(args);
  const target = String(args?.target || args?.deploy || args?.deploy_mode || 'local').trim().toLowerCase();
  const deployLocal = target === 'local' || target === 'both';
  const deployVm = target === 'vm' || target === 'both' || args?.deploy_to_vm === true || args?.deployToVm === true;
  let localBot: Bot | null = bot;
  let vmDeployment: any = undefined;

  if (deployLocal || !deployVm) {
    localBot = botService.setStatus(bot.id, 'running');
    try { syncBotTriggers(bot.id); } catch { /* best effort */ }
  }
  if (deployVm) {
    vmDeployment = await deployBotToVm(bot.id);
  }

  const latest = botService.get(bot.id) || localBot || bot;
  return {
    ok: vmDeployment ? !!vmDeployment.ok : true,
    bot: summarizeBot(latest, botService.resolveConfig(latest.id)),
    vmDeployment,
    error: vmDeployment && !vmDeployment.ok ? vmDeployment.error : undefined,
  };
}

export async function execBotPause(args: any, _ctx: RouterContext): Promise<any> {
  const bot = resolveBot(args);
  if (!bot) return botNotFound(args);
  const target = String(args?.target || 'local').trim().toLowerCase();
  const pauseLocal = target === 'local' || target === 'both' || target === 'all';
  const pauseVm = target === 'vm' || target === 'both' || target === 'all' || args?.stop_vm === true || args?.stopVm === true;
  let vmStop: any = undefined;

  if (pauseLocal || !pauseVm) {
    botService.setStatus(bot.id, 'paused');
    try { syncBotTriggers(bot.id); } catch { /* best effort */ }
  }
  if (pauseVm) {
    vmStop = await stopBotOnVm(bot.id);
  }

  const latest = botService.get(bot.id) || bot;
  return {
    ok: vmStop ? !!vmStop.ok : true,
    bot: summarizeBot(latest, botService.resolveConfig(latest.id)),
    vmStop,
    error: vmStop && !vmStop.ok ? vmStop.error : undefined,
  };
}

export async function execBotDelete(args: any, _ctx: RouterContext): Promise<any> {
  const bot = resolveBot(args);
  if (!bot) return botNotFound(args);

  const target = String(args?.target || 'all').trim().toLowerCase();
  const deleteLocal = target === 'local' || target === 'both' || target === 'all';
  const deleteVm = target === 'vm' || target === 'both' || target === 'all' || args?.delete_vm === true || args?.deleteVm === true;
  let vmDelete: any = undefined;

  if (deleteVm && bot.vmDeployedAt) {
    vmDelete = await stopBotOnVm(bot.id);
  }

  let localDelete: any = { ok: true, skipped: true };
  if (deleteLocal || !deleteVm) {
    localDelete = botService.delete(bot.id);
    try { syncBotTriggers(bot.id); } catch { /* best effort */ }
  }

  return {
    ok: !!localDelete.ok && (!vmDelete || !!vmDelete.ok),
    deleted: !!localDelete.ok && !localDelete.skipped,
    bot: summarizeBot(bot, botService.resolveConfig(bot.id)),
    vmDelete,
    error: localDelete.error || (vmDelete && !vmDelete.ok ? vmDelete.error : undefined),
  };
}

export async function execBotAsk(args: any, _ctx: RouterContext): Promise<any> {
  const bot = resolveBot(args);
  if (!bot) return botNotFound(args);

  const question = cleanString(args?.question || args?.message || args?.prompt);
  const snapshot = await buildBotStatusSnapshot(bot, {
    pullVmMemory: args?.pull_vm_memory !== false && args?.pullVmMemory !== false,
    taskLimit: args?.task_limit || args?.taskLimit || 12,
    wakeLimit: args?.wake_limit || args?.wakeLimit || 8,
    memoryLimit: args?.memory_limit || args?.memoryLimit || 20,
  });

  let wakeUp: any = undefined;
  if (args?.run_now || args?.runNow) {
    executeWakeUpForBot({
      botId: bot.id,
      manual: true,
      triggerPayload: {
        source: 'chat_mention',
        question,
        requestedAt: new Date().toISOString(),
      },
    });
    wakeUp = { ok: true, queued: true };
  }

  return {
    ok: true,
    question,
    requestedWakeUp: !!wakeUp,
    wakeUp,
    ...snapshot,
    guidance: 'Use this snapshot to answer the user as the mentioned bot status/source of truth. If requestedWakeUp is true, tell the user a manual bot run was started.',
  };
}
