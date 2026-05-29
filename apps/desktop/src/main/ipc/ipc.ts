
import { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, nativeImage, type IpcMainInvokeEvent } from "electron";
import * as path from "path";
import { selectFiles, selectImages, listDirectory, selectFolder } from "../utils/files";
import { openDashboardWindow, openOnboardingWindow, closeOnboardingWindow, openVoiceTestWindow, closeVoiceTestWindow, openWorkflowsWindow, openSpacesWindow, closeSpacesWindow, toggleSpacesWindow, openSidebarWindow, closeSidebarWindow, toggleSidebarWindow, getSidebarWindow, setOverlayMode, setOverlaySize, setOverlayBounds, moveOverlayBy, showWindow, hideWindow, toggleWindow, overlayMinimize, overlayToggleMaximize, overlayIsMaximized, createBoardWindow, updateBoardWindow, deleteBoardWindow, listBoardWindows, clearBoardWindows, hideBoardWindow, focusBoardWindow, showBoardWindow, getOverlaySize, getOverlayMode, toggleInternalSidebar, resizeInternalSidebar, getInternalSidebarState, getNotificationWindow, setScreenCaptureInvisible, startOverlayScreenSnip, getMainWindow, showVoiceBorderWindow, hideVoiceBorderWindow, getVoiceBorderWindow } from "../windows";
import { getLocalWebhookPort, handleCloudWebhookEvent, workflows_list, workflows_read, workflows_save, workflows_delete, workflows_run, workflows_stop, workflows_deploy, workflows_undeploy, workflows_getDeployStatus, workflows_runStep, workflows_runFromStep, workflowToStuardSpec, WorkflowDefinition, workflows_createFolder, workflows_renameFolder, workflows_deleteFolder, workflows_moveToFolder, workflows_ensureWorkspace, workflows_getWorkspaceInfo, workflows_listWorkspaceFiles, workflows_readWorkspaceFile, workflows_readWorkspaceFileBinary, workflows_writeWorkspaceFile, workflows_deleteWorkspaceFile, workflows_createWorkspaceSubdir, workflows_renameWorkspaceFile, workflows_moveWorkspaceFile, workflows_createWorkspaceStuard, workflows_readWorkspaceStuard, workflows_saveWorkspaceStuard, workflows_listWorkspaceFunctions, workflows_importAsWorkspaceFunction } from "../workflows";
import { stuards_list, stuards_read, stuards_save, stuards_deploy, stuards_stop, stuards_run, safeStuardId, execLocalTool } from "../stuards";
import { execTool as execUnifiedTool, RouterContext } from "../tool-router";
import { dismissNotificationById, settleNotificationResponse } from "../tools/handlers/electron";
import { settleToolApprovalResponse } from "../services/tool-approval";
import { getOutlookAccessTokenLocal, startOutlookConnect, getOutlookStatus } from "../integrations/outlook";
import { updates_getState, updates_check, updates_download, updates_install, updates_setChannel, startAgent, stopAgent, listAgents, listRoots, addRoot, removeRoot, getStats as getFileIndexStats, scanRoot, searchFiles, getPendingCount, getScanStatus, reinitializeDefaultFolders, runStartupIndexing, processSemanticIndexing, unifiedTasksService, getInstalledApps, refreshAppCache, unifiedSearch, proactiveService, triggerManualWakeUp, triggerVmWakeUp, isProactiveSchedulerRunning, handleProactiveReply, botService, syncBotTriggers, deployBotToVm, stopBotOnVm, pullBotMemoryFromVm, pushBotMemoryToVm, syncBotDeploymentToVm, getBotStatusFromVm, botMemoryService, syncTimezoneToVm } from "../services";
import { setupSpeechIpc } from "./speech";
import { setupTerminalIpc } from "../terminal";
import { setupCodexIpc } from "../codex/codex-service";
import logger from "../utils/logger";
import { getFileIconCached, getFilePreviewCached } from "../services/icon-cache";
import * as fs from "fs";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { getGlobalHotkey, setGlobalHotkey as saveGlobalHotkey, getTimezone, setTimezone, getRendererPrefs, setRendererPrefs, loadSettings, saveSettings } from "../settings";
import { syncMainAuthSession } from "../services/auth-session";
import {
  deleteMediaItem,
  getMediaLibraryPrefs,
  getMediaLibrarySummary,
  importMediaPaths,
  listMediaLibraryItems,
  syncMediaLibrary,
  updateMediaLibraryPrefs,
} from "../services/media-library";
import { skills_list, skills_get, skills_save, skills_delete, skills_toggle, loadSkills } from "../skills";
import { pushDesktopAgentDataToVM, requestAgentDataPush } from "../services/cloud-webhooks";
import { TOOL_REGISTRY } from "../tools/registry";
import { setCustomIntegrationToolNames, listCustomIntegrationToolNames } from "../tools/custom-integrations";
import { testBotSetupPreflight } from "../services/bot-setup-preflight";
import { runBotPreflightProbe, type BotPreflightProbeRequest } from "../services/bot-preflight-probes";
import {
  browserMirrorClickAt,
  browserMirrorPressKey,
  browserMirrorScreenshot,
  browserMirrorScroll,
  browserMirrorType,
  getBrowserUseLocalStatus,
  checkBrowserUseForUpdate,
  installBrowserUse,
  uninstallBrowserUse,
  updateBrowserUse,
} from "../tools/handlers/browser-use";
import {
  getMediapipeLocalStatus,
  checkMediapipeForUpdate,
  installMediapipe,
  uninstallMediapipe,
  updateMediapipe,
  startMediaPipeService,
  stopMediaPipeService,
} from "../services/mediapipe-service";

let nodeNotifier: any = null;
try { nodeNotifier = require('node-notifier'); } catch { }

// SECURITY: SSRF protection - block requests to private/internal IP addresses
function isPrivateOrInternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Block .local and .internal domains
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
      return true;
    }

    // Block file:// and other non-http protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return true;
    }

    // Parse IP address and check for private ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // 10.0.0.0/8 - Private
      if (a === 10) return true;

      // 172.16.0.0/12 - Private
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16 - Private
      if (a === 192 && b === 168) return true;

      // 127.0.0.0/8 - Loopback
      if (a === 127) return true;

      // 169.254.0.0/16 - Link-local
      if (a === 169 && b === 254) return true;

      // 0.0.0.0/8 - Current network
      if (a === 0) return true;

      // 224.0.0.0/4 - Multicast
      if (a >= 224 && a <= 239) return true;

      // 240.0.0.0/4 - Reserved
      if (a >= 240) return true;
    }

    // Block IPv6 private/internal addresses
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      // ::1 loopback
      if (ipv6 === '::1') return true;
      // fe80::/10 link-local
      if (ipv6.startsWith('fe80:')) return true;
      // fc00::/7 unique local
      if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
    }

    return false;
  } catch {
    // If we can't parse the URL, block it to be safe
    return true;
  }
}

type BrowserUseChromeProfile = {
  name: string;
  path: string;
};

type BrowserUseChromeBrowser = {
  browser: string;
  userDataDir: string;
  profiles: BrowserUseChromeProfile[];
};

type BrowserUseChromeSyncSettings = {
  chromeSyncEnabled: boolean;
  chromeSyncBrowserName?: string | null;
  chromeSyncProfileName?: string | null;
  chromeSyncProfilePath?: string | null;
  chromeSyncUserDataDir?: string | null;
};

const DEFAULT_BROWSER_USE_SYNC_SETTINGS: BrowserUseChromeSyncSettings = {
  chromeSyncEnabled: true,
  chromeSyncBrowserName: 'Chrome',
  chromeSyncProfileName: 'Default',
  chromeSyncProfilePath: null,
  chromeSyncUserDataDir: null,
};

function getBrowserUseCandidateUserDataDirs(): Array<{ browser: string; userDataDir: string }> {
  const homeDir = app.getPath('home');
  const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');

  if (process.platform === 'win32') {
    return [
      { browser: 'Chrome', userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
      { browser: 'Edge', userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'Brave', userDataDir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { browser: 'Chromium', userDataDir: path.join(localAppData, 'Chromium', 'User Data') },
      { browser: 'Opera', userDataDir: path.join(appData, 'Opera Software', 'Opera Stable') },
    ];
  }

  if (process.platform === 'darwin') {
    return [
      { browser: 'Chrome', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome') },
      { browser: 'Edge', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge') },
      { browser: 'Brave', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser') },
      { browser: 'Chromium', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Chromium') },
    ];
  }

  return [
    { browser: 'Chrome', userDataDir: path.join(homeDir, '.config', 'google-chrome') },
    { browser: 'Edge', userDataDir: path.join(homeDir, '.config', 'microsoft-edge') },
    { browser: 'Brave', userDataDir: path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser') },
    { browser: 'Chromium', userDataDir: path.join(homeDir, '.config', 'chromium') },
  ];
}

function listProfilesInUserDataDir(userDataDir: string): BrowserUseChromeProfile[] {
  try {
    if (!fs.existsSync(userDataDir)) return [];

    const entries = fs.readdirSync(userDataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name === 'Default' || /^Profile \d+$/i.test(name) || /^Person \d+$/i.test(name))
      .map((name) => ({ name, path: path.join(userDataDir, name) }))
      .filter((profile) => {
        try {
          return fs.existsSync(path.join(profile.path, 'Preferences'));
        } catch {
          return false;
        }
      });

    return entries.sort((a, b) => {
      if (a.name === 'Default') return -1;
      if (b.name === 'Default') return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  } catch {
    return [];
  }
}

function listBrowserUseChromeProfilesLocal(): BrowserUseChromeBrowser[] {
  return getBrowserUseCandidateUserDataDirs()
    .map(({ browser, userDataDir }) => ({
      browser,
      userDataDir,
      profiles: listProfilesInUserDataDir(userDataDir),
    }))
    .filter((entry) => entry.profiles.length > 0);
}

function getBrowserUseChromeSyncSettingsLocal(): BrowserUseChromeSyncSettings {
  const settings = loadSettings();
  const saved: BrowserUseChromeSyncSettings = {
    chromeSyncEnabled: typeof settings.chromeSyncEnabled === 'boolean'
      ? settings.chromeSyncEnabled
      : DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncEnabled,
    chromeSyncBrowserName: settings.chromeSyncBrowserName ?? DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncBrowserName,
    chromeSyncProfileName: settings.chromeSyncProfileName ?? DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncProfileName,
    chromeSyncProfilePath: settings.chromeSyncProfilePath ?? DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncProfilePath,
    chromeSyncUserDataDir: settings.chromeSyncUserDataDir ?? DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncUserDataDir,
  };

  const browsers = listBrowserUseChromeProfilesLocal();
  const selectedBrowser = browsers.find((browser) =>
    browser.browser === saved.chromeSyncBrowserName
    || browser.userDataDir === saved.chromeSyncUserDataDir
  ) || browsers[0];
  const selectedProfile = selectedBrowser?.profiles.find((profile) =>
    profile.path === saved.chromeSyncProfilePath
    || profile.name === saved.chromeSyncProfileName
  ) || selectedBrowser?.profiles[0];

  return {
    ...saved,
    chromeSyncBrowserName: selectedBrowser?.browser || saved.chromeSyncBrowserName || DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncBrowserName,
    chromeSyncProfileName: selectedProfile?.name || saved.chromeSyncProfileName || DEFAULT_BROWSER_USE_SYNC_SETTINGS.chromeSyncProfileName,
    chromeSyncProfilePath: selectedProfile?.path || saved.chromeSyncProfilePath || null,
    chromeSyncUserDataDir: selectedBrowser?.userDataDir || saved.chromeSyncUserDataDir || null,
  };
}

function updateBrowserUseChromeSyncSettingsLocal(updates: Partial<BrowserUseChromeSyncSettings>): BrowserUseChromeSyncSettings {
  const has = (key: keyof BrowserUseChromeSyncSettings) => Object.prototype.hasOwnProperty.call(updates, key);
  saveSettings({
    chromeSyncEnabled: has('chromeSyncEnabled') ? !!updates.chromeSyncEnabled : undefined,
    chromeSyncBrowserName: has('chromeSyncBrowserName') ? (updates.chromeSyncBrowserName ?? null) : undefined,
    chromeSyncProfileName: has('chromeSyncProfileName') ? (updates.chromeSyncProfileName ?? null) : undefined,
    chromeSyncProfilePath: has('chromeSyncProfilePath') ? (updates.chromeSyncProfilePath ?? null) : undefined,
    chromeSyncUserDataDir: has('chromeSyncUserDataDir') ? (updates.chromeSyncUserDataDir ?? null) : undefined,
  });
  return getBrowserUseChromeSyncSettingsLocal();
}

export function setupIpc() {
  setupSpeechIpc();
  setupTerminalIpc();
  setupCodexIpc();
  const proactiveAvailableTools = Object.keys(TOOL_REGISTRY)
    .filter((toolName) => !toolName.startsWith('proactive_task_'))
    .sort((a, b) => a.localeCompare(b));
  // Overlay
  ipcMain.handle("overlay:show", () => showWindow());
  ipcMain.handle("overlay:hide", () => hideWindow());
  ipcMain.handle("overlay:toggle", () => toggleWindow());
  ipcMain.handle("overlay:setMode", (_e, mode: "compact" | "sidebar" | "window") => setOverlayMode(mode));
  ipcMain.handle("overlay:resize", (_e, w: number, h: number, anchor?: 'top' | 'bottom') => setOverlaySize(w, h, false, anchor));
  ipcMain.handle("overlay:setBounds", (_e, bounds: any) => setOverlayBounds(bounds));
  ipcMain.handle("overlay:moveBy", (_e, dx: number, dy: number) => moveOverlayBy(dx, dy));
  ipcMain.handle("overlay:getSize", () => getOverlaySize());
  ipcMain.handle("overlay:getMode", () => getOverlayMode());
  ipcMain.handle("overlay:minimize", () => overlayMinimize());
  ipcMain.handle("overlay:toggleMaximize", () => overlayToggleMaximize());
  ipcMain.handle("overlay:isMaximized", () => overlayIsMaximized());
  ipcMain.handle("overlay:startScreenSnip", () => startOverlayScreenSnip());

  const windowFromEvent = (e: IpcMainInvokeEvent) => {
    try { return BrowserWindow.fromWebContents(e.sender); } catch { return null; }
  };
  ipcMain.handle("window:minimize", (e) => {
    const w = windowFromEvent(e);
    if (w && !w.isDestroyed()) try { w.minimize(); } catch { }
  });
  ipcMain.handle("window:toggleMaximize", (e) => {
    const w = windowFromEvent(e);
    if (w && !w.isDestroyed()) {
      try {
        if (w.isMaximized()) w.unmaximize();
        else w.maximize();
      } catch { }
    }
  });
  ipcMain.handle("window:isMaximized", (e) => {
    const w = windowFromEvent(e);
    if (!w || w.isDestroyed()) return false;
    try { return w.isMaximized(); } catch { return false; }
  });
  ipcMain.handle("window:close", (e) => {
    const w = windowFromEvent(e);
    if (w && !w.isDestroyed()) try { w.close(); } catch { }
  });

  // Internal sidebar (rendered inside overlay window, expands window width)
  ipcMain.handle("overlay:toggleInternalSidebar", (_e, open?: boolean, panelWidth?: number) => toggleInternalSidebar(open, panelWidth));
  ipcMain.handle("overlay:resizeInternalSidebar", (_e, panelWidth: number) => resizeInternalSidebar(panelWidth));
  ipcMain.handle("overlay:getInternalSidebarState", () => getInternalSidebarState());

  // System windows
  ipcMain.handle("system:openDashboard", (_e, options?: { tab?: string }) => openDashboardWindow(options));
  ipcMain.handle("system:openWorkflows", (_e, options?: { marketplaceSlug?: string; workflowId?: string; view?: 'workflows' | 'agents' | 'tools' | 'deployed' | 'shared' | 'marketplace' | 'skills' }) => openWorkflowsWindow(options));
  ipcMain.handle("system:openOnboarding", () => openOnboardingWindow());
  ipcMain.handle("system:closeOnboarding", () => closeOnboardingWindow());
  ipcMain.handle("system:openVoiceTest", () => openVoiceTestWindow());
  ipcMain.handle("system:closeVoiceTest", () => closeVoiceTestWindow());

  // Voice border (full-screen click-through red ambient frame while voice mode is active)
  ipcMain.handle("voice:showBorder", () => { showVoiceBorderWindow(); });
  ipcMain.handle("voice:hideBorder", () => { hideVoiceBorderWindow(); });
  ipcMain.on("voice:borderUpdate", (_e, payload: any) => {
    const w = getVoiceBorderWindow();
    if (w && !w.isDestroyed()) {
      try { w.webContents.send("voice:borderUpdate", payload); } catch { }
    }
  });
  // Control messages from the pill in the border window back to the main app
  ipcMain.on("voice:borderControl", (_e, payload: { action: 'mute' | 'close' | 'shareScreen' }) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      try { main.webContents.send("voice:borderControl", payload); } catch { }
    }
  });
  // Toggle click-through on the border window when the cursor enters or leaves
  // the pill region in the renderer.
  ipcMain.on("voice:borderInteractive", (_e, interactive: boolean) => {
    const w = getVoiceBorderWindow();
    if (!w || w.isDestroyed()) return;
    try {
      if (interactive) {
        w.setIgnoreMouseEvents(false);
      } else {
        w.setIgnoreMouseEvents(true, { forward: true });
      }
    } catch { }
  });

  // Spaces window (legacy - redirects to sidebar)
  ipcMain.handle('spaces:open', () => openSpacesWindow());
  ipcMain.handle('spaces:close', () => closeSpacesWindow());
  ipcMain.handle('spaces:toggle', () => toggleSpacesWindow());

  // Sidebar window (new unified sidebar with Spaces, Canvas, Terminal)
  ipcMain.handle('sidebar:open', (_e, options?: { tab?: 'terminal' | 'todo'; expanded?: boolean }) => openSidebarWindow(options));
  ipcMain.handle('sidebar:close', () => closeSidebarWindow());
  ipcMain.handle('sidebar:toggle', (_e, options?: { tab?: 'terminal' | 'todo'; expanded?: boolean }) => toggleSidebarWindow(options));
  ipcMain.handle('sidebar:navigate', (_e, tab: 'terminal' | 'todo') => {
    const sidebar = getSidebarWindow();
    if (sidebar && !sidebar.isDestroyed()) {
      sidebar.webContents.send('sidebar:navigate', { tab });
    }
  });
  ipcMain.handle('sidebar:toggleExpanded', () => {
    const { toggleSidebarExpanded } = require('../windows');
    return toggleSidebarExpanded();
  });
  ipcMain.handle('sidebar:isExpanded', () => {
    const { isSidebarExpanded } = require('../windows');
    return { expanded: isSidebarExpanded() };
  });
  ipcMain.handle('sidebar:setPresentation', (_e, payload?: { mode?: 'full' | 'popup'; tab?: 'terminal' | 'todo' }) => {
    const { setSidebarPresentation } = require('../windows');
    const mode = payload?.mode === 'popup' ? 'popup' : 'full';
    return setSidebarPresentation(mode, payload?.tab);
  });

  // Canvas document storage (persisted locally)
  const canvasDocsPath = () => {
    const userDataPath = app.getPath('userData');
    const docsPath = require('path').join(userDataPath, 'canvas-documents.json');
    return docsPath;
  };

  const loadCanvasDocs = (): any[] => {
    try {
      const p = canvasDocsPath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {
      logger.warn('Failed to load canvas documents:', e);
    }
    return [];
  };

  const saveCanvasDocs = (docs: any[]) => {
    try {
      fs.writeFileSync(canvasDocsPath(), JSON.stringify(docs, null, 2), 'utf-8');
    } catch (e) {
      logger.warn('Failed to save canvas documents:', e);
    }
  };

  ipcMain.handle('canvas:listDocuments', () => {
    return { ok: true, documents: loadCanvasDocs() };
  });

  ipcMain.handle('canvas:createDocument', (_e, doc: any) => {
    const docs = loadCanvasDocs();
    docs.unshift(doc);
    saveCanvasDocs(docs);
    return { ok: true };
  });

  ipcMain.handle('canvas:saveDocument', (_e, doc: any) => {
    const docs = loadCanvasDocs();
    const idx = docs.findIndex((d: any) => d.id === doc.id);
    if (idx >= 0) {
      docs[idx] = doc;
    } else {
      docs.unshift(doc);
    }
    saveCanvasDocs(docs);
    return { ok: true };
  });

  ipcMain.handle('canvas:deleteDocument', (_e, docId: string) => {
    const docs = loadCanvasDocs();
    const filtered = docs.filter((d: any) => d.id !== docId);
    saveCanvasDocs(filtered);
    return { ok: true };
  });

  ipcMain.handle('canvas:getDocument', (_e, docId: string) => {
    const docs = loadCanvasDocs();
    const doc = docs.find((d: any) => d.id === docId);
    return { ok: true, document: doc || null };
  });

  // Canvas AI read/write (for AI to access canvas content)
  ipcMain.handle('canvas:read', (_e, docId?: string) => {
    const docs = loadCanvasDocs();
    if (docId) {
      const doc = docs.find((d: any) => d.id === docId);
      return { ok: true, document: doc || null };
    }
    // Return the most recent document if no ID specified
    return { ok: true, document: docs[0] || null };
  });

  ipcMain.handle('canvas:write', (_e, data: { documentId?: string; content?: string; title?: string; action?: 'append' | 'replace' | 'insert'; position?: number }) => {
    const sidebar = getSidebarWindow();
    if (sidebar && !sidebar.isDestroyed()) {
      sidebar.webContents.send('canvas:update', data);
    }
    return { ok: true };
  });

  // Local webhook URL
  ipcMain.handle('webhooks:localUrl', (_e, id?: string) => {
    const token = '';
    const topic = (typeof id === 'string' && id) ? `/${id}` : '';
    const port = getLocalWebhookPort();
    return { ok: true, url: `http://127.0.0.1:${port}/webhooks/incoming${topic}${token ? `?token=${encodeURIComponent(token)}` : ''}` };
  });

  // Cloud webhook events (received via cloud-ai websocket -> renderer -> preload -> main)
  ipcMain.handle('webhooks:cloudEvent', async (_e, payload: any) => {
    return handleCloudWebhookEvent(payload);
  });

  // Files
  ipcMain.handle("files:select", () => selectFiles());
  ipcMain.handle("files:selectImages", () => selectImages());
  ipcMain.handle("files:selectFolder", (_e, options?: { title?: string; multiple?: boolean }) => selectFolder(options));
  ipcMain.handle("files:showItemInFolder", (_e, filePath: string) => {
    try {
      const p = String(filePath || '').trim();
      if (!p) return { ok: false, error: 'invalid_path' };
      try { shell.showItemInFolder(p); } catch { }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("files:listDirectory", async (_e, dirPath?: string) => {
    try {
      const entries = await listDirectory(dirPath);
      return { ok: true, entries };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:list", () => {
    try {
      return { ok: true, items: listMediaLibraryItems() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:summary", () => {
    try {
      return { ok: true, summary: getMediaLibrarySummary() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:getPrefs", () => {
    try {
      return { ok: true, prefs: getMediaLibraryPrefs() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:updatePrefs", (_e, updates?: { syncMode?: 'local-only' | 'mirror-cloud'; storageRootPath?: string | null }) => {
    try {
      return { ok: true, prefs: updateMediaLibraryPrefs(updates || {}) };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:sync", async (_e, itemIds?: string[]) => {
    try {
      return await syncMediaLibrary(itemIds);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:importPaths", async (_e, paths?: string[]) => {
    try {
      const items = await importMediaPaths(Array.isArray(paths) ? paths : []);
      return { ok: true, items };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:openPath", async (_e, targetPath: string) => {
    try {
      const target = String(targetPath || '').trim();
      if (!target) return { ok: false, error: 'invalid_path' };
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
        return { ok: true };
      }
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("media:delete", (_e, itemId: string, deleteFile = true) => {
    try {
      return deleteMediaItem(String(itemId || ''), Boolean(deleteFile));
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // System helpers


  ipcMain.handle("system:getLinkPreview", async (_e, url: string) => {
    try {
      const UA = 'StuardAI-LinkBot/1.0';
      const normalizeUrl = (raw: string) => {
        const s = String(raw || '').trim().replace(/^<|>$/g, '');
        return s.replace(/[\.,!?;:]+$/g, '');
      };
      const targetUrl = normalizeUrl(url);
      if (!targetUrl || !targetUrl.startsWith('http')) return { ok: false, error: 'invalid_url' };

      // SECURITY: Block SSRF attempts to internal/private networks
      if (isPrivateOrInternalUrl(targetUrl)) {
        console.warn(`[getLinkPreview] SSRF blocked: ${targetUrl}`);
        return { ok: false, error: 'blocked_internal_url', message: 'Cannot fetch preview for internal/private URLs' };
      }

      const response = await fetch(targetUrl, { headers: { 'User-Agent': UA } });
      if (!response.ok) return { ok: false, error: 'fetch_failed' };
      const html = await response.text();

      const getMeta = (prop: string) => {
        const metas = html.match(/<meta\b[^>]*>/gi) || [];
        for (const tag of metas) {
          const attrs: Record<string, string> = {};
          const attrRe = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
          let m: RegExpExecArray | null;
          while ((m = attrRe.exec(tag)) !== null) {
            const key = String(m[1] || '').toLowerCase();
            const val = String(m[3] ?? m[4] ?? m[5] ?? '');
            attrs[key] = val;
          }
          const k = String(attrs.property || attrs.name || '').toLowerCase();
          if (k === prop.toLowerCase()) {
            return attrs.content;
          }
        }
        return undefined;
      };

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = getMeta('og:title') || (titleMatch ? titleMatch[1] : '') || '';
      const description = getMeta('og:description') || getMeta('description') || '';
      const siteName = getMeta('og:site_name') || '';
      let image = getMeta('og:image:secure_url') || getMeta('og:image') || '';

      const resolveAgainst = (maybeUrl: string, base: string) => {
        const v = String(maybeUrl || '').trim();
        if (!v) return '';
        if (v.startsWith('data:')) return v;
        try {
          return new URL(v, base).toString();
        } catch {
          return v;
        }
      };

      const tryFetchImageAsDataUrl = async (imgUrl: string) => {
        try {
          const r = await fetch(imgUrl, { headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8' } });
          if (!r.ok) return undefined;
          const contentType = String(r.headers.get('content-type') || '').split(';')[0].trim();
          const ab = await r.arrayBuffer();
          if (ab.byteLength > 2_000_000) return undefined;
          const b64 = Buffer.from(ab).toString('base64');
          const ct = contentType || 'image/jpeg';
          return `data:${ct};base64,${b64}`;
        } catch {
          return undefined;
        }
      };

      if (image) {
        const resolved = resolveAgainst(image, targetUrl);
        const proxied = resolved.startsWith('http') ? await tryFetchImageAsDataUrl(resolved) : undefined;
        image = proxied || resolved;
      }

      if (!image) {
        let screenshotWin: BrowserWindow | null = null;
        try {
          // Use a real browser User-Agent to avoid bot detection
          const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
          screenshotWin = new BrowserWindow({
            width: 1280,
            height: 800,
            show: false,
            webPreferences: {
              offscreen: true,
              javascript: true,
              webSecurity: true,
            },
          });

          // Wait for page to finish loading with timeout
          const loadPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => resolve(), 8000); // 8s max timeout
            screenshotWin!.webContents.once('did-finish-load', () => {
              clearTimeout(timeout);
              resolve();
            });
            screenshotWin!.webContents.once('did-fail-load', (_e, code, desc) => {
              clearTimeout(timeout);
              reject(new Error(`Load failed: ${code} ${desc}`));
            });
          });

          screenshotWin.loadURL(targetUrl, { userAgent: browserUA });
          await loadPromise;

          // Wait for images and animations to settle
          await new Promise(resolve => setTimeout(resolve, 1500));

          // Scroll to top to ensure we capture the header/hero area
          await screenshotWin.webContents.executeJavaScript('window.scrollTo(0, 0)');
          await new Promise(resolve => setTimeout(resolve, 300));

          const nativeImage = await screenshotWin.webContents.capturePage();
          if (!nativeImage.isEmpty()) {
            const resized = nativeImage.resize({ width: 600, quality: 'good' });
            image = resized.toDataURL();
          }
        } catch (screenshotErr: any) {
          console.warn('[getLinkPreview] Screenshot failed:', screenshotErr?.message);
        } finally {
          try { screenshotWin?.destroy(); } catch { }
        }
      }

      return { ok: true, data: { title, description, image, url: targetUrl, siteName } };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });


  ipcMain.handle("system:openExternal", (_e, url: string) => {
    if (typeof url === 'string') {
      try { shell.openExternal(url); } catch { }
    }
  });
  ipcMain.handle("system:notify", (_e, payload: any) => {
    try {
      const title = String(payload?.title || 'Stuard AI');
      // Normalize body/message
      const message = String(payload?.message || payload?.body || '');
      // Defaults
      const variant = payload?.variant || 'info';
      const position = payload?.position || 'top-right'; // User preferred position
      const duration = typeof payload?.duration === 'number' ? payload.duration : 5000;

      const config = {
        ...payload,
        title,
        message,
        variant,
        position,
        duration,
      };

      const notifWin = getNotificationWindow();
      if (notifWin && !notifWin.isDestroyed()) {
        notifWin.webContents.send('notification:show', config);
      } else {
        // Fallback to native
        if (Notification && typeof (Notification as any).isSupported === 'function' && Notification.isSupported()) {
          const n = new Notification({ title, body: message });
          n.show();
        }
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || 'failed') };
    }
  });

  ipcMain.handle("system:dismissNotification", (_e, id: string) => {
    try {
      const notificationId = String(id || '').trim();
      if (notificationId) {
        dismissNotificationById(notificationId);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || 'failed') };
    }
  });

  ipcMain.on('window:ignore-mouse-events', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setIgnoreMouseEvents(ignore, options);
  });

  // Notification overlay â†’ main process â†’ forward permission response to main app window
  ipcMain.handle('notification:respondToPermission', (_e, payload: { id: string; allow: boolean }) => {
    try {
      if (payload?.id) {
        dismissNotificationById(String(payload.id));
      }
      settleToolApprovalResponse(payload);
      const mainWin = getMainWindow();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('approval:response', { id: payload.id, allow: payload.allow });
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Notification overlay â†’ main process â†’ settle pending notification response (ask_user, etc.)
  ipcMain.handle('notification:respondToNotification', (_e, payload: any) => {
    try {
      settleNotificationResponse(payload);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Logs
  ipcMain.handle("system:openLogs", () => {
    try {
      const logDir = logger.getLogDir();
      shell.openPath(logDir);
      return { ok: true, path: logDir };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("system:getLogPath", () => {
    return { ok: true, path: logger.getLogPath(), dir: logger.getLogDir() };
  });
  ipcMain.handle("system:readLogs", (_e, lines?: number) => {
    try {
      const logPath = logger.getLogPath();
      if (!fs.existsSync(logPath)) {
        return { ok: true, content: '', path: logPath };
      }
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n');
      const n = typeof lines === 'number' && lines > 0 ? lines : 200;
      const lastLines = allLines.slice(-n).join('\n');
      return { ok: true, content: lastLines, path: logPath, totalLines: allLines.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle("system:getAppInfo", () => {
    return {
      ok: true,
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      resources: process.resourcesPath,
      logPath: logger.getLogPath(),
    };
  });

  ipcMain.handle('system:getFilePreview', async (_e, filePath: string, options?: { size?: 'small' | 'normal' | 'large'; preferThumbnail?: boolean }) => {
    try {
      const p = String(filePath || '').trim();
      if (!p) return { ok: false, error: 'invalid_path' };
      return await getFilePreviewCached(p, {
        size: options?.size,
        preferThumbnail: !!options?.preferThumbnail,
      });
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  ipcMain.handle('system:getFileIcon', async (_e, filePath: string, options?: { size?: 'small' | 'normal' | 'large' }) => {
    try {
      const p = String(filePath || '').trim();
      if (!p) return { ok: false, error: 'invalid_path' };
      return await getFileIconCached(p, { size: options?.size });
      const size = options?.size;

      // Expand %ENV_VAR% on Windows and strip quotes / trailing ",N" resource index
      const normalize = (s: string): string => {
        let v = String(s || '').trim();
        if (!v) return '';
        if (process.platform === 'win32') {
          v = v.replace(/%([^%]+)%/g, (_m, name) => {
            const key = String(name || '').trim();
            return key ? String(process.env[key] ?? _m) : _m;
          });
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1).trim();
          }
          const m = v.match(/^(.*?),\s*\d+$/);
          if (m?.[1]) return m[1].trim();
        }
        return v;
      };

      const cleaned = normalize(p);
      if (!cleaned) return { ok: false, error: 'invalid_path' };

      // Squirrel-based apps: if path points to Update.exe, look for the real app exe
      if (process.platform === 'win32' && cleaned.toLowerCase().endsWith('update.exe')) {
        try {
          const dir = path.dirname(cleaned);
          const appDirs = fs.readdirSync(dir).filter((e: string) => e.startsWith('app-')).sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
          if (appDirs.length > 0) {
            const latestDir = path.join(dir, appDirs[0]);
            const exes = fs.readdirSync(latestDir).filter((f: string) => f.toLowerCase().endsWith('.exe') && f.toLowerCase() !== 'update.exe' && !f.toLowerCase().includes('squirrel') && !f.toLowerCase().includes('unins'));
            if (exes.length > 0) {
              const candidate = path.join(latestDir, exes[0]);
              const img = await app.getFileIcon(
                candidate,
                size ? { size: size as 'small' | 'normal' | 'large' } : undefined,
              );
              if (img && !img.isEmpty()) return { ok: true, dataUrl: img.toDataURL() };
            }
          }
        } catch { }
      }

      // .ico / .png / .bmp â€” read actual image bytes via nativeImage
      const extLow = cleaned.toLowerCase();
      if (extLow.endsWith('.ico') || extLow.endsWith('.png') || extLow.endsWith('.bmp')) {
        try {
          if (fs.existsSync(cleaned)) {
            const img = nativeImage.createFromPath(cleaned);
            if (img && !img.isEmpty()) return { ok: true, dataUrl: img.toDataURL() };
          }
        } catch { }
      }

      // Use Electron's built-in app.getFileIcon() â€” works for .exe, .app, and any file
      try {
        const img = await app.getFileIcon(
          cleaned,
          size ? { size: size as 'small' | 'normal' | 'large' } : undefined,
        );
        if (img && !img.isEmpty()) return { ok: true, dataUrl: img.toDataURL() };
      } catch { }

      return { ok: false, error: 'no_icon' };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Theme
  ipcMain.handle('prefs:applyTheme', (_e, data: any) => {
    try {
      const raw = String(data?.themeMode || '').toLowerCase();
      const mode = (raw === 'custom') ? 'custom' : (raw === 'dark' ? 'dark' : 'light');
      const dark = typeof data?.themeDarkShade === 'string' ? data.themeDarkShade : undefined;
      const light = typeof data?.themeLightShade === 'string' ? data.themeLightShade : undefined;
      const txt = (data?.themeText === 'black' || data?.themeText === 'white') ? data.themeText : undefined;
      const payload: any = { themeMode: mode };
      if (dark != null) payload.themeDarkShade = dark;
      if (light != null) payload.themeLightShade = light;
      if (txt != null) payload.themeText = txt;
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send('prefs:themeUpdated', payload); } catch { }
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Screen capture invisibility
  ipcMain.handle('prefs:setScreenCaptureInvisible', (_e, enabled: boolean) => {
    try {
      setScreenCaptureInvisible(!!enabled);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Timezone
  ipcMain.handle('prefs:getTimezone', () => {
    return { ok: true, timezone: getTimezone() };
  });
  ipcMain.handle('prefs:setTimezone', (_e, tz: string | null) => {
    try {
      setTimezone(typeof tz === 'string' && tz.trim() ? tz.trim() : null);
      // Push the new effective tz (override or auto-detected) to the VM.
      // Fire-and-forget — the renderer doesn't need to wait, and this should
      // never fail the local preference save.
      syncTimezoneToVm({ force: true }).catch((e) =>
        logger.warn('[ipc] syncTimezoneToVm after prefs:setTimezone failed:', e),
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Push the desktop's current timezone to the VM. Renderer calls this when
  // the cloud engine flips to "running" so the VM picks up the user's zone
  // without needing a bot redeploy. Throttled inside the service.
  ipcMain.handle('vm:syncTimezone', async (_e, opts?: { force?: boolean }) => {
    try {
      return await syncTimezoneToVm({ force: !!opts?.force });
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Renderer preferences (getAll / set / setMany)
  ipcMain.handle('prefs:getAll', () => {
    try {
      return { ok: true, prefs: getRendererPrefs() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle('prefs:set', (_e, key: string, value: any) => {
    try {
      setRendererPrefs({ [key]: value });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });
  ipcMain.handle('prefs:setMany', (_e, prefs: Record<string, any>) => {
    try {
      setRendererPrefs(prefs);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Auth session sync
  ipcMain.handle('auth:syncSession', async (_e, session: any) => {
    return syncMainAuthSession(session);
  });

  // Cloud Engine â€” agent data upload (desktop â†’ GCS â†’ VM)
  ipcMain.handle('cloud:uploadAgentData', async () => {
    try {
      return await pushDesktopAgentDataToVM();
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'upload_failed') };
    }
  });

  // Fire-and-forget debounced push. Renderer calls this whenever a local
  // conversation finishes, a memory is saved, or any other mutation that
  // should reach the VM promptly without blocking the UI.
  ipcMain.on('cloud:requestAgentDataPush', () => {
    try { requestAgentDataPush(); } catch { /* noop */ }
  });
  ipcMain.handle('cloud:requestAgentDataPush', async () => {
    try { requestAgentDataPush(); return { ok: true }; } catch (e: any) {
      return { ok: false, error: String(e?.message || 'push_failed') };
    }
  });

  // Skills
  loadSkills();
  ipcMain.handle('skills:list', () => skills_list());
  ipcMain.handle('skills:get', (_e, id: string) => skills_get(id));
  ipcMain.handle('skills:save', (_e, skill: any) => skills_save(skill));
  ipcMain.handle('skills:delete', (_e, id: string) => skills_delete(id));
  ipcMain.handle('skills:toggle', (_e, id: string) => skills_toggle(id));

  // Outlook
  ipcMain.handle("outlook:getToken", async () => {
    const r = await getOutlookAccessTokenLocal();
    if (!r.ok) return { ok: false, error: 'not_connected' };
    return r;
  });
  ipcMain.handle("outlook:connect", async () => {
    try {
      const r = await startOutlookConnect();
      return r;
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || 'failed') };
    }
  });
  ipcMain.handle("outlook:status", async () => getOutlookStatus());

  // Canvas/Board windows management
  ipcMain.handle('canvas:create', (_e, item: any) => { try { createBoardWindow(item); } catch { } });
  ipcMain.handle('canvas:update', (_e, item: any) => { try { updateBoardWindow(item); } catch { } });
  ipcMain.handle('canvas:delete', (_e, id: string) => { try { deleteBoardWindow(id); } catch { } });
  ipcMain.handle('canvas:show', (_e, id: string) => { try { showBoardWindow(id); } catch { } });
  ipcMain.handle('canvas:hide', (_e, id: string) => { try { hideBoardWindow(id); } catch { } });
  ipcMain.handle('canvas:focus', (_e, id: string) => { try { focusBoardWindow(id); } catch { } });
  ipcMain.handle('canvas:clear', () => { try { clearBoardWindows(); } catch { } });
  ipcMain.handle('canvas:list', () => { try { return listBoardWindows(); } catch { return []; } });

  // Workflows
  ipcMain.handle('workflows:list', () => workflows_list());
  ipcMain.handle('workflows:read', (_e, id: string) => workflows_read(id));
  ipcMain.handle('workflows:save', (_e, payload: { id: string; content: string }) => workflows_save(payload));
  ipcMain.handle('workflows:delete', (_e, id: string) => workflows_delete(id));
  ipcMain.handle('workflows:run', (_e, id: string, triggerId?: string, options?: { accessToken?: string }) => workflows_run(id, triggerId, options));
  ipcMain.handle('workflows:stop', (_e, id: string) => workflows_stop(id));
  ipcMain.handle('workflows:deploy', (_e, id: string) => workflows_deploy(id));
  ipcMain.handle('workflows:undeploy', (_e, id: string) => workflows_undeploy(id));
  ipcMain.handle('workflows:getDeployStatus', (_e, id: string) => workflows_getDeployStatus(id));
  ipcMain.handle('workflows:runStep', (_e, id: string, options: { step: { id: string; tool: string; args: any }; accessToken?: string }) =>
    workflows_runStep(id, options)
  );
  ipcMain.handle('workflows:runFromStep', (_e, id: string, options: { startStepId: string; accessToken?: string }) =>
    workflows_runFromStep(id, options)
  );
  ipcMain.handle('workflows:export', async (_e, id: string) => {
    return await execLocalTool('export_workflow', { id });
  });
  ipcMain.handle('workflows:import', async (_e, path: string) => {
    return await execLocalTool('import_workflow', { path });
  });
  ipcMain.handle('workflows:validate', async (_e, id: string) => {
    return await execLocalTool('validate_workflow_requirements', { id });
  });
  // Folder operations
  ipcMain.handle('workflows:createFolder', (_e, name: string) => workflows_createFolder(name));
  ipcMain.handle('workflows:renameFolder', (_e, oldName: string, newName: string) => workflows_renameFolder(oldName, newName));
  ipcMain.handle('workflows:deleteFolder', (_e, name: string, deleteContents?: boolean) => workflows_deleteFolder(name, deleteContents));
  ipcMain.handle('workflows:moveToFolder', (_e, id: string, folder: string | null) => workflows_moveToFolder(id, folder));
  // Workspace file management
  ipcMain.handle('workflows:ensureWorkspace', (_e, id: string) => workflows_ensureWorkspace(id));
  ipcMain.handle('workflows:getWorkspaceInfo', (_e, id: string) => workflows_getWorkspaceInfo(id));
  ipcMain.handle('workflows:listWorkspaceFiles', (_e, id: string, subpath?: string) => workflows_listWorkspaceFiles(id, subpath));
  ipcMain.handle('workflows:readWorkspaceFile', (_e, id: string, filePath: string) => workflows_readWorkspaceFile(id, filePath));
  ipcMain.handle('workflows:readWorkspaceFileBinary', (_e, id: string, filePath: string) => workflows_readWorkspaceFileBinary(id, filePath));
  ipcMain.handle('workflows:writeWorkspaceFile', (_e, id: string, filePath: string, content: string) => workflows_writeWorkspaceFile(id, filePath, content));
  ipcMain.handle('workflows:deleteWorkspaceFile', (_e, id: string, filePath: string) => workflows_deleteWorkspaceFile(id, filePath));
  ipcMain.handle('workflows:createWorkspaceSubdir', (_e, id: string, subpath: string) => workflows_createWorkspaceSubdir(id, subpath));
  ipcMain.handle('workflows:renameWorkspaceFile', (_e, id: string, oldPath: string, newName: string) => workflows_renameWorkspaceFile(id, oldPath, newName));
  ipcMain.handle('workflows:moveWorkspaceFile', (_e, id: string, sourcePath: string, destFolder: string) => workflows_moveWorkspaceFile(id, sourcePath, destFolder));
  // Sub-workflow (.stuard) management
  ipcMain.handle('workflows:createWorkspaceStuard', (_e, id: string, subPath: string, name?: string) => workflows_createWorkspaceStuard(id, subPath, name));
  ipcMain.handle('workflows:readWorkspaceStuard', (_e, id: string, subPath: string) => workflows_readWorkspaceStuard(id, subPath));
  ipcMain.handle('workflows:saveWorkspaceStuard', (_e, id: string, subPath: string, content: string) => workflows_saveWorkspaceStuard(id, subPath, content));
  ipcMain.handle('workflows:listWorkspaceFunctions', (_e, id: string) => workflows_listWorkspaceFunctions(id));
  ipcMain.handle('workflows:importAsWorkspaceFunction', (_e, hostId: string, sourceId: string, options?: { subdir?: string }) => workflows_importAsWorkspaceFunction(hostId, sourceId, options));

  // Python Environment Management
  ipcMain.handle('python:status', async () => {
    return await execLocalTool('python_status', {});
  });
  ipcMain.handle('python:setup', async () => {
    return await execLocalTool('python_setup', {});
  });
  ipcMain.handle('python:install', async (_e, args: any) => {
    return await execLocalTool('python_install', args);
  });

  // Stuards
  ipcMain.handle('stuards:list', () => stuards_list());
  ipcMain.handle('stuards:read', (_e, id: string) => stuards_read(id));
  ipcMain.handle('stuards:save', (_e, payload: { id: string; content: string }) => stuards_save(payload));
  ipcMain.handle('stuards:deploy', (_e, id: string) => stuards_deploy(id));
  ipcMain.handle('stuards:stop', (_e, id: string) => stuards_stop(id));
  ipcMain.handle('stuards:run', (_e, id: string) => stuards_run(id));
  ipcMain.handle('stuards:importWorkflow', (_e, def: WorkflowDefinition) => {
    try {
      const spec = workflowToStuardSpec(def, {});
      const rawId = spec?.id || def?.name || 'workflow_' + Date.now().toString(36);
      const id = safeStuardId(String(rawId));
      if (!id) return { ok: false, error: 'invalid_id' };
      const content = JSON.stringify({ ...spec, id }, null, 2);
      const res = stuards_save({ id, content });
      if (!res?.ok) return res;
      return { ok: true, id };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed') };
    }
  });

  // Agent Instance Management
  ipcMain.handle('agent:start', async (_e, id?: string) => {
    try {
      const finalId = id || 'default';
      const port = await startAgent(finalId);
      return { ok: true, port, id: finalId };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent:stop', async (_e, id: string) => {
    try {
      stopAgent(id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('agent:list', async () => {
    try {
      return { ok: true, agents: listAgents() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Updates
  ipcMain.handle('updates:getState', () => updates_getState());
  ipcMain.handle('updates:check', async () => updates_check());
  ipcMain.handle('updates:download', async () => updates_download());
  ipcMain.handle('updates:install', async () => updates_install());
  ipcMain.handle('updates:setChannel', async (_e, channel: string) => updates_setChannel(channel as any));
  ipcMain.handle('updates:onState', (_e) => { try { return updates_getState(); } catch { return { status: 'idle' }; } });
  ipcMain.handle('updates:getApiEndpoint', () => {
    const { getCurrentApiEndpoint } = require('../services/updates');
    return { ok: true, endpoint: getCurrentApiEndpoint() };
  });

  // Connected-Apps service management (mediapipe + browser-use)
  // These hit the desktop main process directly (NOT the agent) so the UI
  // can see installed/running state and check R2 for newer binaries.
  ipcMain.handle('service:mediapipe:getLocalStatus', () => {
    try { return getMediapipeLocalStatus(); } catch (e: any) { return { error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:checkForUpdate', async () => {
    try { return await checkMediapipeForUpdate(); } catch (e: any) { return { ok: false, updateAvailable: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:install', async () => {
    try { return await installMediapipe(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:update', async () => {
    try { return await updateMediapipe(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:uninstall', async () => {
    try { return await uninstallMediapipe(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:start', async () => {
    try { return await startMediaPipeService(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:mediapipe:stop', async () => {
    try { await stopMediaPipeService(); return { ok: true }; } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });

  ipcMain.handle('service:browserUse:getLocalStatus', () => {
    try { return getBrowserUseLocalStatus(); } catch (e: any) { return { error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:browserUse:checkForUpdate', async () => {
    try { return await checkBrowserUseForUpdate(); } catch (e: any) { return { ok: false, updateAvailable: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:browserUse:install', async () => {
    try { return await installBrowserUse(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:browserUse:update', async () => {
    try { return await updateBrowserUse(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('service:browserUse:uninstall', async () => {
    try { return await uninstallBrowserUse(); } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });

  // Tools execution (Renderer -> Main -> Local Agent/System)
  ipcMain.handle('tools:exec', async (_e, tool: string, args: any) => {
    try {
      logger.info(`[tools:exec] Executing tool: ${tool}`);
      const agentWsUrl = String(process.env.AGENT_WS || process.env.AGENT_WS_URL || '').trim() || 'ws://127.0.0.1:8765/ws';
      const cloudAiUrl = String(
        process.env.CLOUD_AI_HTTP ||
        process.env.CLOUD_PUBLIC_URL ||
        process.env.VITE_CLOUD_AI_URL ||
        ''
      ).trim().replace(/\/+$/, '');

      const ctx: RouterContext = {
        agentWsUrl,
        cloudAiUrl,
        logFn: (msg: string) => {
          try { logger.info(`[tool] ${msg}`); } catch { }
        },
      };

      return await execUnifiedTool(String(tool || ''), args, ctx);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Custom UI prebuilt assets (for UI builder preview â€” avoids CDN)
  ipcMain.handle('customUi:getPrebuiltAssets', async () => {
    try {
      const { getReactUmd, getReactDomUmd, getFramerMotionUmd } = require('../custom-ui/assets/react-runtime');
      const { TAILWIND_PREBUILT_CSS } = require('../custom-ui/assets/tailwind-prebuilt');
      const { EXTRA_CSS } = require('../custom-ui/assets/utility-css');
      return {
        ok: true,
        reactUmd: getReactUmd(),
        reactDomUmd: getReactDomUmd(),
        framerMotionUmd: getFramerMotionUmd(),
        tailwindCss: TAILWIND_PREBUILT_CSS,
        extraCss: EXTRA_CSS,
      };
    } catch (e: any) {
      logger.error('[customUi:getPrebuiltAssets] Failed:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Transform JSX component code (for UI builder preview)
  ipcMain.handle('customUi:transformJsx', async (_e, code: string) => {
    try {
      const { prepareComponentCode } = require('../custom-ui/jsx-transform');
      const result = prepareComponentCode(code);
      return { ok: true, code: result.code, syntax: result.syntax };
    } catch (e: any) {
      logger.error('[customUi:transformJsx] Failed:', e);
      return { ok: false, error: String(e?.message || e), code };
    }
  });

  // Open chat in overlay
  ipcMain.handle('overlay:openChat', (_e, conversationId: string) => {
    try {
      setOverlayMode('window');
      showWindow();
      // Send event to renderer to open the specific chat
      const wins = BrowserWindow.getAllWindows();
      for (const w of wins) {
        w.webContents.send('overlay:open-chat', conversationId);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Browser mirror (live browser sidebar controls)
  ipcMain.handle('browserMirror:screenshot', async (_e, sessionId?: string, quality?: number) => {
    return browserMirrorScreenshot(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'default',
      typeof quality === 'number' ? quality : 50,
    );
  });
  ipcMain.handle('browserMirror:clickAt', async (_e, sessionId: string, x: number, y: number, type?: 'click' | 'dblclick') => {
    return browserMirrorClickAt(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'default',
      Number(x),
      Number(y),
      type === 'dblclick' ? 'dblclick' : 'click',
    );
  });
  ipcMain.handle('browserMirror:type', async (_e, sessionId: string, text: string) => {
    return browserMirrorType(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'default',
      String(text || ''),
    );
  });
  ipcMain.handle('browserMirror:pressKey', async (_e, sessionId: string, key: string) => {
    return browserMirrorPressKey(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'default',
      String(key || ''),
    );
  });
  ipcMain.handle('browserMirror:scroll', async (_e, sessionId: string, direction?: 'up' | 'down', amount?: number) => {
    return browserMirrorScroll(
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'default',
      direction === 'up' ? 'up' : 'down',
      typeof amount === 'number' ? amount : 300,
    );
  });

  // Browser-use Chrome sync settings
  ipcMain.handle('browserUse:getChromeSyncSettings', () => {
    return { ok: true, settings: getBrowserUseChromeSyncSettingsLocal() };
  });
  ipcMain.handle('browserUse:listChromeProfiles', () => {
    return { ok: true, browsers: listBrowserUseChromeProfilesLocal() };
  });
  ipcMain.handle('browserUse:updateChromeSyncSettings', (_e, updates: Partial<BrowserUseChromeSyncSettings>) => {
    return { ok: true, settings: updateBrowserUseChromeSyncSettingsLocal(updates || {}) };
  });

  // Proactive task board + activity log (the single-config get/updateConfig
  // pair was retired with the default agent now being a normal bot — Scout).
  ipcMain.handle('proactive:listTasks', () => proactiveService.listTasks({ limit: 500 }));
  ipcMain.handle('proactive:addTask', (_e, task: any) => proactiveService.addTask(task || {}));
  ipcMain.handle('proactive:updateTask', (_e, taskId: string, updates: any) =>
    proactiveService.updateTask(String(taskId || ''), updates || {})
  );
  ipcMain.handle('proactive:deleteTask', (_e, taskId: string) => proactiveService.deleteTask(String(taskId || '')));
  ipcMain.handle('proactive:getWakeUpLog', (_e, limit?: number) =>
    proactiveService.getWakeUpLog(typeof limit === 'number' ? limit : 20)
  );
  ipcMain.handle('proactive:triggerNow', (_e, botId?: string) => triggerManualWakeUp(botId));
  ipcMain.handle('proactive:getAvailableTools', () => ({ ok: true, tools: [...proactiveAvailableTools, ...listCustomIntegrationToolNames()] }));
  // Renderer syncs the user's deployed custom-integration tool names here so
  // execTool can route them to cloud-ai and the bot tool picker can list them.
  ipcMain.handle('integrations:syncToolNames', (_e, names: string[]) => {
    try { setCustomIntegrationToolNames(Array.isArray(names) ? names : []); return { ok: true }; }
    catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  });
  ipcMain.handle('proactive:isRunning', () => ({ ok: true, running: isProactiveSchedulerRunning() }));
  ipcMain.handle('proactive:reply', async (_e, payload: { wakeUpId: string; text: string }) => {
    const wakeUpId = String(payload?.wakeUpId || '').trim();
    const text = String(payload?.text || '').trim();
    if (!wakeUpId) return { ok: false, error: 'wakeUpId_required' };
    if (!text) return { ok: false, error: 'text_required' };
    return handleProactiveReply(wakeUpId, text);
  });

  // â”€â”€â”€ Bots (multi-bot proactive entity layer) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function syncVmBotIfDeployed(botId: string) {
    syncBotDeploymentToVm(botId).catch((e) => logger.warn('[ipc] syncBotDeploymentToVm failed:', e));
  }

  ipcMain.handle('bots:list', () => ({ ok: true, bots: botService.list() }));
  ipcMain.handle('bots:get', (_e, id: string) => {
    const bot = botService.get(String(id || ''));
    return bot ? { ok: true, bot } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:create', (_e, input: any) => {
    const name = String(input?.name || '').trim();
    if (!name) return { ok: false, error: 'name_required' };
    const bot = botService.create({
      name,
      emoji: input?.emoji,
      systemPrompt: input?.systemPrompt,
      status: input?.status,
      config: input?.config,
      triggers: input?.triggers,
    } as any);
    syncBotTriggers(bot.id);
    return { ok: true, bot };
  });
  ipcMain.handle('bots:update', (_e, id: string, patch: any) => {
    const bot = botService.update(String(id || ''), patch || {});
    if (bot) syncBotTriggers(bot.id);
    if (bot?.vmDeployedAt) syncVmBotIfDeployed(bot.id);
    return bot ? { ok: true, bot } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:delete', async (_e, id: string) => {
    const botId = String(id || '');
    const existing = botService.get(botId);
    if (existing?.vmDeployedAt) {
      const stopped = await stopBotOnVm(botId).catch((e) => {
        logger.warn('[ipc] stopBotOnVm before delete failed:', e);
        return { ok: false, error: String(e?.message || e) };
      });
      if (!stopped.ok) return { ok: false, error: `vm_stop_failed:${stopped.error || 'unknown'}` };
    }
    const result = botService.delete(botId);
    if (result.ok) {
      syncBotTriggers(botId);
      // Cascade: drop the bot's private kanban + run log so a re-created bot
      // with a recycled id doesn't inherit ghost cards.
      try { botMemoryService.clearForBot(botId); } catch (e) { logger.warn('[ipc] clearForBot failed:', e); }
    }
    return result;
  });
  ipcMain.handle('bots:getConfig', (_e, id: string) => {
    const config = botService.resolveConfig(String(id || ''));
    return config ? { ok: true, config } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:updateConfig', (_e, id: string, patch: any) => {
    const botId = String(id || '');
    const config = botService.updateConfig(botId, patch || {});
    if (config) syncVmBotIfDeployed(botId);
    return config ? { ok: true, config } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:setStatus', (_e, id: string, status: any) => {
    const bot = botService.setStatus(String(id || ''), status);
    if (bot) syncBotTriggers(bot.id);
    if (bot?.vmDeployedAt) syncVmBotIfDeployed(bot.id);
    return bot ? { ok: true, bot } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:deploy', (_e, id: string) => {
    const bot = botService.setStatus(String(id || ''), 'running');
    if (bot) syncBotTriggers(bot.id);
    if (bot?.vmDeployedAt) syncVmBotIfDeployed(bot.id);
    return bot ? { ok: true, bot } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:pause', (_e, id: string) => {
    const bot = botService.setStatus(String(id || ''), 'paused');
    if (bot) syncBotTriggers(bot.id);
    if (bot?.vmDeployedAt) syncVmBotIfDeployed(bot.id);
    return bot ? { ok: true, bot } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:triggerNow', (_e, id: string) => triggerManualWakeUp(String(id || '')));
  // Cloud-Engine UIs use this so a "Run" click inside the VM workspace fires
  // the VM (via `/v1/bot/run`) instead of the local proactive-scheduler.
  // Without this, `bots:triggerNow` would always run on the desktop and the
  // user would only see logs in the local app — even though the click came
  // from the VM tab.
  ipcMain.handle('bots:triggerOnVm', (_e, id: string) => triggerVmWakeUp(String(id || '')));
  ipcMain.handle('bots:getVmStatus', (_e, id: string) => getBotStatusFromVm(String(id || '')));
  ipcMain.handle('bots:listTasks', (_e, id: string) => proactiveService.listTasks({ botId: String(id || ''), limit: 500 }));
  ipcMain.handle('bots:getWakeUpLog', (_e, id: string, limit?: number) =>
    proactiveService.getWakeUpLog(typeof limit === 'number' ? limit : 50, { botId: String(id || '') })
  );
  ipcMain.handle('bots:addTrigger', (_e, id: string, input: any) => {
    const trigger = botService.addTrigger(String(id || ''), input || {});
    if (trigger) syncBotTriggers(String(id || ''));
    if (trigger) syncVmBotIfDeployed(String(id || ''));
    return trigger ? { ok: true, trigger } : { ok: false, error: 'invalid_input' };
  });
  ipcMain.handle('bots:updateTrigger', (_e, id: string, triggerId: string, patch: any) => {
    const trigger = botService.updateTrigger(String(id || ''), String(triggerId || ''), patch || {});
    if (trigger) syncBotTriggers(String(id || ''));
    if (trigger) syncVmBotIfDeployed(String(id || ''));
    return trigger ? { ok: true, trigger } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:removeTrigger', (_e, id: string, triggerId: string) => {
    const ok = botService.removeTrigger(String(id || ''), String(triggerId || ''));
    if (ok) syncBotTriggers(String(id || ''));
    if (ok) syncVmBotIfDeployed(String(id || ''));
    return ok ? { ok: true } : { ok: false, error: 'cannot_remove_last' };
  });

  // Available tools for the bot tools picker. Mirrors proactive:getAvailableTools
  // because the underlying registry is process-global; both views show the
  // same union, minus the proactive_task_* helpers (those are kanban plumbing).
  ipcMain.handle('bots:getAvailableTools', () => ({ ok: true, tools: [...proactiveAvailableTools, ...listCustomIntegrationToolNames()] }));
  ipcMain.handle('bots:testSetup', (_e, input: any) => {
    try {
      return testBotSetupPreflight(input || {}, proactiveAvailableTools);
    } catch (err: any) {
      return {
        ok: false,
        summary: err?.message || 'Setup test failed.',
        checks: [],
        error: err?.message || 'setup_test_failed',
      };
    }
  });
  ipcMain.handle('bots:runPreflightProbe', async (
    _e,
    payload: { request: BotPreflightProbeRequest; cloudHttpBase: string; authToken: string | null },
  ) => {
    try {
      const result = await runBotPreflightProbe(
        payload?.request || { probe: '', args: undefined },
        {
          cloudHttpBase: String(payload?.cloudHttpBase || '').trim(),
          authToken: payload?.authToken ? String(payload.authToken) : null,
        },
      );
      return { ok: true, ...result };
    } catch (err: any) {
      return {
        ok: false,
        status: 'fail' as const,
        detail: err?.message || 'probe_failed',
      };
    }
  });

  // Deploy / undeploy a bot to the user's cloud VM (in addition to local).
  ipcMain.handle('bots:deployToVm', async (_e, id: string) => {
    return deployBotToVm(String(id || ''));
  });
  ipcMain.handle('bots:stopOnVm', async (_e, id: string) => {
    return stopBotOnVm(String(id || ''));
  });

  // ─── Bot kanban + run log (private bot-owned memory) ──────────────────────
  // Separate from proactive-service tasks (which are user-owned). Both the bot
  // (via the bot_memory tool during a run) and the user (via the Kanban tab)
  // can read/write these; lastEditedBy distinguishes them in the UI.
  function broadcastBotMemoryChanged(botId: string) {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bot-memory-changed', { botId });
      }
    } catch { }
  }
  const VALID_KANBAN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'failed']);
  ipcMain.handle('bots:memoryListCards', async (_e, id: string, status?: string) => {
    await pullBotMemoryFromVm(String(id || '')).catch((e) => logger.warn('[ipc] pullBotMemoryFromVm failed:', e));
    const opts = status && VALID_KANBAN_STATUSES.has(String(status)) ? { status: String(status) as any } : {};
    return { ok: true, cards: botMemoryService.listCards(String(id || ''), opts) };
  });
  ipcMain.handle('bots:memoryCreateCard', (_e, id: string, input: any) => {
    const card = botMemoryService.createCard(String(id || ''), input || { title: '' }, 'user');
    if (!card) return { ok: false, error: 'invalid_input' };
    broadcastBotMemoryChanged(String(id || ''));
    pushBotMemoryToVm(String(id || '')).catch((e) => logger.warn('[ipc] pushBotMemoryToVm failed:', e));
    return { ok: true, card };
  });
  ipcMain.handle('bots:memoryUpdateCard', (_e, id: string, cardId: string, patch: any) => {
    const card = botMemoryService.updateCard(String(id || ''), String(cardId || ''), patch || {}, 'user');
    if (!card) return { ok: false, error: 'not_found' };
    broadcastBotMemoryChanged(String(id || ''));
    pushBotMemoryToVm(String(id || '')).catch((e) => logger.warn('[ipc] pushBotMemoryToVm failed:', e));
    return { ok: true, card };
  });
  ipcMain.handle('bots:memoryDeleteCard', (_e, id: string, cardId: string) => {
    const ok = botMemoryService.deleteCard(String(id || ''), String(cardId || ''));
    if (ok) broadcastBotMemoryChanged(String(id || ''));
    if (ok) pushBotMemoryToVm(String(id || '')).catch((e) => logger.warn('[ipc] pushBotMemoryToVm failed:', e));
    return ok ? { ok: true } : { ok: false, error: 'not_found' };
  });
  ipcMain.handle('bots:memoryListRunLog', async (_e, id: string, limit?: number) => {
    await pullBotMemoryFromVm(String(id || '')).catch((e) => logger.warn('[ipc] pullBotMemoryFromVm failed:', e));
    return { ok: true, runLog: botMemoryService.listRunLog(String(id || ''), typeof limit === 'number' ? limit : 20) };
  });

  // File Indexing
  ipcMain.handle('fileIndex:listRoots', async () => {
    try {
      const roots = await listRoots();
      return { ok: true, roots };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:addRoot', async (_e, path: string, schedule?: string) => {
    try {
      const root = await addRoot(path, schedule as any);
      if (!root) return { ok: false, error: 'Failed to add root' };
      return { ok: true, root };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:removeRoot', async (_e, rootId: string) => {
    try {
      const success = await removeRoot(rootId);
      return { ok: success };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:getStats', async () => {
    try {
      const stats = await getFileIndexStats();
      return { ok: true, stats };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:scan', async (_e, rootId: string, options?: { computeHashes?: boolean; maxFiles?: number }) => {
    try {
      const progress = await scanRoot(rootId, undefined, {
        computeHashes: options?.computeHashes ?? false,
        maxFiles: options?.maxFiles,
      });
      return { ok: true, progress };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:search', async (_e, query: string, options?: any) => {
    try {
      const files = await searchFiles(query, options || {});
      return { ok: true, files, results: files };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // â”€â”€ App Discovery & Unified Search â”€â”€
  ipcMain.handle('apps:list', async (_e, forceRefresh?: boolean) => {
    try {
      const apps = await getInstalledApps(forceRefresh ?? false);
      return { ok: true, apps };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('apps:refresh', async () => {
    try {
      await refreshAppCache();
      const apps = await getInstalledApps();
      return { ok: true, count: apps.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Nukes the on-disk UWP icon cache, the in-memory app cache, then forces a
  // fresh discovery + manifest scan. Use this when Store apps have updated
  // (their install dirs get renamed by version, breaking cached PNG paths)
  // or after installing a new app that hasn't appeared in search yet.
  ipcMain.handle('apps:clearCacheAndRediscover', async () => {
    try {
      const userData = app.getPath('userData');
      // Nuke both the UWP manifest-derived cache and the Win32 PowerShell-
      // extracted PNG cache, then force discovery + a fresh icon prewarm.
      try { await fs.promises.unlink(path.join(userData, 'uwp-icons-v1.json')); } catch { /* already gone */ }
      try { await fs.promises.unlink(path.join(userData, 'win32-icons-v1.json')); } catch { /* already gone */ }
      try {
        await fs.promises.rm(path.join(userData, 'win32-icons-v1'), { recursive: true, force: true });
      } catch { /* already gone */ }
      await refreshAppCache();
      const apps = await getInstalledApps();
      return { ok: true, count: apps.length };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Trigger a full re-scan of every indexed root. Doesn't drop the DB
  // (1.3GB+ for a full home-dir index — re-crawling from scratch would take
  // ages and a stale-row sweep at the end gives an equivalent end state).
  ipcMain.handle('fileIndex:forceReindex', async () => {
    try {
      const roots = await listRoots();
      let scanned = 0;
      for (const root of roots) {
        if (!root.enabled || root.schedule === 'off') continue;
        try {
          await scanRoot(root.id);
          scanned++;
        } catch (e: any) {
          logger.warn(`[fileIndex:forceReindex] scan of ${root.path} failed:`, e?.message);
        }
      }
      return { ok: true, scanned };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('apps:launch', async (_e, launchTarget: string) => {
    const target = String(launchTarget || '').trim();
    logger.info('[CompactQuickActions] apps:launch', { target });
    try {
      if (!target) {
        logger.warn('[CompactQuickActions] apps:launch aborted — empty target');
        return { ok: false, error: 'No launch target' };
      }
      let method: 'explorer' | 'shell.openPath' | 'shell.openExternal' | 'openExternal-fallback';
      if (target.startsWith('shell:') && process.platform === 'win32') {
        // UWP / Store / AppsFolder apps live in the Windows shell namespace and
        // cannot be launched via ShellExecute — shell.openExternal('shell:...')
        // fails with "The system cannot find the path specified. (0x3)".
        // explorer.exe resolves the shell: path and launches the app.
        method = 'explorer';
        const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
        child.on('error', (err) =>
          logger.warn('[CompactQuickActions] apps:launch explorer spawn error', {
            target,
            error: String((err as any)?.message || err),
          }),
        );
        child.unref();
      } else if (target.startsWith('shell:')) {
        method = 'shell.openExternal';
        await shell.openExternal(target);
      } else if (fs.existsSync(target)) {
        method = 'shell.openPath';
        // openPath resolves to an error string (it does not throw) on failure.
        const openErr = await shell.openPath(target);
        if (openErr) throw new Error(openErr);
      } else {
        method = 'openExternal-fallback';
        await shell.openExternal(target);
      }
      logger.info('[CompactQuickActions] apps:launch ok', { target, method });
      return { ok: true, method };
    } catch (e: any) {
      logger.warn('[CompactQuickActions] apps:launch failed', {
        target,
        error: String(e?.message || e),
      });
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('search:unified', async (_e, query: string, options?: any) => {
    try {
      const results = await unifiedSearch(query, options || {});
      return { ok: true, results };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:getPendingCount', async () => {
    try {
      const count = await getPendingCount();
      return { ok: true, count };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:getScanStatus', () => {
    try {
      return { ok: true, ...getScanStatus() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:initDefaults', async () => {
    try {
      const result = await reinitializeDefaultFolders();
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:scanAll', async () => {
    try {
      // Run indexing in background, don't await
      runStartupIndexing().catch((e) => {
        logger.error('[fileIndex:scanAll] Error:', e);
      });
      // Also refresh app cache in background
      refreshAppCache().catch(() => {});
      return { ok: true, message: 'Scan started in background' };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:processSemanticIndexing', async (_e, token: string, limit: number) => {
    try {
      const progress = await processSemanticIndexing(token, limit, (p) => {
        // Send progress updates to all windows
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            win.webContents.send('file-index:semantic-progress', p);
          } catch { }
        });
      });
      return { ok: true, progress };
    } catch (e: any) {
      logger.error('[fileIndex:processSemanticIndexing] Error:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Polar Billing (lazy-loaded to avoid barrel resolution issues)
  ipcMain.handle('billing:createCheckout', async (_e, options: any) => {
    try {
      const { createCheckout } = require('../services/polar');
      return await createCheckout(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:getCustomer', async (_e, email: string) => {
    try {
      const { getCustomer } = require('../services/polar');
      return await getCustomer(email);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:listProducts', async () => {
    try {
      const { listProducts } = require('../services/polar');
      return await listProducts();
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:openPortal', async (_e, customerId: string) => {
    try {
      const { openCustomerPortal } = require('../services/polar');
      return await openCustomerPortal(customerId);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:purchaseCredits', async (_e, options: any) => {
    try {
      const { purchaseCredits } = require('../services/polar');
      return await purchaseCredits(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Quick Shortcuts / Bookmarks
  const bookmarksPath = () => {
    const userDataPath = app.getPath('userData');
    return require('path').join(userDataPath, 'quick-shortcuts.json');
  };

  // Track registered bookmark keybinds so we can unregister them
  const registeredBookmarkKeybinds = new Set<string>();

  const executeBookmarkById = async (bookmarkId: string) => {
    const bookmarks = loadBookmarks();
    const bookmark = bookmarks.find((b: any) => b.id === bookmarkId);
    if (!bookmark) return;
    // Reuse the bookmarks:execute handler logic inline
    try {
      const type = String(bookmark.type || '').toLowerCase();
      const target = String(bookmark.target || '').trim();
      switch (type) {
        case 'url':
          if (target) shell.openExternal(target);
          break;
        case 'app':
        case 'file':
        case 'folder':
          if (target) shell.openPath(target);
          break;
        case 'workflow':
          if (target) await workflows_run(target);
          break;
        case 'dashboard':
          openDashboardWindow({ tab: target || undefined });
          break;
        case 'space':
        case 'canvas':
          // Spaces/canvas removed — bookmark falls back to Todo tab.
          openSidebarWindow({ tab: 'todo', expanded: true });
          break;
        case 'tasks':
          setOverlayMode('window');
          showWindow();
          for (const w of BrowserWindow.getAllWindows()) {
            try { w.webContents.send('overlay:view-mode', { mode: 'tasks', subTab: target === 'agent' ? 'agent' : 'todo' }); } catch { }
          }
          break;
      }
    } catch (e) {
      logger.warn('Failed to execute bookmark via keybind:', e);
    }
  };

  const registerBookmarkKeybinds = (bookmarks: any[]) => {
    // Unregister all previously registered bookmark keybinds
    for (const accel of registeredBookmarkKeybinds) {
      try { globalShortcut.unregister(accel); } catch { }
    }
    registeredBookmarkKeybinds.clear();

    // Register new keybinds
    for (const bm of bookmarks) {
      if (!bm.keybind || typeof bm.keybind !== 'string') continue;
      const accel = bm.keybind;
      const bmId = bm.id;
      try {
        const ok = globalShortcut.register(accel, () => {
          executeBookmarkById(bmId);
        });
        if (ok) {
          registeredBookmarkKeybinds.add(accel);
          logger.info(`Registered bookmark keybind: ${accel} â†’ ${bm.name}`);
        } else {
          logger.warn(`Failed to register bookmark keybind (may be in use): ${accel}`);
        }
      } catch (e) {
        logger.warn(`Error registering bookmark keybind ${accel}:`, e);
      }
    }
  };

  const loadBookmarks = (): any[] => {
    try {
      const p = bookmarksPath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {
      logger.warn('Failed to load bookmarks:', e);
    }
    return [];
  };

  const saveBookmarks = (bookmarks: any[]) => {
    try {
      fs.writeFileSync(bookmarksPath(), JSON.stringify(bookmarks, null, 2), 'utf-8');
      // Re-register all bookmark keybinds whenever bookmarks change
      registerBookmarkKeybinds(bookmarks);
    } catch (e) {
      logger.warn('Failed to save bookmarks:', e);
    }
  };

  // Register bookmark keybinds on startup
  try { registerBookmarkKeybinds(loadBookmarks()); } catch { }

  ipcMain.handle('bookmarks:list', () => {
    return { ok: true, bookmarks: loadBookmarks() };
  });

  ipcMain.handle('bookmarks:save', (_e, bookmarks: any[]) => {
    saveBookmarks(bookmarks);
    return { ok: true };
  });

  ipcMain.handle('bookmarks:add', (_e, bookmark: any) => {
    const bookmarks = loadBookmarks();
    bookmarks.push(bookmark);
    saveBookmarks(bookmarks);
    return { ok: true, bookmarks };
  });

  ipcMain.handle('bookmarks:update', (_e, bookmark: any) => {
    const bookmarks = loadBookmarks();
    const idx = bookmarks.findIndex((b: any) => b.id === bookmark.id);
    if (idx >= 0) {
      bookmarks[idx] = bookmark;
      saveBookmarks(bookmarks);
      return { ok: true, bookmarks };
    }
    return { ok: false, error: 'Bookmark not found' };
  });

  ipcMain.handle('bookmarks:delete', (_e, bookmarkId: string) => {
    const bookmarks = loadBookmarks();
    const filtered = bookmarks.filter((b: any) => b.id !== bookmarkId);
    saveBookmarks(filtered);
    return { ok: true, bookmarks: filtered };
  });

  ipcMain.handle('bookmarks:reorder', (_e, bookmarkIds: string[]) => {
    const bookmarks = loadBookmarks();
    const ordered = bookmarkIds
      .map(id => bookmarks.find((b: any) => b.id === id))
      .filter(Boolean);
    // Add any bookmarks not in the order list at the end
    const orderedIds = new Set(bookmarkIds);
    for (const b of bookmarks) {
      if (!orderedIds.has(b.id)) {
        ordered.push(b);
      }
    }
    saveBookmarks(ordered);
    return { ok: true, bookmarks: ordered };
  });

  // ==========================================
  // UNIFIED TASKS SYSTEM
  // ==========================================

  ipcMain.handle('unified-tasks:list', () => unifiedTasksService.list());
  ipcMain.handle('unified-tasks:get', (_e, taskId: string) => unifiedTasksService.get(taskId));
  ipcMain.handle('unified-tasks:add', (_e, task: any) => unifiedTasksService.add(task));
  ipcMain.handle('unified-tasks:update', (_e, task: any) => unifiedTasksService.update(task));
  ipcMain.handle('unified-tasks:delete', (_e, taskId: string) => unifiedTasksService.delete(taskId));
  ipcMain.handle('unified-tasks:toggle-status', (_e, taskId: string) => unifiedTasksService.toggleStatus(taskId));
  ipcMain.handle('unified-tasks:add-subtodo', (_e, taskId: string, subtodo: any) => unifiedTasksService.addSubtodo(taskId, subtodo));
  ipcMain.handle('unified-tasks:update-subtodo', (_e, taskId: string, subtodoId: string, updates: any) => unifiedTasksService.updateSubtodo(taskId, subtodoId, updates));
  ipcMain.handle('unified-tasks:toggle-subtodo', (_e, taskId: string, subtodoId: string) => unifiedTasksService.toggleSubtodo(taskId, subtodoId));
  ipcMain.handle('unified-tasks:delete-subtodo', (_e, taskId: string, subtodoId: string) => unifiedTasksService.deleteSubtodo(taskId, subtodoId));
  ipcMain.handle('unified-tasks:add-agent-assignment', (_e, taskId: string, assignment: any) => unifiedTasksService.addAgentAssignment(taskId, assignment));
  ipcMain.handle('unified-tasks:update-agent-assignment', (_e, taskId: string, assignmentId: string, updates: any) => unifiedTasksService.updateAgentAssignment(taskId, assignmentId, updates));
  ipcMain.handle('unified-tasks:delete-agent-assignment', (_e, taskId: string, assignmentId: string) => unifiedTasksService.deleteAgentAssignment(taskId, assignmentId));
  ipcMain.handle('unified-tasks:get-pending-assignments', () => unifiedTasksService.getPendingAssignments());
  ipcMain.handle('unified-tasks:get-calendar-items', () => unifiedTasksService.getCalendarItems());

  // ==========================================
  // OFFLINE CALENDAR EVENTS
  // ==========================================
  const { offlineCalendarService } = require('../services/offline-calendar');

  ipcMain.handle('offline-calendar:list', () => offlineCalendarService.list());
  ipcMain.handle('offline-calendar:get', (_e: any, eventId: string) => offlineCalendarService.get(eventId));
  ipcMain.handle('offline-calendar:add', (_e: any, eventData: any) => offlineCalendarService.add(eventData));
  ipcMain.handle('offline-calendar:update', (_e: any, eventData: any) => offlineCalendarService.update(eventData));
  ipcMain.handle('offline-calendar:delete', (_e: any, eventId: string) => offlineCalendarService.delete(eventId));
  ipcMain.handle('offline-calendar:get-for-range', (_e: any, startIso: string, endIso: string) => offlineCalendarService.getForRange(startIso, endIso));
  ipcMain.handle('offline-calendar:get-calendar-blocks', (_e: any, startIso: string, endIso: string) => offlineCalendarService.getCalendarBlocks(startIso, endIso));

  // Legacy User To-Do List (for backwards compatibility)
  const todosPath = () => {
    const userDataPath = app.getPath('userData');
    return require('path').join(userDataPath, 'user-todos.json');
  };

  const loadTodos = (): any[] => {
    try {
      const p = todosPath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {
      logger.warn('Failed to load todos:', e);
    }
    return [];
  };

  const saveTodos = (todos: any[]) => {
    try {
      fs.writeFileSync(todosPath(), JSON.stringify(todos, null, 2), 'utf-8');
    } catch (e) {
      logger.warn('Failed to save todos:', e);
    }
  };

  ipcMain.handle('todos:list', () => {
    return { ok: true, todos: loadTodos() };
  });

  ipcMain.handle('todos:save', (_e, todos: any[]) => {
    saveTodos(todos);
    return { ok: true };
  });

  ipcMain.handle('todos:add', (_e, todo: any) => {
    const todos = loadTodos();
    todos.unshift(todo);
    saveTodos(todos);
    return { ok: true, todos };
  });

  ipcMain.handle('todos:update', (_e, todo: any) => {
    const todos = loadTodos();
    const idx = todos.findIndex((t: any) => t.id === todo.id);
    if (idx >= 0) {
      todos[idx] = todo;
      saveTodos(todos);
      return { ok: true, todos };
    }
    return { ok: false, error: 'Todo not found' };
  });

  ipcMain.handle('todos:delete', (_e, todoId: string) => {
    const todos = loadTodos();
    const filtered = todos.filter((t: any) => t.id !== todoId);
    saveTodos(filtered);
    return { ok: true, todos: filtered };
  });

  ipcMain.handle('todos:toggle', (_e, todoId: string) => {
    const todos = loadTodos();
    const idx = todos.findIndex((t: any) => t.id === todoId);
    if (idx >= 0) {
      todos[idx].completed = !todos[idx].completed;
      todos[idx].completedAt = todos[idx].completed ? new Date().toISOString() : null;
      saveTodos(todos);
      return { ok: true, todos };
    }
    return { ok: false, error: 'Todo not found' };
  });

  ipcMain.handle('todos:reorder', (_e, todoIds: string[]) => {
    const todos = loadTodos();
    const ordered = todoIds
      .map(id => todos.find((t: any) => t.id === id))
      .filter(Boolean);
    const orderedIds = new Set(todoIds);
    for (const t of todos) {
      if (!orderedIds.has(t.id)) {
        ordered.push(t);
      }
    }
    saveTodos(ordered);
    return { ok: true, todos: ordered };
  });

  ipcMain.handle('bookmarks:execute', async (_e, bookmark: any) => {
    try {
      const type = String(bookmark.type || '').toLowerCase();
      const target = String(bookmark.target || '').trim();

      const sendSidebarSelectItem = (payload: { type: 'space' | 'canvas'; id: string }) => {
        try {
          const sidebar = getSidebarWindow();
          if (!sidebar || sidebar.isDestroyed()) return;
          const wc = sidebar.webContents;
          const send = () => {
            try { wc.send('sidebar:selectItem', payload); } catch { }
          };
          if (typeof (wc as any).isLoadingMainFrame === 'function' && (wc as any).isLoadingMainFrame()) {
            wc.once('did-finish-load', send);
          } else {
            send();
          }
        } catch { }
      };

      switch (type) {
        case 'url':
          if (target) shell.openExternal(target);
          return { ok: true };

        case 'app':
          if (target) shell.openPath(target);
          return { ok: true };

        case 'file':
        case 'folder':
          if (target) shell.openPath(target);
          return { ok: true };

        case 'workflow':
          // Run a workflow by ID
          if (target) {
            const result = await workflows_run(target);
            return result;
          }
          return { ok: false, error: 'No workflow ID specified' };

        case 'space':
        case 'canvas':
          // Spaces/canvas removed from sidebar — bookmark falls back to Todo.
          openSidebarWindow({ tab: 'todo', expanded: true });
          return { ok: true };

        case 'dashboard':
          openDashboardWindow({ tab: target || undefined });
          return { ok: true };

        case 'tasks':
          // Open overlay in window mode and switch to tasks view with subtab
          setOverlayMode('window');
          showWindow();
          // target can be 'todo' or 'agent' for subtab selection
          const tasksSubTab = target === 'agent' ? 'agent' : 'todo';
          for (const w of BrowserWindow.getAllWindows()) {
            try { w.webContents.send('overlay:view-mode', { mode: 'tasks', subTab: tasksSubTab }); } catch { }
          }
          return { ok: true };

        default:
          return { ok: false, error: `Unknown bookmark type: ${type}` };
      }
    } catch (e: any) {
      logger.error('Failed to execute bookmark:', e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Global hotkey management
  ipcMain.handle('system:setGlobalHotkey', (_e, accelerator: string) => {
    try {
      // Validate the accelerator format
      if (!accelerator || typeof accelerator !== 'string') {
        return { ok: false, error: 'Invalid accelerator format' };
      }

      // Try to register the new shortcut first
      const testSuccess = globalShortcut.register(accelerator, () => {
        // This is just a test registration, we'll unregister immediately
      });

      if (!testSuccess) {
        return { ok: false, error: 'Shortcut may be in use by another application' };
      }

      // Unregister the test
      globalShortcut.unregister(accelerator);

      // Unregister the current overlay shortcuts
      const oldHotkey = getGlobalHotkey();
      try { globalShortcut.unregister(oldHotkey); } catch { }
      // Also try common variants
      const variants = ['Control+Space', 'Ctrl+Space', 'Control+Shift+Space', 'Ctrl+Shift+Space', 'CommandOrControl+Shift+Space'];
      for (const v of variants) {
        try { globalShortcut.unregister(v); } catch { }
      }

      // Save first, then reuse the startup registration path. That keeps
      // globalShortcut as a no-op consumer while uiohook owns tap-vs-hold on
      // key release. Registering handleOverlayHotkey here causes keydown plus
      // keyup double toggles when uiohook is active.
      saveGlobalHotkey(accelerator);
      const { registerGlobalShortcuts } = require('../windows');
      registerGlobalShortcuts();

      if (globalShortcut.isRegistered(accelerator)) {
        logger.info(`Global hotkey changed to: ${accelerator}`);
        return { ok: true };
      }

      // Restore the previous value if registration raced with another app.
      saveGlobalHotkey(oldHotkey);
      registerGlobalShortcuts();
      return { ok: false, error: 'Failed to register new shortcut' };
    } catch (e: any) {
      logger.error('Error setting global hotkey:', e);
      return { ok: false, error: String(e?.message || 'Unknown error') };
    }
  });

  ipcMain.handle('system:getGlobalHotkey', () => {
    return { ok: true, hotkey: getGlobalHotkey() };
  });

  // Cloud storage upload via main process. Uses a signed GCS URL and PUTs the
  // file directly to storage, bypassing Cloud Run's 32MB request limit and
  // Electron renderer net.fetch / V8 string-length issues on large files.
  ipcMain.handle('cloudStorage:upload', async (_e, payload: {
    buffer: ArrayBuffer;
    filename: string;
    folderPath?: string;
    contentType?: string;
    token?: string;
  }) => {
    try {
      const cloudAiUrl = String(
        process.env.CLOUD_AI_HTTP ||
        process.env.CLOUD_PUBLIC_URL ||
        process.env.VITE_CLOUD_AI_URL ||
        'http://127.0.0.1:8082'
      ).trim().replace(/\/+$/, '');

      const filename = String(payload?.filename || '').trim();
      if (!filename) return { ok: false, error: 'missing_filename' };
      if (!payload?.buffer) return { ok: false, error: 'missing_buffer' };

      const body = Buffer.from(payload.buffer);
      // Always sign + PUT with octet-stream so the signed URL stays valid
      // regardless of the browser-detected mime. GCS still serves the file
      // back fine for arbitrary content.
      const contentType = 'application/octet-stream';

      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (payload.token) authHeaders['Authorization'] = `Bearer ${payload.token}`;

      // 1. Ask cloud-ai for a signed URL (small request â€” fits Cloud Run easily).
      // raw=true returns the direct GCS URL instead of the Cloudflare-proxied one,
      // bypassing the CF Worker's request-size limit on large files.
      const urlResp = await fetch(`${cloudAiUrl}/v1/cloud-storage/upload-url`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          filename,
          folder: payload.folderPath || '',
          contentType,
          raw: true,
        }),
      });
      const urlData: any = await urlResp.json().catch(() => ({}));
      if (!urlResp.ok || !urlData?.ok || !urlData?.uploadUrl) {
        return {
          ok: false,
          status: urlResp.status,
          error: urlData?.error || 'upload_url_failed',
          message: urlData?.message || `HTTP ${urlResp.status}`,
        };
      }

      // 2. PUT raw buffer directly to GCS â€” no Cloud Run hop
      const putResp = await fetch(urlData.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(body.length),
        },
        body,
      });
      if (!putResp.ok) {
        const text = await putResp.text().catch(() => '');
        return {
          ok: false,
          status: putResp.status,
          error: 'gcs_put_failed',
          message: `GCS HTTP ${putResp.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        };
      }

      // 3. Notify cloud-ai so cold_storage_bytes / billing stay accurate
      try {
        await fetch(`${cloudAiUrl}/v1/cloud-storage/upload-complete`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ objectName: urlData.objectName }),
        });
      } catch (e: any) {
        logger.warn('[cloudStorage:upload] usage refresh failed:', e?.message || e);
      }

      return { ok: true, objectName: urlData.objectName, bytesWritten: body.length };
    } catch (e: any) {
      logger.error('[cloudStorage:upload] failed:', e?.message || e);
      return { ok: false, error: 'upload_exception', message: String(e?.message || e) };
    }
  });

}
