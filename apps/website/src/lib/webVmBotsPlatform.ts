import type { IBotsPlatform } from '@stuardai/bots-ui/platform';
import type { Bot, BotConfig } from '@stuardai/bots-ui';
import type { VmBot } from '@stuardai/cloud-client/types';
import {
  deleteVmAgent,
  getVmBotsStatus,
  listVmBots,
  runVmBot,
  sendVmCommand,
} from '@/lib/cloudApi';

function mapVmBot(raw: VmBot): Bot {
  const now = new Date().toISOString();
  return {
    id: raw.id,
    name: raw.name || 'Agent',
    emoji: raw.emoji || '🤖',
    systemPrompt: '',
    storedFacts: '',
    triggers: (raw.triggers || []).map((t) => ({
      id: t.id,
      type: t.type as Bot['triggers'][0]['type'],
      args: t.args || {},
      enabled: t.enabled,
    })),
    status: (raw.status as Bot['status']) || 'paused',
    createdAt: now,
    updatedAt: now,
    lastRunAt: raw.lastRunAt ?? null,
    nextRunAt: raw.nextRunAt ?? null,
    vmDeployedAt: now,
    config: raw.config
      ? {
          interval: (raw.config.interval || '30m') as BotConfig['interval'],
          executionTarget: 'cloud',
          modelMode: raw.config.modelMode || 'balanced',
          modelId: raw.config.modelId,
          instructions: raw.config.instructions || '',
          contextPermissions: { screenshot: false, systemAudio: false, micAudio: false },
          allowedTools: raw.config.allowedTools || [],
          notificationChannels: ['app'],
          memoryEnabled: raw.config.memoryEnabled ?? true,
          skillIds: raw.config.skillIds,
        }
      : undefined,
  };
}

export function createWebVmBotsPlatform(): IBotsPlatform {
  return {
    readOnly: true,
    async list() {
      const [listRes, statusRes] = await Promise.all([
        listVmBots(),
        getVmBotsStatus(),
      ]);
      const statusById = new Map<string, VmBot>();
      if (statusRes.ok && Array.isArray(statusRes.bots)) {
        for (const b of statusRes.bots as VmBot[]) statusById.set(b.id, b);
      }
      const rawBots: VmBot[] = listRes.ok && Array.isArray(listRes.bots)
        ? (listRes.bots as VmBot[])
        : [];
      const merged = rawBots.map((b) => ({ ...b, ...(statusById.get(b.id) || {}) }));
      return { ok: true, bots: merged.map(mapVmBot) };
    },
    async delete(id) {
      return deleteVmAgent(id);
    },
    async runNow(id) {
      return runVmBot(id);
    },
    async triggerOnVm(id) {
      return runVmBot(id);
    },
    async getVmStatus(id) {
      const res = await getVmBotsStatus();
      if (!res.ok || !Array.isArray(res.bots)) return { ok: false };
      const bot = (res.bots as VmBot[]).find((b) => b.id === id);
      return bot ? { ok: true, bot } : { ok: false };
    },
    async memoryListCards(id, status) {
      const res = await sendVmCommand('bot_memory_list', { botId: id, status }, 15_000);
      return {
        ok: !!res.ok,
        cards: Array.isArray((res as { cards?: unknown[] }).cards) ? (res as { cards?: unknown[] }).cards : [],
        error: res.error as string | undefined,
      };
    },
    async memoryListRunLog(id, limit = 20) {
      const res = await sendVmCommand('bot_memory_log', { botId: id, limit }, 15_000);
      return {
        ok: !!res.ok,
        runLog: Array.isArray((res as { runLog?: unknown[] }).runLog) ? (res as { runLog?: unknown[] }).runLog : [],
        error: res.error as string | undefined,
      };
    },
  };
}
