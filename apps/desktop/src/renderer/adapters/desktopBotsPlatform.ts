import type { IBotsPlatform } from '@stuardai/bots-ui/platform';
import { getCloudAiHttp } from '../utils/cloud';
import { supabase } from '../lib/supabaseClient';

type DesktopApi = typeof window.desktopAPI;

export function createDesktopBotsPlatform(api: DesktopApi = window.desktopAPI): IBotsPlatform {
  return {
    list: () => api.botsList(),
    create: (payload) => api.botsCreate(payload),
    update: (id, patch) => api.botsUpdate(id, patch),
    updateConfig: (id, patch) => api.botsUpdateConfig(id, patch),
    delete: (id) => api.botsDelete(id),
    deploy: (id) => api.botsDeployToVm(id),
    stopOnVm: (id) => api.botsStopOnVm(id),
    getVmStatus: (id) => api.botsGetVmStatus?.(id) ?? Promise.resolve({ ok: false }),
    runNow: (id) => api.botsTriggerNow(id),
    triggerOnVm: (id) => api.botsTriggerOnVm(id),
    setStatus: (id, status) => api.botsSetStatus(id, status),
    getConfig: (id) => api.botsGetConfig(id),
    listTasks: (id) => api.botsListTasks(id),
    getWakeUpLog: (id, limit) => api.botsGetWakeUpLog(id, limit),
    getAvailableTools: () => api.botsGetAvailableTools(),
    testSetup: (input) => api.botsTestSetup(input),
    runPreflightProbe: (payload) => api.botsRunPreflightProbe(payload),
    addTrigger: (id, input) => api.botsAddTrigger(id, input),
    removeTrigger: (id, triggerId) => api.botsRemoveTrigger(id, triggerId),
    updateTrigger: (id, triggerId, patch) => api.botsUpdateTrigger(id, triggerId, patch),
    memoryListCards: (id, status) => api.botsMemoryListCards(id, status),
    memoryCreateCard: (id, input) => api.botsMemoryCreateCard(id, input),
    memoryUpdateCard: (id, cardId, patch) => api.botsMemoryUpdateCard(id, cardId, patch),
    memoryDeleteCard: (id, cardId) => api.botsMemoryDeleteCard(id, cardId),
    memoryListRunLog: (id, limit) => api.botsMemoryListRunLog(id, limit),
    skillsList: () => api.skillsList(),
    pickFolder: (options) => api.pickFolder(options),
    webhooksLocalUrl: (slug) => api.webhooksLocalUrl(slug),
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data?.session?.access_token || null;
    },
    getCloudAiBaseUrl: () => getCloudAiHttp,
    onBotMemoryChanged: (cb) => api.onBotMemoryChanged?.(cb) ?? (() => {}),
    onProactiveUpdate: (cb) => api.onProactiveUpdate?.(cb) ?? (() => {}),
    onSkillsUpdated: (cb) => api.onSkillsUpdated?.(cb) ?? (() => {}),
  };
}
