/**
 * Bot VM Deployment
 *
 * Pushes a bot's effective config to the user's cloud VM so the VM's
 * standalone proactive scheduler runs the same workload 24/7. This is
 * additive — local execution continues regardless. The user thinks of it
 * as "also run this in the cloud", not "switch to cloud".
 *
 * Architecture: we reuse the existing `/v1/proactive/vm-config` endpoint
 * (cloud-ai → VM via `proactive_config` command). The VM today supports a
 * single proactive config; in v1 the deployed bot becomes the active VM
 * config. Multi-bot VM scheduling is a follow-up.
 */
import { BrowserWindow, net } from 'electron';
import logger from '../utils/logger';
import { botService, type Bot, type BotConfig } from './bot-service';
import { loadSkills } from '../skills';

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

  const interval = intervalFromBotTriggers(bot, config.interval);

  // Compose the same identity-aware instructions the local scheduler builds
  // so the VM behaves like the bot, not generic Stuard.
  const composedInstructions = [
    bot.systemPrompt?.trim() ? `# Identity & objective\n${bot.systemPrompt.trim()}` : '',
    config.memoryEnabled && bot.storedFacts?.trim() ? `# Things to remember\n${bot.storedFacts.trim()}` : '',
    config.instructions?.trim() ? `# Today's focus\n${config.instructions.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await callVmConfig({
    enabled: true,
    interval,
    modelMode: config.modelMode,
    instructions: composedInstructions,
    notificationChannels: config.notificationChannels,
  });
  if (!result.ok) {
    logger.warn(`[bot-vm-deploy] Deploy failed for ${botId}: ${result.error}`);
    return result;
  }

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
  logger.info(`[bot-vm-deploy] Deployed bot ${botId} to VM (interval=${interval})`);
  return { ...result, bot: updated || undefined };
}

export async function stopBotOnVm(botId: string): Promise<DeployResult & { bot?: Bot }> {
  const bot = botService.get(botId);
  if (!bot) return { ok: false, error: 'bot_not_found' };
  // We can only "disable the active VM proactive" — the VM doesn't yet
  // distinguish between bots. Sending `enabled: false` stops the loop;
  // the bot's stored config stays available for redeploy.
  const result = await callVmConfig({ enabled: false });
  if (!result.ok) {
    logger.warn(`[bot-vm-deploy] Stop-on-VM failed for ${botId}: ${result.error}`);
    return result;
  }
  const updated = botService.update(botId, { vmDeployedAt: null });
  logger.info(`[bot-vm-deploy] Stopped bot ${botId} on VM`);
  return { ...result, bot: updated || undefined };
}
