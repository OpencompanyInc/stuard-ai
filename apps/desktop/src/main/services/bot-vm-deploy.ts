/**
 * Bot VM Deployment
 *
 * Pushes a bot's effective config to the user's cloud VM so the VM's
 * standalone proactive scheduler runs the same workload 24/7. This is
 * additive — local execution continues regardless. The user thinks of it
 * as "also run this in the cloud", not "switch to cloud".
 *
 * Architecture: desktop sends deployed bots to cloud-ai's `/v1/bot/sync`;
 * cloud-ai relays them to the VM's `bots_sync` command. The VM owns runtime
 * state and VM-written kanban memory; desktop owns config and user edits.
 *
 * Manual runs initiated from the Cloud Engine UI go to the VM explicitly
 * via `/v1/bot/run` (see proactive-scheduler.triggerVmWakeUp). Manual runs
 * from the desktop UI continue to fire the local proactive-scheduler.
 */
import { BrowserWindow, net } from 'electron';
import logger from '../utils/logger';
import { botService, type Bot, type BotConfig } from './bot-service';
import { botMemoryService } from './bot-memory-service';
import { loadSkills } from '../skills';
import { getChatModelsSettings } from '../settings';

function getCloudAiHttp(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.VITE_CLOUD_AI_URL ||
    ''
  ).trim().replace(/\/+$/, '') || 'http://127.0.0.1:8082';
}

async function getAuthToken(): Promise<string | null> {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      const token = await win.webContents.executeJavaScript(
        `(async () => { try { const { data } = await window.supabase?.auth?.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
        true,
      );
      if (token) return token;
    }
  } catch { /* fall through */ }
  return null;
}

interface DeployResult {
  ok: boolean;
  error?: string;
  config?: any;
  count?: number;
}

function intervalFromBotTriggers(bot: Bot, fallback: string): string {
  // The VM scheduler reads a single interval. Pull it from the primary
  // schedule.interval trigger if there is one; otherwise honor the legacy
  // BotConfig.interval mirror.
  const intervalTrigger = bot.triggers.find(t => t.type === 'schedule.interval' && t.enabled !== false);
  return intervalTrigger ? String(intervalTrigger.args?.every || fallback) : fallback;
}

async function callVmConfig(payload: Record<string, any>): Promise<DeployResult> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  const cloud = getCloudAiHttp();
  try {
    const resp = await net.fetch(`${cloud}/v1/proactive/vm-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await resp.json() as any;
    if (!resp.ok || data?.ok === false) {
      return { ok: false, error: String(data?.error || `http_${resp.status}`) };
    }
    return { ok: true, config: data?.config };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'vm_unreachable') };
  }
}

async function callBotEndpoint(path: string, payload: Record<string, any>): Promise<DeployResult & Record<string, any>> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  const cloud = getCloudAiHttp();
  try {
    const resp = await net.fetch(`${cloud}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await resp.json() as any;
    if (!resp.ok || data?.ok === false) {
      return { ...(data || {}), ok: false, error: String(data?.error || `http_${resp.status}`) };
    }
    return { ...(data || {}), ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'vm_unreachable') };
  }
}

function composeInstructions(bot: Bot, config: BotConfig): string {
  return [
    bot.systemPrompt?.trim() ? `# Identity & objective\n${bot.systemPrompt.trim()}` : '',
    config.memoryEnabled && bot.storedFacts?.trim() ? `# Things to remember\n${bot.storedFacts.trim()}` : '',
    config.instructions?.trim() ? `# Today's focus\n${config.instructions.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}

function toVmBotPayload(bot: Bot, config: BotConfig): Record<string, any> {
  return {
    id: bot.id,
    name: bot.name,
    emoji: bot.emoji,
    status: bot.status === 'running' ? 'running' : bot.status === 'errored' ? 'errored' : 'paused',
    triggers: Array.isArray(bot.triggers) ? bot.triggers : [],
    lastRunAt: bot.lastRunAt ?? null,
    nextRunAt: bot.nextRunAt ?? null,
    config: {
      interval: intervalFromBotTriggers(bot, config.interval),
      modelMode: config.modelMode,
      modelId: config.modelId,
      modelConfig: getChatModelsSettings(),
      instructions: composeInstructions(bot, config),
      allowedTools: Array.isArray(config.allowedTools) ? config.allowedTools : [],
      notificationChannels: Array.isArray(config.notificationChannels) ? config.notificationChannels : ['app'],
      memoryEnabled: config.memoryEnabled !== false,
      skillIds: config.skillIds,
    },
    memory: botMemoryService.exportSnapshot(bot.id),
  };
}

async function syncDeployedBotsToVm(opts: { includeBotId?: string; excludeBotId?: string } = {}): Promise<DeployResult> {
  const bots: Record<string, any>[] = [];
  for (const bot of botService.list()) {
    if (opts.excludeBotId && bot.id === opts.excludeBotId) continue;
    const shouldInclude = !!bot.vmDeployedAt || bot.id === opts.includeBotId;
    if (!shouldInclude) continue;
    const config = botService.resolveConfig(bot.id);
    if (!config) continue;
    bots.push(toVmBotPayload(bot, config));
  }
  return callBotEndpoint('/v1/bot/sync', { bots });
}

/**
 * Push the user's full active skill set to the VM. Bots on the VM filter this
 * by their own skillIds at wakeup time (mirrors the desktop scheduler).
 * Called on every bot deploy and whenever skills change.
 */
export async function pushSkillsToVm(): Promise<{ ok: boolean; count?: number; error?: string }> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'not_authenticated' };
  const cloud = getCloudAiHttp();
  const activeSkills = loadSkills().filter(s => s.isActive);
  try {
    const resp = await net.fetch(`${cloud}/v1/bot/skills-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ skills: activeSkills }),
    });
    const data = await resp.json() as any;
    if (!resp.ok || data?.ok === false) {
      return { ok: false, error: String(data?.error || `http_${resp.status}`) };
    }
    return { ok: true, count: data?.count };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'vm_unreachable') };
  }
}

export async function deployBotToVm(botId: string): Promise<DeployResult & { bot?: Bot }> {
  const bot = botService.get(botId);
  if (!bot) return { ok: false, error: 'bot_not_found' };
  const config: BotConfig | null = botService.resolveConfig(botId);
  if (!config) return { ok: false, error: 'config_not_found' };

  const result = await syncDeployedBotsToVm({ includeBotId: botId });
  if (!result.ok) {
    logger.warn(`[bot-vm-deploy] Deploy failed for ${botId}: ${result.error}`);
    return result;
  }
  callVmConfig({ enabled: false }).catch(() => {});

  // Push the user's active skills alongside the config so the VM bot scheduler
  // can include the right subset on each wakeup. Non-fatal if it fails — the
  // bot will still run, just without skills until the next sync.
  const skillsResult = await pushSkillsToVm();
  if (!skillsResult.ok) {
    logger.warn(`[bot-vm-deploy] Skills sync failed for ${botId}: ${skillsResult.error}`);
  } else {
    logger.info(`[bot-vm-deploy] Synced ${skillsResult.count ?? 0} skill(s) to VM`);
  }

  const updated = botService.update(botId, { vmDeployedAt: new Date().toISOString() });
  logger.info(`[bot-vm-deploy] Deployed bot ${botId} to VM (${result.count ?? '?'} synced)`);
  return { ...result, bot: updated || undefined };
}

export async function stopBotOnVm(botId: string): Promise<DeployResult & { bot?: Bot }> {
  const bot = botService.get(botId);
  if (!bot) return { ok: false, error: 'bot_not_found' };
  // Re-sync the deployed bot set without this bot; an empty set stops the VM
  // multi-bot loop. The legacy proactive scheduler is disabled below as a
  // best-effort cleanup for older VM configs.
  const result = await syncDeployedBotsToVm({ excludeBotId: botId });
  if (!result.ok) {
    logger.warn(`[bot-vm-deploy] Stop-on-VM failed for ${botId}: ${result.error}`);
    return result;
  }
  callVmConfig({ enabled: false }).catch(() => {});
  const updated = botService.update(botId, { vmDeployedAt: null });
  logger.info(`[bot-vm-deploy] Stopped bot ${botId} on VM`);
  return { ...result, bot: updated || undefined };
}

export async function pullBotMemoryFromVm(botId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const bot = botService.get(botId);
  if (!bot || !bot.vmDeployedAt) return { ok: true, skipped: true };
  const result = await callBotEndpoint('/v1/bot/memory/export', { botId });
  if (!result.ok) return { ok: false, error: result.error };
  botMemoryService.mergeSnapshot(botId, {
    cards: Array.isArray(result.cards) ? result.cards : [],
    runLog: Array.isArray(result.runLog) ? result.runLog : [],
  });
  return { ok: true };
}

export async function getBotStatusFromVm(botId: string): Promise<{ ok: boolean; skipped?: boolean; bot?: any; bots?: any[]; error?: string }> {
  const bot = botService.get(botId);
  if (!bot || !bot.vmDeployedAt) return { ok: true, skipped: true, bot: null };
  const result = await callBotEndpoint('/v1/bot/status', { botId });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    bot: result.bot || null,
    bots: Array.isArray(result.bots) ? result.bots : undefined,
  };
}

export async function pushBotMemoryToVm(botId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const bot = botService.get(botId);
  if (!bot || !bot.vmDeployedAt) return { ok: true, skipped: true };
  const result = await callBotEndpoint('/v1/bot/memory/replace', {
    botId,
    memory: botMemoryService.exportSnapshot(botId),
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function syncBotDeploymentToVm(botId: string): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const bot = botService.get(botId);
  if (!bot || !bot.vmDeployedAt) return { ok: true, skipped: true };
  const result = await syncDeployedBotsToVm();
  if (!result.ok) return { ok: false, error: result.error };
  pushSkillsToVm().catch((e) => logger.warn(`[bot-vm-deploy] Skills sync failed during config sync for ${botId}: ${e?.message || e}`));
  return { ok: true };
}
