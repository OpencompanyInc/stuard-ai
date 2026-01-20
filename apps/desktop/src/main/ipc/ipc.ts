
import { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut } from "electron";
import { selectFiles, selectImages, listDirectory, selectFolder } from "../utils/files";
import { openDashboardWindow, openOnboardingWindow, closeOnboardingWindow, openWorkflowsWindow, openSpacesWindow, closeSpacesWindow, toggleSpacesWindow, setOverlayMode, setOverlaySize, moveOverlayBy, showWindow, hideWindow, toggleWindow, createBoardWindow, updateBoardWindow, deleteBoardWindow, listBoardWindows, clearBoardWindows, hideBoardWindow, focusBoardWindow, showBoardWindow, getOverlaySize, getOverlayMode } from "../windows";
import { getLocalWebhookPort, workflows_list, workflows_read, workflows_save, workflows_delete, workflows_run, workflows_stop, workflows_deploy, workflows_undeploy, workflows_getDeployStatus, workflows_runStep, workflows_runFromStep, workflowToStuardSpec, WorkflowDefinition } from "../workflows";
import { stuards_list, stuards_read, stuards_save, stuards_deploy, stuards_stop, stuards_run, safeStuardId, execLocalTool } from "../stuards";
import { execTool as execUnifiedTool, RouterContext } from "../tool-router";
import { getOutlookAccessTokenLocal, startOutlookConnect, getOutlookStatus } from "../integrations/outlook";
import { updates_getState, updates_check, updates_download, updates_install, updates_setChannel, startAgent, stopAgent, listAgents, listRoots, addRoot, removeRoot, getStats as getFileIndexStats, scanRoot, searchFiles, getPendingCount, getScanStatus, reinitializeDefaultFolders, runStartupIndexing, processSemanticIndexing, createCheckout, getCustomer, listProducts, openCustomerPortal, purchaseCredits } from "../services";
import { setupSpeechIpc } from "./speech";
import { setupTerminalIpc } from "../terminal";
import logger from "../utils/logger";
import * as fs from "fs";
import { Buffer } from "node:buffer";

let nodeNotifier: any = null;
try { nodeNotifier = require('node-notifier'); } catch { }

export function setupIpc() {
  setupSpeechIpc();
  setupTerminalIpc();
  // Overlay
  ipcMain.handle("overlay:show", () => showWindow());
  ipcMain.handle("overlay:hide", () => hideWindow());
  ipcMain.handle("overlay:toggle", () => toggleWindow());
  ipcMain.handle("overlay:setMode", (_e, mode: "compact" | "expanded" | "sidebar" | "window") => setOverlayMode(mode));
  ipcMain.handle("overlay:resize", (_e, w: number, h: number) => setOverlaySize(w, h, false));
  ipcMain.handle("overlay:moveBy", (_e, dx: number, dy: number) => moveOverlayBy(dx, dy));
  ipcMain.handle("overlay:getSize", () => getOverlaySize());
  ipcMain.handle("overlay:getMode", () => getOverlayMode());

  // System windows
  ipcMain.handle("system:openDashboard", (_e, options?: { tab?: string }) => openDashboardWindow(options));
  ipcMain.handle("system:openWorkflows", (_e, options?: { marketplaceSlug?: string }) => openWorkflowsWindow(options));
  ipcMain.handle("system:openOnboarding", () => openOnboardingWindow());
  ipcMain.handle("system:closeOnboarding", () => closeOnboardingWindow());

  // Spaces window
  ipcMain.handle('spaces:open', () => openSpacesWindow());
  ipcMain.handle('spaces:close', () => closeSpacesWindow());
  ipcMain.handle('spaces:toggle', () => toggleSpacesWindow());

  // Local webhook URL
  ipcMain.handle('webhooks:localUrl', (_e, id?: string) => {
    const token = '';
    const topic = (typeof id === 'string' && id) ? `/${id}` : '';
    const port = getLocalWebhookPort();
    return { ok: true, url: `http://127.0.0.1:${port}/webhooks/incoming${topic}${token ? `?token=${encodeURIComponent(token)}` : ''}` };
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
      const body = String(payload?.body || '');
      if (Notification && typeof (Notification as any).isSupported === 'function' && Notification.isSupported()) {
        const n = new Notification({ title, body });
        n.show();
      } else if (nodeNotifier && typeof nodeNotifier.notify === 'function') {
        nodeNotifier.notify({
          title,
          message: body,
          appName: 'Stuard AI',
          appID: 'Stuard AI',
        });
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || 'failed') };
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

  // Tools execution (Renderer -> Main -> Local Agent/System)
  ipcMain.handle('tools:exec', async (_e, tool: string, args: any) => {
    try {
      logger.info("Initializing custom UI IPC...");
      // Initialize custom UI IPC with a function to get the router context
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

  // Open chat in overlay
  ipcMain.handle('overlay:openChat', (_e, conversationId: string) => {
    try {
      setOverlayMode('expanded');
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

  ipcMain.handle('fileIndex:scan', async (_e, rootId: string) => {
    try {
      const progress = await scanRoot(rootId);
      return { ok: true, progress };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('fileIndex:search', async (_e, query: string, options?: any) => {
    try {
      const files = await searchFiles(query, options || {});
      return { ok: true, files };
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

  // Polar Billing
  ipcMain.handle('billing:createCheckout', async (_e, options: any) => {
    try {
      return await createCheckout(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:getCustomer', async (_e, email: string) => {
    try {
      return await getCustomer(email);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:listProducts', async () => {
    try {
      return await listProducts();
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:openPortal', async (_e, customerId: string) => {
    try {
      return await openCustomerPortal(customerId);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:purchaseCredits', async (_e, options: any) => {
    try {
      return await purchaseCredits(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
