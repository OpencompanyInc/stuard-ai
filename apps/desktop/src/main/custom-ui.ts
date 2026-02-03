/**
 * Custom UI System - Enhanced with proper IPC and JavaScript support
 *
 * Features:
 * - Proper IPC communication (no more title polling)
 * - stuard API exposed via preload for JS access
 * - Tool calling from within UI
 * - Real-time bidirectional events
 * - File dialogs, clipboard, notifications
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen, ipcMain, dialog, clipboard, Notification, app } from 'electron';
import { pathToFileURL } from 'url';
import type { RouterContext } from './tool-router';
import { execTool } from './tools/index';
import logger from './utils/logger';

// Security: Allowed base directories for file operations
// Custom UIs can only read/write within these directories
function getAllowedBasePaths(): string[] {
  return [
    app.getPath('userData'),
    app.getPath('temp'),
    app.getPath('downloads'),
    app.getPath('documents'),
    app.getPath('desktop'),
  ];
}

// Security: Check if a path is within allowed directories
function isPathAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const allowed = getAllowedBasePaths();
  return allowed.some(base => resolved.startsWith(path.resolve(base)));
}

// Security: Track user-approved paths per window session
const userApprovedPaths = new Map<number, Set<string>>();

function approvePathForWindow(webContentsId: number, filePath: string): void {
  const resolved = path.resolve(filePath);
  if (!userApprovedPaths.has(webContentsId)) {
    userApprovedPaths.set(webContentsId, new Set());
  }
  userApprovedPaths.get(webContentsId)!.add(resolved);
}

function isPathApprovedForWindow(webContentsId: number, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const approved = userApprovedPaths.get(webContentsId);
  if (!approved) return false;
  // Check exact match or if it's within an approved directory
  for (const approvedPath of approved) {
    if (resolved === approvedPath || resolved.startsWith(approvedPath + path.sep)) {
      return true;
    }
  }
  return false;
}

// Window storage
export const customUiWindows = new Map<string, BrowserWindow>();

// Per-window data storage
const windowData = new Map<string, { data: any; flowId: string; resolve?: (result: any) => void; keepOpen?: boolean }>();

// Audio player (hidden window for audio playback)
let audioPlayerWindow: BrowserWindow | null = null;
let audioPlayerReady: Promise<BrowserWindow> | null = null;

// Get preload script path
function getPreloadPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    // Development: look in dist/main
    return path.join(__dirname, 'custom-ui-preload.js');
  }
  // Production: look in resources
  return path.join(process.resourcesPath, 'app', 'dist', 'main', 'custom-ui-preload.js');
}

// Initialize IPC handlers for custom UI windows
let ipcInitialized = false;

export function initCustomUiIpc(getRouterContext: () => RouterContext): void {
  if (ipcInitialized) return;
  ipcInitialized = true;

  // Get window ID
  ipcMain.handle('stuard:getWindowId', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) return id;
    }
    return null;
  });

  // Get initial data
  ipcMain.handle('stuard:getData', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return {};
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.data || {};
      }
    }
    return {};
  });

  // Get flow ID
  ipcMain.handle('stuard:getFlowId', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.flowId || null;
      }
    }
    return null;
  });

  // Call a workflow tool
  ipcMain.handle('stuard:callTool', async (event, { tool, args }) => {
    try {
      const ctx = getRouterContext();
      ctx.logFn(`[custom_ui] Calling tool: ${tool}`);
      const result = await execTool(tool, args, ctx);
      return result;
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'tool_call_failed') };
    }
  });

  // Run script - SECURITY: Disabled for security reasons
  // Arbitrary script execution from custom UIs is too dangerous
  // Use stuard:callTool instead for workflow operations
  ipcMain.handle('stuard:runScript', async (_event, _args) => {
    console.warn('[custom_ui] stuard:runScript is disabled for security. Use stuard:callTool instead.');
    return { 
      ok: false, 
      error: 'disabled_for_security', 
      message: 'runScript is disabled. Use stuard.callTool() for workflow operations.' 
    };
  });

  // Update data
  ipcMain.handle('stuard:updateData', (event, updates) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const existing = windowData.get(id);
        if (existing) {
          existing.data = { ...existing.data, ...updates };
          // Notify window of data change
          if (!w.isDestroyed()) {
            w.webContents.send('stuard:data-update', existing.data);
          }
        }
        break;
      }
    }
  });

  // Emit event from UI
  ipcMain.on('stuard:emit', (event, { event: eventName, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const ctx = getRouterContext();
        ctx.logFn(`[custom_ui:${id}] Event emitted: ${eventName}`);
        // Could route this to workflow engine if needed
        break;
      }
    }
  });

  // Submit
  ipcMain.on('stuard:submit', (event, { data, keepOpen }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action: 'submit', data: mergedData });
          winData.resolve = undefined;
        }
        if (!keepOpen && !winData?.keepOpen) {
          try {
            w.close();
          } catch { }
          customUiWindows.delete(id);
          windowData.delete(id);
        }
        break;
      }
    }
  });

  // Action
  ipcMain.on('stuard:action', (event, { action, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action, data: mergedData });
          winData.resolve = undefined;
        }
        // Don't close for generic actions unless it's close/cancel
        const closeActions = ['close', 'cancel', 'exit'];
        if (closeActions.includes(action) && !winData?.keepOpen) {
          try {
            w.close();
          } catch { }
          customUiWindows.delete(id);
          windowData.delete(id);
        }
        break;
      }
    }
  });

  // Close
  ipcMain.on('stuard:close', (event, { data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.resolve) {
          const mergedData = { ...(winData.data || {}), ...(data || {}) };
          winData.resolve({ ok: true, action: 'closed', data: mergedData });
          winData.resolve = undefined;
        }
        try {
          w.close();
        } catch { }
        customUiWindows.delete(id);
        windowData.delete(id);
        break;
      }
    }
  });

  // Stop workflow
  ipcMain.on('stuard:stopWorkflow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData?.flowId) {
          try {
            const { workflows_stop } = require('./workflows/workflows');
            workflows_stop(winData.flowId);
            const ctx = getRouterContext();
            ctx.logFn(`[custom_ui:${id}] Stopped workflow ${winData.flowId}`);
          } catch (e: any) {
            console.error('[custom_ui] Failed to stop workflow:', e);
          }
        }
        break;
      }
    }
  });

  // File picker - SECURITY: Approves selected paths for this window
  ipcMain.handle('stuard:pickFile', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;
    const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
    if (options?.multiple) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(win || undefined as any, {
      title: options?.title || 'Select File',
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      properties,
    });

    // Approve selected paths for this window
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        approvePathForWindow(webContentsId, filePath);
      }
    }

    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // Folder picker - SECURITY: Approves selected paths for this window
  ipcMain.handle('stuard:pickFolder', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;
    const properties: ('openDirectory' | 'multiSelections')[] = ['openDirectory'];
    if (options?.multiple) properties.push('multiSelections');

    const result = await dialog.showOpenDialog(win || undefined as any, {
      title: options?.title || 'Select Folder',
      properties,
    });

    // Approve selected folders (and their contents) for this window
    if (!result.canceled && result.filePaths.length > 0) {
      for (const folderPath of result.filePaths) {
        approvePathForWindow(webContentsId, folderPath);
      }
    }

    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // Save dialog - SECURITY: Approves selected path for this window
  ipcMain.handle('stuard:pickSavePath', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const webContentsId = event.sender.id;

    const result = await dialog.showSaveDialog(win || undefined as any, {
      title: options?.title || 'Save File',
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });

    // Approve selected path for this window
    if (!result.canceled && result.filePath) {
      approvePathForWindow(webContentsId, result.filePath);
    }

    return { canceled: result.canceled, filePath: result.filePath };
  });

  // Read file - SECURITY: Restricted to allowed directories or user-approved paths
  ipcMain.handle('stuard:readFile', async (event, { path: filePath, encoding }) => {
    try {
      const webContentsId = event.sender.id;
      const resolved = path.resolve(filePath);
      
      // Security check: must be in allowed directories or user-approved
      if (!isPathAllowed(resolved) && !isPathApprovedForWindow(webContentsId, resolved)) {
        console.warn(`[custom_ui] File read blocked - not in allowed paths: ${resolved}`);
        throw new Error('Access denied: file is outside allowed directories. Use pickFile() to request access.');
      }
      
      const content = await fs.promises.readFile(resolved, { encoding: encoding || 'utf-8' });
      return content;
    } catch (e: any) {
      throw new Error(`Failed to read file: ${e?.message}`);
    }
  });

  // Write file - SECURITY: Restricted to allowed directories or user-approved paths
  ipcMain.handle('stuard:writeFile', async (event, { path: filePath, content }) => {
    try {
      const webContentsId = event.sender.id;
      const resolved = path.resolve(filePath);
      
      // Security check: must be in allowed directories or user-approved
      if (!isPathAllowed(resolved) && !isPathApprovedForWindow(webContentsId, resolved)) {
        console.warn(`[custom_ui] File write blocked - not in allowed paths: ${resolved}`);
        throw new Error('Access denied: file is outside allowed directories. Use pickSavePath() to request access.');
      }
      
      const dir = path.dirname(resolved);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(resolved, content, 'utf-8');
    } catch (e: any) {
      throw new Error(`Failed to write file: ${e?.message}`);
    }
  });

  // Notification
  ipcMain.on('stuard:notify', (_event, { title, body }) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body: body || '' }).show();
      }
    } catch { }
  });

  // Clipboard
  ipcMain.handle('stuard:clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || ''));
  });

  ipcMain.handle('stuard:clipboard:read', () => {
    return clipboard.readText();
  });

  // Log
  ipcMain.on('stuard:log', (_event, { message, level }) => {
    const ctx = getRouterContext();
    ctx.logFn(`[custom_ui] ${message}`);
  });

  // Window controls
  ipcMain.on('stuard:setAlwaysOnTop', (event, flag) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(!!flag);
    }
  });

  ipcMain.on('stuard:resize', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setSize(Math.max(100, width), Math.max(50, height));
    }
  });

  ipcMain.on('stuard:moveTo', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setPosition(x, y);
    }
  });

  ipcMain.on('stuard:center', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.center();
    }
  });

  ipcMain.on('stuard:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  ipcMain.handle('stuard:getScreenInfo', () => {
    const display = screen.getPrimaryDisplay();
    return {
      width: display.size.width,
      height: display.size.height,
      workArea: display.workArea,
    };
  });
}

// Audio player window management
async function ensureAudioPlayerWindow(): Promise<BrowserWindow> {
  if (audioPlayerWindow && !audioPlayerWindow.isDestroyed()) return audioPlayerWindow;
  if (audioPlayerReady) return audioPlayerReady;

  audioPlayerReady = (async () => {
    const win = new BrowserWindow({
      width: 200,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required' as any,
      },
    });

    win.on('closed', () => {
      if (audioPlayerWindow === win) audioPlayerWindow = null;
      audioPlayerReady = null;
    });

    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body>
      <script>
        window.__stuardPlayAudio = async function(url) {
          return await new Promise(async (resolve, reject) => {
            try {
              const a = new Audio(url);
              a.onended = () => resolve({ ok: true, status: 'ended' });
              a.onerror = () => reject(new Error('audio_error'));
              await a.play();
            } catch (e) {
              reject(e);
            }
          });
        };
      </script>
    </body></html>`;

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    audioPlayerWindow = win;
    return win;
  })();

  return audioPlayerReady;
}

export async function execPlayAudio(args: any, ctx: RouterContext): Promise<any> {
  try {
    const filePath = String(args?.path || args?.filePath || '').trim();
    const block = args?.block !== false;

    if (!filePath) return { ok: false, error: 'missing_file_path' };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found', path: filePath };

    const win = await ensureAudioPlayerWindow();
    const url = pathToFileURL(filePath).toString();

    const js = `window.__stuardPlayAudio(${JSON.stringify(url)})`;

    if (block) {
      await win.webContents.executeJavaScript(js, true);
      return { ok: true, played: filePath, method: 'electron' };
    }

    win.webContents.executeJavaScript(js, true).catch(() => { });
    return { ok: true, status: 'playing', path: filePath, method: 'electron' };
  } catch (e: any) {
    ctx.logFn(`play_audio failed: ${e?.message || 'unknown'}`);
    return { ok: false, error: String(e?.message || 'play_audio_failed') };
  }
}

// Position calculation
function calculatePosition(
  position: string | { x?: number; y?: number } | undefined,
  windowWidth: number,
  windowHeight: number,
  explicitX?: number,
  explicitY?: number,
  margin: number = 20
): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();

  if (explicitX !== undefined && explicitY !== undefined) {
    return { x: explicitX, y: explicitY };
  }

  if (position && typeof position === 'object') {
    return {
      x: position.x ?? workArea.x + margin,
      y: position.y ?? workArea.y + margin,
    };
  }

  const pos = String(position || 'center').toLowerCase().replace(/[_-]/g, '');

  switch (pos) {
    case 'center':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'topleft':
      return { x: workArea.x + margin, y: workArea.y + margin };
    case 'top':
    case 'topcenter':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: workArea.y + margin,
      };
    case 'topright':
      return { x: workArea.x + workArea.width - windowWidth - margin, y: workArea.y + margin };
    case 'left':
    case 'centerleft':
      return {
        x: workArea.x + margin,
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'right':
    case 'centerright':
      return {
        x: workArea.x + workArea.width - windowWidth - margin,
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'bottomleft':
      return { x: workArea.x + margin, y: workArea.y + workArea.height - windowHeight - margin };
    case 'bottom':
    case 'bottomcenter':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: workArea.y + workArea.height - windowHeight - margin,
      };
    case 'bottomright':
      return {
        x: workArea.x + workArea.width - windowWidth - margin,
        y: workArea.y + workArea.height - windowHeight - margin,
      };
    default:
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
  }
}

// Main custom UI execution
export async function execCustomUi(args: any, ctx: RouterContext): Promise<any> {
  const id = String(args?.id || `customui_${Date.now()}`);
  const title = String(args?.title || 'Stuard UI');
  const windowCfg = args?.window || {};
  const width = Math.max(100, Number(windowCfg.width || args?.width || 400));
  const height = Math.max(50, Number(windowCfg.height || args?.height || 300));
  const blocking = !(
    args?.blocking === false ||
    args?.blocking === 'false' ||
    windowCfg?.blocking === false ||
    windowCfg?.blocking === 'false'
  );
  const timeoutMs = Number(args?.timeoutMs || 60000);
  const css = String(args?.css || '');
  const layout = args?.layout || args?.content || {};
  const rawHtml = typeof args?.html === 'string' ? args.html : undefined;
  const initScript = typeof args?.script === 'string' ? args.script : undefined;
  const data = args?.data || {};
  const keepOpen = args?.keepOpen === true;
  const borderRadius = Number(windowCfg.borderRadius ?? windowCfg.radius ?? 0);
  const margin = Number(windowCfg.margin ?? 20);
  const frameless = windowCfg.frameless !== false;
  const wantsTransparentWindow = windowCfg.transparent === true || windowCfg.transparent === 'true';
  const transparentBg =
    windowCfg.noBackground === true ||
    windowCfg.noBackground === 'true' ||
    windowCfg.transparentBg === true ||
    windowCfg.transparentBg === 'true' ||
    wantsTransparentWindow ||
    (rawHtml && wantsTransparentWindow);

  const flowId = args?.flowId || (ctx as any)?.flowId || '';

  const existing = customUiWindows.get(id);
  const forceNew = args?.forceNew === true;
  ctx.logFn(`custom_ui: id="${id}", existing=${!!existing}, destroyed=${existing?.isDestroyed()}, blocking=${blocking}`);

  // Parse data if string
  let safeData = typeof data === 'string' ? {} : (data || {});
  if (typeof data === 'string') {
    try {
      safeData = JSON.parse(data);
    } catch (e) {
      ctx.logFn(`custom_ui: Warning - failed to parse 'data' argument as JSON: ${e}`);
    }
  }

  // Auto-merge non-reserved arguments into data
  const reservedArgs = new Set([
    'id', 'title', 'window', 'width', 'height', 'blocking', 'timeoutMs',
    'css', 'layout', 'content', 'html', 'script', 'keepOpen', 'forceNew', 'flowId', 'data'
  ]);

  for (const [key, val] of Object.entries(args || {})) {
    if (!reservedArgs.has(key)) {
      safeData[key] = val;
    }
  }

  ctx.logFn(`custom_ui: data keys=[${Object.keys(safeData).join(', ')}]`);

  const { x, y } = calculatePosition(
    windowCfg.position,
    width,
    height,
    windowCfg.x,
    windowCfg.y,
    margin
  );

  // Handle existing window
  if (existing && !existing.isDestroyed() && !forceNew) {
    const htmlContent = generateCustomUiHtml(id, title, css, layout, safeData, rawHtml, borderRadius, flowId, transparentBg, initScript);
    await existing.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    existing.setTitle(title);

    const [currentWidth, currentHeight] = existing.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      existing.setSize(width, height);
    }
    existing.setPosition(x, y);

    existing.show();
    existing.focus();
    ctx.logFn(`custom_ui: Updated "${title}" (reusing window)`);

    // Update stored data
    const existingData = windowData.get(id);
    if (existingData) {
      existingData.data = safeData;
      existingData.flowId = flowId;
    }

    if (!blocking) {
      return { ok: true, action: 'updated', data: safeData };
    }
    return waitForUiAction(existing, id, safeData, timeoutMs, keepOpen, ctx, flowId);
  }

  // Close existing window if forceNew
  if (existing && !existing.isDestroyed()) {
    try {
      existing.close();
    } catch { }
    customUiWindows.delete(id);
    windowData.delete(id);
  }

  const transparent = !!windowCfg.transparent || frameless || borderRadius > 0 || transparentBg;
  const isAlwaysOnTop = windowCfg.alwaysOnTop !== false;
  const shouldSkipTaskbar = windowCfg.skipTaskbar === true || (isAlwaysOnTop && windowCfg.skipTaskbar !== false);

  // Get preload path
  let preloadPath: string | undefined;
  try {
    preloadPath = getPreloadPath();
    // Check if preload exists
    if (!fs.existsSync(preloadPath)) {
      ctx.logFn(`custom_ui: Preload not found at ${preloadPath}, falling back to legacy mode`);
      preloadPath = undefined;
    }
  } catch {
    preloadPath = undefined;
  }

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: !frameless,
    transparent,
    backgroundColor: '#00000000',
    resizable: windowCfg.resizable !== false,
    movable: windowCfg.movable !== false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: shouldSkipTaskbar,
    alwaysOnTop: isAlwaysOnTop,
    hasShadow: windowCfg.shadow !== false && !transparentBg,
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // SECURITY: Enable sandbox for isolation
      webSecurity: true, // SECURITY: Enable web security
      preload: preloadPath,
    },
  });

  if (frameless) win.setMenu(null);

  if (isAlwaysOnTop) {
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu');
    } catch { }
  }

  customUiWindows.set(id, win);
  windowData.set(id, { data: safeData, flowId, keepOpen });
  ctx.logFn(`custom_ui: Stored window "${id}" in map (total: ${customUiWindows.size})`);

  const htmlContent = generateCustomUiHtml(id, title, css, layout, safeData, rawHtml, borderRadius, flowId, transparentBg, initScript);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  win.show();

  ctx.logFn(`custom_ui: Showing "${title}" (${width}x${height}) at ${windowCfg.position || 'center'}${transparentBg ? ' [transparent]' : ''}`);

  if (!blocking) {
    return { ok: true, action: 'shown', data: safeData };
  }

  return waitForUiAction(win, id, safeData, timeoutMs, keepOpen, ctx, flowId);
}

function waitForUiAction(
  win: BrowserWindow,
  id: string,
  data: any,
  timeoutMs: number,
  keepOpen: boolean,
  ctx: RouterContext,
  flowId?: string
): Promise<any> {
  return new Promise((resolve) => {
    let resolved = false;
    let timeoutTimer: NodeJS.Timeout | null = null;

    // Store the resolve function so IPC can use it
    const winData = windowData.get(id);
    if (winData) {
      winData.resolve = (result: any) => {
        if (resolved) return;
        resolved = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(result);
      };
      winData.keepOpen = keepOpen;
    }

    // Handle window close
    win.on('closed', () => {
      if (!resolved) {
        resolved = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({ ok: true, action: 'closed', data });
      }
      customUiWindows.delete(id);
      windowData.delete(id);
    });

    // Timeout
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const winData = windowData.get(id);
          if (winData) winData.resolve = undefined;

          if (!keepOpen && !win.isDestroyed()) {
            try {
              win.close();
            } catch { }
            customUiWindows.delete(id);
            windowData.delete(id);
          }
          resolve({ ok: false, action: 'timeout', data });
        }
      }, timeoutMs);
    }
  });
}

export function execCloseCustomUi(args: any): { ok: boolean } {
  const id = String(args?.id || '');
  const win = customUiWindows.get(id);
  if (win && !win.isDestroyed()) {
    try {
      win.close();
    } catch { }
  }
  customUiWindows.delete(id);
  windowData.delete(id);
  return { ok: true };
}

export async function execUpdateCustomUi(args: any, ctx: RouterContext): Promise<any> {
  const windowId = String(args?.id || '');
  const updates = args?.data || args?.update || {};
  const html = typeof args?.html === 'string' ? args.html : undefined;
  const css = typeof args?.css === 'string' ? args.css : undefined;
  const script = typeof args?.script === 'string' ? args.script : undefined;

  if (!windowId) {
    return { ok: false, error: 'missing_window_id' };
  }

  const existing = customUiWindows.get(windowId);
  if (!existing || existing.isDestroyed()) {
    return { ok: false, error: 'window_not_found' };
  }

  // Update stored data
  const winData = windowData.get(windowId);
  if (winData && updates) {
    winData.data = { ...winData.data, ...updates };
  }

  // Send data update to window
  existing.webContents.send('stuard:data-update', winData?.data || updates);

  let updateScript = `(function() {
    const updates = ${JSON.stringify(updates)};
    let changed = [];

    // Update data bindings
    for (const [key, value] of Object.entries(updates)) {
      const bindEl = document.querySelector('[data-bind="' + key + '"]');
      if (bindEl) {
        if (bindEl.tagName === 'INPUT' || bindEl.tagName === 'TEXTAREA') {
          bindEl.value = value;
        } else if (bindEl.hasAttribute('data-html') || bindEl.hasAttribute('data-render-html')) {
          bindEl.innerHTML = value;
        } else {
          bindEl.textContent = value;
        }
        changed.push(key);
      }
      if (typeof formData !== 'undefined') {
        formData[key] = value;
      }
    }
  `;

  if (html !== undefined) {
    updateScript += `
      const root = document.querySelector('.stuard-root') || document.querySelector('.root') || document.body;
      if (root) {
        root.innerHTML = ${JSON.stringify(html)};
        changed.push('html');
      }
    `;
  }

  if (css !== undefined) {
    updateScript += `
      let styleEl = document.getElementById('stuard-custom-css');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'stuard-custom-css';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = ${JSON.stringify(css)};
      changed.push('css');
    `;
  }

  if (script !== undefined) {
    updateScript += `
      try {
        ${script}
        changed.push('script');
      } catch (e) {
        console.error('[stuard] Script error:', e);
      }
    `;
  }

  updateScript += `
    return { updated: changed };
  })();
  `;

  try {
    const result = await existing.webContents.executeJavaScript(updateScript);
    ctx.logFn(`update_custom_ui: Updated in "${windowId}": ${result?.updated?.join(', ')}`);
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'update_failed' };
  }
}

/**
 * Send an event to a custom UI window
 */
export function sendEventToCustomUi(windowId: string, eventName: string, data: any): boolean {
  const win = customUiWindows.get(windowId);
  if (!win || win.isDestroyed()) return false;

  try {
    win.webContents.send('stuard:event', { eventName, data });
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateCustomUiHtml(
  id: string,
  title: string,
  css: string,
  layout: any,
  data: any,
  rawHtml?: string,
  borderRadius: number = 0,
  flowId: string = '',
  transparentBg: boolean = false,
  initScript?: string
): string {
  const radiusStyle = borderRadius > 0 ? `border-radius: ${borderRadius}px;` : '';
  const shadowStyle = borderRadius > 0 && !transparentBg ? `box-shadow: 0 8px 32px rgba(0,0,0,0.4);` : '';
  const clipStyle = borderRadius > 0 ? `overflow: hidden;` : '';

  const defaultCss = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html {
      background: transparent !important;
      -webkit-font-smoothing: antialiased;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: transparent !important;
      color: #e2e8f0;
      min-height: 100vh;
      font-size: 14px;
      line-height: 1.5;
      ${borderRadius > 0 ? `${radiusStyle} ${clipStyle}` : ''}
    }

    .overlay-container, .root, .stuard-root {
      background: transparent;
      ${radiusStyle}
      ${shadowStyle}
      ${clipStyle}
      min-height: 100vh;
    }

    ${transparentBg ? `
      .overlay-container, .root, .stuard-root, body > div, body > div > div {
        background: transparent !important;
      }
    ` : ''}

    body { -webkit-app-region: drag; }
    input, textarea, button, a, select, [data-action], [data-bind], .no-drag {
      -webkit-app-region: no-drag;
      font-family: inherit;
    }

    button { cursor: pointer; user-select: none; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      border: 1px solid transparent;
      border-radius: 8px;
      font-weight: 500;
      font-size: 13px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      gap: 8px;
    }
    .btn:active { transform: scale(0.98); }

    .btn-primary {
      background: #6366f1;
      color: white;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .btn-primary:hover {
      background: #4f46e5;
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
    }

    .btn-danger {
      background: #ef4444;
      color: white;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover { background: #dc2626; }

    .btn-secondary {
      background: #334155;
      color: white;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .btn-secondary:hover { background: #475569; }

    .btn-ghost {
      background: transparent;
      color: #94a3b8;
      border: 1px solid transparent;
    }
    .btn-ghost:hover {
      background: rgba(255,255,255,0.05);
      color: #f8fafc;
    }

    input[type="text"], input[type="password"], textarea {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      color: #f1f5f9;
      border-radius: 8px;
      padding: 8px 12px;
      width: 100%;
      outline: none;
      transition: all 0.2s;
    }
    input:focus, textarea:focus {
      border-color: #6366f1;
      background: rgba(15, 23, 42, 0.8);
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }

    .glass {
      background: rgba(15, 23, 42, 0.7) !important;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.08);
    }

    .card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 16px;
    }

    h1, h2, h3, h4, h5, h6 { color: #f8fafc; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #cbd5e1; }

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.2);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.4); }

    .fade-in { animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .slide-up { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `;

  // Interpolate template variables in raw HTML
  // Triple braces {{{var}}} = raw HTML (unescaped)
  // Double braces {{var}} = escaped text
  const interpolatedHtml = rawHtml
    ? rawHtml
      // First handle triple braces (raw HTML, no escaping)
      .replace(/\{\{\{\s*([\w\.]+)\s*\}\}\}/g, (match: string, k: string) => {
        const val = k.split('.').reduce((o, key) => (o || {})[key], data);
        return val !== undefined ? String(val) : match;
      })
      // Then handle double braces (escaped)
      .replace(/\{\{\s*([\w\.]+)\s*\}\}/g, (match: string, k: string) => {
        const val = k.split('.').reduce((o, key) => (o || {})[key], data);
        return val !== undefined ? escapeHtml(String(val)) : match;
      })
    : null;
  const layoutHtml = interpolatedHtml || renderLayout(layout, data);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src * data: blob: local-file: file:; media-src * data: blob: local-file: file:; font-src * data:;">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            dark: { 900: '#0f0f1a', 800: '#1a1a2e', 700: '#2d2d44' }
          }
        }
      }
    }
  </script>
  <style>${defaultCss}\n${css}</style>
</head>
<body class="dark">
  <div class="stuard-root">${layoutHtml}</div>
  <script>
    const CUSTOM_UI_ID = ${JSON.stringify(id)};
    const FLOW_ID = ${JSON.stringify(flowId)};
    const initialData = ${JSON.stringify(data)};
    const formData = { ...initialData, flowId: FLOW_ID };

    // Check if stuard API is available (preload loaded successfully)
    const hasStuardApi = typeof window.stuard !== 'undefined';

    // Initialize data bindings
    document.querySelectorAll('[data-bind]').forEach(el => {
      const key = el.getAttribute('data-bind');
      const val = formData[key];
      const useHtml = el.hasAttribute('data-html') || el.hasAttribute('data-render-html');

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (val !== undefined && val !== '') {
          el.value = val;
        } else {
          formData[key] = el.value || '';
        }
        el.addEventListener('input', (e) => { formData[key] = e.target.value; });
      } else {
        if (val !== undefined) {
          if (useHtml) {
            el.innerHTML = val;
          } else {
            el.textContent = val;
          }
        }
      }
    });

    // Initialize action handlers
    document.querySelectorAll('[data-action]').forEach(el => {
      const actionName = el.getAttribute('data-action');

      el.addEventListener('click', async () => {
        if (hasStuardApi) {
          // Use the new IPC-based API
          if (actionName === 'submit') {
            window.stuard.submit(formData);
          } else if (actionName === 'close' || actionName === 'cancel') {
            window.stuard.close(formData);
          } else if (actionName === 'stop_workflow') {
            window.stuard.stopWorkflow();
          } else if (actionName.startsWith('pick_')) {
            // File picker actions
            const targetField = el.getAttribute('data-target') || el.getAttribute('data-bind');
            let result;

            if (actionName === 'pick_file') {
              result = await window.stuard.pickFile({
                title: el.getAttribute('data-title') || 'Select File',
                multiple: false
              });
            } else if (actionName === 'pick_files') {
              result = await window.stuard.pickFile({
                title: el.getAttribute('data-title') || 'Select Files',
                multiple: true
              });
            } else if (actionName === 'pick_folder') {
              result = await window.stuard.pickFolder({
                title: el.getAttribute('data-title') || 'Select Folder'
              });
            } else if (actionName === 'pick_save_path') {
              result = await window.stuard.pickSavePath({
                title: el.getAttribute('data-title') || 'Save File'
              });
            }

            if (result && !result.canceled && targetField) {
              const path = result.filePath || result.filePaths?.[0] || '';
              formData[targetField] = path;
              const input = document.querySelector('[data-bind="' + targetField + '"]');
              if (input) {
                input.value = path;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          } else {
            // Generic action
            window.stuard.action(actionName, formData);
          }
        } else {
          // Fallback to title-based communication
          document.title = 'ACTION:' + actionName + ':' + JSON.stringify(formData);
        }
      });
    });

    // Enter key submits
    document.querySelectorAll('input[data-bind]').forEach(el => {
      el.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          if (hasStuardApi) {
            window.stuard.submit(formData);
          } else {
            document.title = 'ACTION:submit:' + JSON.stringify(formData);
          }
        }
      });
    });

    // Listen for data updates
    if (hasStuardApi) {
      window.stuard.onDataUpdate((newData) => {
        Object.assign(formData, newData);
        // Update bound elements
        for (const [key, value] of Object.entries(newData)) {
          const bindEl = document.querySelector('[data-bind="' + key + '"]');
          if (bindEl) {
            if (bindEl.tagName === 'INPUT' || bindEl.tagName === 'TEXTAREA') {
              bindEl.value = value;
            } else if (bindEl.hasAttribute('data-html') || bindEl.hasAttribute('data-render-html')) {
              bindEl.innerHTML = value;
            } else {
              bindEl.textContent = value;
            }
          }
        }
      });
    }

    // Run initialization script if provided
    ${initScript ? `
    (async () => {
      try {
        ${initScript}
      } catch (e) {
        console.error('[stuard] Init script error:', e);
      }
    })();
    ` : ''}
  </script>
</body>
</html>`;
}

function renderLayout(node: any, data: any): string {
  if (!node) return '';
  if (typeof node === 'string') return escapeHtml(node);
  if (Array.isArray(node)) return node.map((n) => renderLayout(n, data)).join('');

  const type = String(node.type || 'div');
  const className = node.className ? ` class="${escapeHtml(node.className)}"` : '';
  const style = node.style
    ? ` style="${Object.entries(node.style)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')}"`
    : '';
  const bind = node.bind ? ` data-bind="${escapeHtml(node.bind)}"` : '';
  const placeholder = node.placeholder ? ` placeholder="${escapeHtml(node.placeholder)}"` : '';

  let action = '';
  let actionName = '';
  if (node.on) {
    const parts = String(node.on).split(':');
    if (parts.length >= 2) {
      actionName = parts[1];
    }
  }
  if (node.action) {
    actionName = String(node.action);
  }
  if (actionName) {
    action = ` data-action="${escapeHtml(actionName)}"`;
  }

  let children = '';
  if (node.children) {
    if (typeof node.children === 'string') {
      children = node.children.replace(/\{\{([\w\.]+)\}\}/g, (_: any, k: string) => {
        const val = k.split('.').reduce((o, key) => (o || {})[key], data);
        return escapeHtml(String(val !== undefined ? val : ''));
      });
    } else if (Array.isArray(node.children)) {
      children = node.children.map((c: any) => renderLayout(c, data)).join('');
    } else {
      children = renderLayout(node.children, data);
    }
  }

  if (type === 'input') {
    let value = '';
    if (node.bind) {
      const val = node.bind.split('.').reduce((o: any, key: string) => (o || {})[key], data);
      if (val !== undefined) value = ` value="${escapeHtml(String(val))}"`;
    }
    return `<input type="text"${className}${style}${bind}${placeholder}${value}${action}>`;
  }

  if (type === 'button') {
    const label = node.text || node.label || node.children || 'Button';
    return `<button${className}${style}${action}>${typeof label === 'string' ? escapeHtml(label) : renderLayout(label, data)}</button>`;
  }

  if (type === 'text') {
    const content = node.text || node.content || node.value || node.children || '';
    const text =
      typeof content === 'string'
        ? content.replace(/\{\{([\w\.]+)\}\}/g, (_: any, k: string) => {
          const val = k.split('.').reduce((o, key) => (o || {})[key], data);
          return escapeHtml(String(val !== undefined ? val : ''));
        })
        : renderLayout(content, data);
    return `<span${className}${style}>${text}</span>`;
  }

  return `<${type}${className}${style}${bind}${action}>${children}</${type}>`;
}
