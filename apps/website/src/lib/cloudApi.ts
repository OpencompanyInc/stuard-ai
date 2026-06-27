/**
 * Cloud Engine API Client — website wrapper around @stuardai/cloud-client.
 * Uses the Next.js proxy transport for JSON APIs and direct origin for SSE streams.
 */

import {
  createBrowserOriginTransport,
  createCloudClient,
  createProxyTransport,
} from '@stuardai/cloud-client';
import type {
  CloudDeployKind,
  CloudDeployStatus,
  CloudDeployment,
  CloudDeploymentTriggerBinding,
  VmBot,
  VmBotConfig,
  VmBotMemoryEntry,
  VmBotTrigger,
  VmChatAttachment,
  VmPermissionsConfig,
  VmRelayOptions,
} from '@stuardai/cloud-client';
import { buildWebsiteCloudProxyPath, resolveBrowserCloudApiOrigin } from '@stuardai/cloud-client/origins';
import { supabase } from './supabaseClient';

export type {
  CloudDeployKind,
  CloudDeployStatus,
  CloudDeployment,
  CloudDeploymentTriggerBinding,
  VmBot,
  VmBotConfig,
  VmBotMemoryEntry,
  VmBotTrigger,
  VmChatAttachment,
  VmPermissionsConfig,
  VmRelayOptions,
};

export async function getCloudAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const storedToken = localStorage.getItem('stuard_access_token');
  if (storedToken) return storedToken;

  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

const cloudClient = createCloudClient({
  transport: createProxyTransport({
    buildProxyPath: buildWebsiteCloudProxyPath,
    getAccessToken: getCloudAccessToken,
  }),
  directTransport: createBrowserOriginTransport({
    resolveOrigin: resolveBrowserCloudApiOrigin,
    getAccessToken: getCloudAccessToken,
  }),
  getAccessToken: getCloudAccessToken,
});

export const getCloudEngineStatus = cloudClient.getCloudEngineStatus;
export const getCloudEngineTiers = cloudClient.getCloudEngineTiers;
export const provisionCloudEngine = cloudClient.provisionCloudEngine;
export const startCloudEngine = cloudClient.startCloudEngine;
export const stopCloudEngine = cloudClient.stopCloudEngine;
export const deleteCloudEngine = cloudClient.deleteCloudEngine;
export const listFiles = cloudClient.listFiles;
export const readFile = cloudClient.readFile;
// Session-based serve URL (HTML preview with relative assets) + localhost-port
// preview (dev servers running inside the VM). Both resolve via the direct
// browser-origin transport so the iframe can load them. Mirrors desktop.
export const getServeUrl = cloudClient.getServeUrl;
export const getPreviewUrl = cloudClient.getPreviewUrl;
export const writeFile = cloudClient.writeFile;
export const deleteFile = cloudClient.deleteFile;
export const renameFile = cloudClient.renameFile;
export const createDirectory = cloudClient.createDirectory;
export const uploadFileToVm = cloudClient.uploadFileToVm;
export const getMetrics = cloudClient.getMetrics;
export const getMetricsHistory = cloudClient.getMetricsHistory;
export const getHealthStatus = cloudClient.getHealthStatus;
export const createSnapshot = cloudClient.createSnapshot;
export const listSnapshots = cloudClient.listSnapshots;
export const getSnapshot = cloudClient.getSnapshot;
export const restoreSnapshot = cloudClient.restoreSnapshot;
export const deleteSnapshot = cloudClient.deleteSnapshot;
export const getComputeUsage = cloudClient.getComputeUsage;
export const sendVMAgentChat = cloudClient.sendVMAgentChat;
export const openVMAgentChatStream = cloudClient.openVMAgentChatStream;
export const getVMStatus = cloudClient.getVMStatus;
export const getCloudConversations = cloudClient.getCloudConversations;
export const getCloudConversationMessages = cloudClient.getCloudConversationMessages;
export const sendVmToolResult = cloudClient.sendVmToolResult;
export const vmRelay = cloudClient.vmRelay;
export const sendVmCommand = cloudClient.sendVmCommand;
export const getCloudVmIntegrations = cloudClient.getCloudVmIntegrations;
export const listCloudDeployments = cloudClient.listCloudDeployments;
export const createCloudDeployment = cloudClient.createCloudDeployment;
export const getCloudDeployment = cloudClient.getCloudDeployment;
export const getCloudDeploymentLogs = cloudClient.getCloudDeploymentLogs;
export const stopCloudDeployment = cloudClient.stopCloudDeployment;
export const restartCloudDeployment = cloudClient.restartCloudDeployment;
export const deleteCloudDeployment = cloudClient.deleteCloudDeployment;
export const getVmPermissions = cloudClient.getVmPermissions;
export const setVmPermissions = cloudClient.setVmPermissions;
export const getVmBotsStatus = cloudClient.getVmBotsStatus;
export const listVmBots = cloudClient.listVmBots;
export const runVmBot = cloudClient.runVmBot;
export const deleteVmBot = cloudClient.deleteVmBot;
export const exportVmBotMemory = cloudClient.exportVmBotMemory;
export const getCloudSyncPreferences = cloudClient.getCloudSyncPreferences;

export const getVmAgentsStatus = getVmBotsStatus;
export const listVmAgents = listVmBots;
export const runVmAgent = runVmBot;
export const deleteVmAgent = deleteVmBot;
export const exportVmAgentMemory = exportVmBotMemory;
