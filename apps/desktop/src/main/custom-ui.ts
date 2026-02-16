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
import { onVariableChange, variableStore, setVariable, type VariableEntry } from './workflow-variables';

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
const windowData = new Map<string, { data: any; flowId: string; resolve?: (result: any) => void; keepOpen?: boolean; currentPage?: string; pages?: Record<string, any>; subscribedVars?: Set<string> }>();

// ─── Variable → UI Live Binding System ──────────────────────────────────────

/**
 * Subscribe a custom_ui window to a workflow variable.
 * When that variable changes, the window receives a stuard:var-update IPC message.
 */
export function subscribeWindowToVar(windowId: string, varName: string): void {
  const wd = windowData.get(windowId);
  if (!wd) return;
  if (!wd.subscribedVars) wd.subscribedVars = new Set();
  wd.subscribedVars.add(varName);
}

/**
 * Normalise a variable name for matching.
 * Users write `data-var="counter"` but the store key might be `workflow.counter` or just `counter`.
 * We match if the store key equals the name OR ends with `.${name}`.
 */
function varNameMatches(storeKey: string, bindName: string): boolean {
  if (storeKey === bindName) return true;
  if (storeKey.endsWith(`.${bindName}`)) return true;
  return false;
}

/**
 * Broadcast a variable change to all open custom_ui windows that reference it.
 * Called automatically by the onVariableChange listener.
 */
function broadcastVariableUpdate(name: string, entry: VariableEntry, _previousValue: any): void {
  for (const [id, win] of customUiWindows) {
    if (win.isDestroyed()) continue;
    const wd = windowData.get(id);

    // If this window explicitly subscribed to this variable, push the update
    const subs = wd?.subscribedVars;
    let shouldSend = false;
    if (subs) {
      for (const sub of subs) {
        if (varNameMatches(name, sub)) { shouldSend = true; break; }
      }
    }

    // Also send to windows that registered '*' (wildcard = all variables)
    if (!shouldSend && subs?.has('*')) {
      shouldSend = true;
    }

    if (shouldSend) {
      try {
        // Strip 'workflow.' prefix for the bind name so `data-var="counter"` matches
        const shortName = name.startsWith('workflow.') ? name.slice('workflow.'.length) : name;
        win.webContents.send('stuard:var-update', {
          name,
          shortName,
          value: entry.value,
          type: entry.type,
          updatedAt: entry.updatedAt,
        });
      } catch (e) {
        console.error(`[CUSTOM-UI] Error broadcasting var update to window "${id}":`, e);
      }
    }
  }
}

// Register the global variable change listener
onVariableChange(broadcastVariableUpdate);

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

  // Subscribe to workflow variable updates (called by renderer when data-var elements are found)
  ipcMain.handle('stuard:subscribeVars', (event, varNames: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const wd = windowData.get(id);
        if (wd) {
          if (!wd.subscribedVars) wd.subscribedVars = new Set();
          for (const v of varNames) {
            wd.subscribedVars.add(v);
          }
          console.log(`[CUSTOM-UI] Window "${id}" subscribed to vars: [${varNames.join(', ')}]`);
        }
        break;
      }
    }
  });

  // Get current value of a workflow variable (for initial rendering of data-var elements)
  ipcMain.handle('stuard:getVar', (_event, varName: string) => {
    // Try exact match first, then with workflow. prefix
    let entry = variableStore.get(varName);
    if (!entry) entry = variableStore.get(`workflow.${varName}`);
    if (entry) {
      return { ok: true, name: varName, value: entry.value, type: entry.type };
    }
    return { ok: false, name: varName, value: undefined };
  });

  // Set a workflow variable directly from custom UI
  ipcMain.handle('stuard:setVar', (_event, args: { name: string; value: any; type?: string }) => {
    const { name, value, type } = args || {};
    if (!name) return { ok: false, error: 'missing_variable_name' };

    // Resolve name: try exact first, then with workflow. prefix for existing vars
    let resolvedName = name;
    if (!variableStore.has(name) && !name.startsWith('workflow.')) {
      const wfName = `workflow.${name}`;
      if (variableStore.has(wfName)) {
        resolvedName = wfName;
      }
    }

    const entry = setVariable(resolvedName, value, type as any);
    const ctx = getRouterContext();
    ctx.logFn(`[custom_ui] setVar: ${resolvedName} = ${JSON.stringify(entry.value)} (${entry.type})`);
    return { ok: true, name: resolvedName, value: entry.value, type: entry.type };
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

  // Navigate to a page (pages system)
  ipcMain.on('stuard:navigate', (event, { page, data }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    for (const [id, w] of customUiWindows) {
      if (w === win) {
        const winData = windowData.get(id);
        if (winData) {
          winData.currentPage = page;
          // Merge navigation data into window data
          if (data && typeof data === 'object') {
            winData.data = { ...winData.data, ...data };
          }
        }
        // Bounce back to the renderer so the client-side router can handle it
        if (!w.isDestroyed()) {
          w.webContents.send('stuard:page-change', { page, data });
        }
        const ctx = getRouterContext();
        ctx.logFn(`[custom_ui:${id}] Navigate to page: ${page}`);
        break;
      }
    }
  });

  // Get current page
  ipcMain.handle('stuard:getCurrentPage', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const [id, w] of customUiWindows) {
      if (w === win) {
        return windowData.get(id)?.currentPage || null;
      }
    }
    return null;
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

  // Stream subscription — allows custom UI to receive real-time stream chunks (video frames, text tokens, etc.)
  const streamPollers = new Map<string, NodeJS.Timeout>();

  ipcMain.handle('stuard:subscribeStream', async (event, { streamId }) => {
    try {
      const ctx = getRouterContext();
      const subResult = await execTool('_stream_subscribe', {
        streamId,
        label: `custom_ui_${Date.now()}`,
        fromStart: false,
      }, ctx);

      if (!subResult?.ok || !subResult?.subscriberId) {
        return { ok: false, error: 'subscribe_failed' };
      }

      const subscriberId = subResult.subscriberId;
      const win = BrowserWindow.fromWebContents(event.sender);
      let chunkIndex = 0;

      // Poll for chunks and push to the window
      const poll = async () => {
        if (!win || win.isDestroyed()) {
          clearInterval(pollInterval);
          streamPollers.delete(subscriberId);
          await execTool('_stream_unsubscribe', { streamId, subscriberId }, ctx).catch(() => {});
          return;
        }
        try {
          const readResult = await execTool('_stream_read', {
            streamId,
            subscriberId,
            maxChunks: 50,
            waitMs: 100,
          }, ctx);

          if (readResult?.ok && readResult.chunks?.length > 0) {
            for (const chunk of readResult.chunks) {
              const chunkData = chunk?.data !== undefined ? chunk.data : chunk;
              if (!win.isDestroyed()) {
                win.webContents.send('stuard:stream-chunk', {
                  data: chunkData,
                  index: chunkIndex++,
                  streamId,
                });
              }
            }
          }

          if (readResult?.closed) {
            clearInterval(pollInterval);
            streamPollers.delete(subscriberId);
            if (!win.isDestroyed()) {
              win.webContents.send('stuard:stream-chunk', {
                data: null,
                index: -1,
                streamId,
                closed: true,
              });
            }
          }
        } catch (e) {
          // Ignore read errors, keep polling
        }
      };

      const pollInterval = setInterval(poll, 50);
      streamPollers.set(subscriberId, pollInterval);

      return { ok: true, subscriberId };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'subscribe_failed') };
    }
  });

  ipcMain.handle('stuard:unsubscribeStream', async (_event, { streamId, subscriberId }) => {
    try {
      const interval = streamPollers.get(subscriberId);
      if (interval) {
        clearInterval(interval);
        streamPollers.delete(subscriberId);
      }
      const ctx = getRouterContext();
      await execTool('_stream_unsubscribe', { streamId, subscriberId }, ctx);
      return { ok: true };
    } catch {
      return { ok: false };
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
  const timeoutMs = Number(args?.timeoutMs || 0);
  const css = String(args?.css || '');
  const layout = args?.layout || args?.content || {};
  const rawHtml = typeof args?.html === 'string' ? args.html : undefined;
  const initScript = typeof args?.script === 'string' ? args.script : undefined;
  const component = typeof args?.component === 'string' ? args.component : undefined;
  const data = args?.data || {};
  const keepOpen = args?.keepOpen === true;
  const borderRadius = Number(windowCfg.borderRadius ?? windowCfg.radius ?? 0);
  const margin = Number(windowCfg.margin ?? 20);
  const frameless = windowCfg.frameless !== false;
  const wantsTransparentWindow = windowCfg.transparent === true || windowCfg.transparent === 'true';

  // === ENHANCED WINDOW PROPERTIES ===
  const backgroundType = windowCfg.backgroundType || 'color';
  const backgroundColor = windowCfg.backgroundColor || 'transparent';
  const gradient = windowCfg.gradient;
  const backgroundImage = windowCfg.backgroundImage;
  const shadow = windowCfg.shadow || { enabled: false };
  const border = windowCfg.border || { enabled: false };
  const animation = windowCfg.animation;
  const contentPadding = windowCfg.contentPadding || 0;

  const transparentBg =
    windowCfg.noBackground === true ||
    windowCfg.noBackground === 'true' ||
    windowCfg.transparentBg === true ||
    windowCfg.transparentBg === 'true' ||
    wantsTransparentWindow ||
    (rawHtml && wantsTransparentWindow);

  const flowId = args?.flowId || (ctx as any)?.flowId || '';

  // Pages system - multi-page SPA navigation
  const pages = args?.pages || undefined; // Record<string, { html?, layout?, css?, script? }>
  const startPage = args?.startPage || (pages ? Object.keys(pages)[0] : undefined);

  const existing = customUiWindows.get(id);
  const forceNew = args?.forceNew === true;
  ctx.logFn(`custom_ui: id="${id}", existing=${!!existing}, destroyed=${existing?.isDestroyed()}, blocking=${blocking}${pages ? `, pages=[${Object.keys(pages).join(',')}], startPage=${startPage}` : ''}`);

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
    'css', 'layout', 'content', 'html', 'script', 'component', 'keepOpen', 'forceNew', 'flowId', 'data',
    'pages', 'startPage'
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
    // Update window properties
    const [currentWidth, currentHeight] = existing.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      existing.setSize(width, height);
    }
    existing.setPosition(x, y);
    existing.setTitle(title);

    // Generate enhanced HTML with new window properties
    const htmlContent = generateEnhancedCustomUiHtml({
      id,
      title,
      css,
      layout,
      data: safeData,
      rawHtml,
      borderRadius,
      flowId,
      transparentBg,
      initScript,
      component,
      pages,
      startPage,
      backgroundType,
      backgroundColor,
      gradient,
      backgroundImage,
      shadow,
      border,
      animation,
      contentPadding,
    });

    await existing.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Apply window shadow if enabled
    if (shadow.enabled) {
      existing.setHasShadow(true);
    }

    existing.show();
    existing.focus();
    ctx.logFn(`custom_ui: Updated "${title}" with enhanced properties (reusing window)`);

    // Update stored data
    const existingData = windowData.get(id);
    if (existingData) {
      existingData.data = safeData;
      existingData.flowId = flowId;
      existingData.pages = pages;
      existingData.currentPage = startPage;
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
    hasShadow: shadow.enabled !== false && !transparentBg,
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
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
  windowData.set(id, { data: safeData, flowId, keepOpen, pages, currentPage: startPage });
  ctx.logFn(`custom_ui: Stored window "${id}" in map (total: ${customUiWindows.size})`);

  // Generate enhanced HTML
  const htmlContent = generateEnhancedCustomUiHtml({
    id,
    title,
    css,
    layout,
    data: safeData,
    rawHtml,
    borderRadius,
    flowId,
    transparentBg,
    initScript,
    component,
    pages,
    startPage,
    backgroundType,
    backgroundColor,
    gradient,
    backgroundImage,
    shadow,
    border,
    animation,
    contentPadding,
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  win.show();

  ctx.logFn(`custom_ui: Showing "${title}" (${width}x${height}) with ${backgroundType} background${transparentBg ? ' [transparent]' : ''}`);

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

/**
 * Close all custom_ui windows associated with a specific workflow flowId.
 * Called when a workflow stops/aborts to clean up blocking promises.
 */
export function closeCustomUiByFlowId(flowId: string): number {
  let closed = 0;
  for (const [id, win] of customUiWindows) {
    const wd = windowData.get(id);
    if (wd?.flowId === flowId) {
      // Resolve any blocking promise
      if (wd.resolve) {
        wd.resolve({ ok: true, action: 'workflow_stopped', data: wd.data || {} });
        wd.resolve = undefined;
      }
      // Close the window
      if (!win.isDestroyed()) {
        try { win.close(); } catch { }
      }
      customUiWindows.delete(id);
      windowData.delete(id);
      closed++;
    }
  }
  return closed;
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
  const navigateTo = typeof args?.navigateTo === 'string' ? args.navigateTo : undefined;
  const pageData = args?.pageData || undefined;
  const newPages = args?.pages || undefined; // Support updating page definitions

  if (!windowId) {
    return { ok: false, error: 'missing_window_id' };
  }

  const existing = customUiWindows.get(windowId);
  if (!existing || existing.isDestroyed()) {
    return { ok: false, error: 'window_not_found' };
  }

  // Update stored data
  const winData = windowData.get(windowId);
  if (winData) {
    if (updates && Object.keys(updates).length > 0) {
      winData.data = { ...winData.data, ...updates };
    }
    if (newPages) {
      winData.pages = { ...(winData.pages || {}), ...newPages };
    }
  }

  // Handle page navigation (pages system)
  if (navigateTo && winData?.pages) {
    winData.currentPage = navigateTo;
    // Send navigation event to renderer
    existing.webContents.send('stuard:page-change', { page: navigateTo, data: pageData });
    ctx.logFn(`update_custom_ui: Navigating to page "${navigateTo}" in "${windowId}"`);
    return { ok: true, navigatedTo: navigateTo };
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

  // Handle pages updates
  if (newPages) {
    updateScript += `
      if (typeof __pages !== 'undefined') {
        const newPages = ${JSON.stringify(newPages)};
        Object.assign(__pages, newPages);
        changed.push('pages');
        
        // If current page was updated, re-render it
        if (typeof __currentPage !== 'undefined' && newPages[__currentPage]) {
          if (typeof navigateTo === 'function') {
            navigateTo(__currentPage); // Re-render current page
          }
        }
      }
    `;
  }

  if (html !== undefined) {
    updateScript += `
      const root = document.querySelector('.stuard-root') || document.querySelector('.root') || document.body;
      if (root) {
        // If we are in pages mode, update the current page's HTML definition too
        if (typeof __pages !== 'undefined' && typeof __currentPage !== 'undefined' && __pages[__currentPage]) {
          __pages[__currentPage].html = ${JSON.stringify(html)};
        }
        
        root.innerHTML = ${JSON.stringify(html)};
        changed.push('html');
        // Re-initialize bindings
        if (typeof __initBindings === 'function') {
          __initBindings();
        }
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

function generateEnhancedCustomUiHtml(options: {
  id: string;
  title: string;
  css: string;
  layout: any;
  data: any;
  rawHtml?: string;
  borderRadius: number;
  flowId: string;
  transparentBg: boolean;
  initScript?: string;
  component?: string;
  pages?: Record<string, any>;
  startPage?: string;
  backgroundType?: string;
  backgroundColor?: string;
  gradient?: any;
  backgroundImage?: any;
  shadow?: { enabled: boolean; color?: string; blur?: number; spread?: number; x?: number; y?: number };
  border?: { enabled: boolean; color?: string; width?: number; style?: string };
  animation?: { open?: string; close?: string; duration?: number; easing?: string };
  contentPadding?: number;
}): string {
  const {
    id,
    title,
    css,
    layout,
    data,
    rawHtml,
    borderRadius = 0,
    flowId,
    transparentBg,
    initScript,
    component,
    pages,
    startPage,
    backgroundType = 'color',
    backgroundColor = 'transparent',
    gradient,
    backgroundImage,
    shadow,
    border,
    animation,
    contentPadding = 0,
  } = options;

  const radiusStyle = borderRadius > 0 ? `border-radius: ${borderRadius}px;` : '';
  const clipStyle = borderRadius > 0 ? `overflow: hidden;` : '';

  // Build background CSS based on type
  let backgroundCss = '';
  let backgroundOverlayCss = '';

  switch (backgroundType) {
    case 'gradient':
      if (gradient && gradient.stops?.length > 0) {
        const sortedStops = [...gradient.stops].sort((a: any, b: any) => a.position - b.position);
        const stopString = sortedStops.map((s: any) => `${s.color} ${s.position}%`).join(', ');

        if (gradient.type === 'linear') {
          backgroundCss = `background: linear-gradient(${gradient.angle || 135}deg, ${stopString});`;
        } else if (gradient.type === 'radial') {
          backgroundCss = `background: radial-gradient(circle at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        } else if (gradient.type === 'conic') {
          backgroundCss = `background: conic-gradient(from 0deg at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        }
      }
      break;

    case 'image':
      if (backgroundImage?.url) {
        const fit = backgroundImage.fit || 'cover';
        const position = backgroundImage.position || 'center';
        const repeat = backgroundImage.repeat || 'no-repeat';
        backgroundCss = `background-image: url('${backgroundImage.url}'); background-size: ${fit}; background-position: ${position}; background-repeat: ${repeat};`;
        if (backgroundImage.opacity !== undefined && backgroundImage.opacity < 1) {
          backgroundOverlayCss = `opacity: ${backgroundImage.opacity};`;
        }
      }
      break;

    case 'color':
    default:
      backgroundCss = `background-color: ${backgroundColor};`;
      break;
  }

  // Build shadow CSS
  const shadowCss = shadow?.enabled
    ? `box-shadow: ${shadow.x || 0}px ${shadow.y || 4}px ${shadow.blur || 12}px ${shadow.spread || 0}px ${shadow.color || '#00000040'};`
    : '';

  // Build border CSS
  const borderCss = border?.enabled
    ? `border: ${border.width || 1}px ${border.style || 'solid'} ${border.color || '#ffffff20'};`
    : '';

  // Build animation CSS
  let animationCss = '';
  let animationKeyframes = '';
  if (animation?.open && animation.open !== 'none') {
    const duration = animation.duration || 300;
    const easing = animation.easing || 'ease-out';

    const keyframeName = `open-${animation.open}`;
    animationCss = `animation: ${keyframeName} ${duration}ms ${easing};`;

    switch (animation.open) {
      case 'fade':
        animationKeyframes = `@keyframes ${keyframeName} { from { opacity: 0; } to { opacity: 1; } }`;
        break;
      case 'slide-up':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'slide-down':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'scale':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }`;
        break;
    }
  }

  const defaultCss = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html {
      background: ${transparentBg ? 'transparent' : (backgroundType === 'color' ? backgroundColor : 'transparent')};
      -webkit-font-smoothing: antialiased;
      height: 100%;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${transparentBg ? 'transparent' : (backgroundType === 'color' ? backgroundColor : 'transparent')};
      color: #1e293b;
      height: 100%;
      font-size: 14px;
      line-height: 1.5;
      ${borderRadius > 0 ? `${radiusStyle} ${clipStyle}` : ''}
      ${animationCss}
    }

    .overlay-container, .root, .stuard-root {
      background: ${transparentBg ? 'transparent' : (backgroundType === 'color' ? backgroundColor : 'transparent')};
      ${radiusStyle}
      ${shadowCss}
      ${borderCss}
      ${clipStyle}
      height: 100%;
      ${contentPadding ? `padding: ${contentPadding}px;` : ''}
    }

    ${backgroundType !== 'color' && !transparentBg ? `
    .stuard-background {
      position: fixed;
      inset: 0;
      ${backgroundCss}
      ${backgroundOverlayCss}
      z-index: -1;
    }` : ''}

    ${transparentBg ? `
      html, body, .dark, .stuard-root, .root, .overlay-container, body > div, body > div > div {
        background: transparent !important;
      }
    ` : ''}

    ${animationKeyframes}

    /* Window dragging: add .drag class to make an area draggable (e.g., title bar) */
    .drag { -webkit-app-region: drag; }
    .drag input, .drag textarea, .drag button, .drag a, .drag select {
      -webkit-app-region: no-drag;
    }

    button, .btn {
      cursor: pointer;
      user-select: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      border: none;
      background: #f1f5f9;
      color: #475569;
      border-radius: 8px;
      font-weight: 500;
      font-size: 13px;
      transition: all 0.15s ease;
      gap: 8px;
    }
    button:hover { background: #e2e8f0; }
    button:active { transform: scale(0.98); }

    .btn-primary {
      background: #4f46e5;
      color: white;
    }
    .btn-primary:hover {
      background: #4338ca;
    }

    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .btn-danger:hover { background: #dc2626; }

    .btn-secondary {
      background: #f1f5f9;
      color: #475569;
    }
    .btn-secondary:hover { background: #e2e8f0; }

    .btn-ghost {
      background: transparent;
      color: #475569;
      border: none;
      box-shadow: none;
    }
    .btn-ghost:hover {
      background: #f1f5f9;
      color: #1e293b;
    }

    .btn-outline {
      background: transparent;
      color: #4f46e5;
      border: 1px solid #4f46e5;
    }
    .btn-outline:hover { background: #eef2ff; }

    button:disabled, .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="url"], input[type="tel"], textarea, select {
      background: white;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      border-radius: 8px;
      padding: 8px 12px;
      width: 100%;
      outline: none;
      font-size: 14px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus, textarea:focus, select:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    input::placeholder, textarea::placeholder { color: #94a3b8; }

    .glass {
      background: rgba(255, 255, 255, 0.7) !important;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(0,0,0,0.08);
    }

    .card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #475569; }

    label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    /* Dark mode support - add class="dark" to body */
    body.dark {
      background: #0f172a;
      color: #e2e8f0;
    }
    body.dark .card {
      background: rgba(30, 41, 59, 0.5);
      border-color: rgba(255,255,255,0.05);
    }
    body.dark input, body.dark textarea, body.dark select {
      background: rgba(15, 23, 42, 0.6);
      border-color: rgba(148, 163, 184, 0.1);
      color: #f1f5f9;
    }
    body.dark h1, body.dark h2, body.dark h3, body.dark h4, body.dark h5, body.dark h6 { color: #f8fafc; }
    body.dark p { color: #cbd5e1; }
    body.dark button { background: #334155; color: white; }
    body.dark button:hover { background: #475569; }
    body.dark .btn-secondary { background: #334155; color: white; }
    body.dark .btn-ghost { color: #94a3b8; }
    body.dark .btn-ghost:hover { background: rgba(255,255,255,0.05); color: #f8fafc; }
    body.dark .glass { background: rgba(15, 23, 42, 0.7) !important; border-color: rgba(255,255,255,0.08); }

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

  const transparentOverride = transparentBg ? `
    html, body, .dark, .stuard-root, .root, .overlay-container, body > div, body > div > div {
      background: transparent !important;
      background-color: transparent !important;
    }
  ` : '';

  // ═══════════════════════════════════════════════════════════════════════════
  // PREACT COMPONENT MODE — the only rendering mode
  // ═══════════════════════════════════════════════════════════════════════════

  // Build the component string. If a raw `component` field is provided, use it.
  // Otherwise, auto-wrap raw HTML into a simple Preact App component.
  let componentCode: string;
  if (component) {
    componentCode = component;
  } else if (rawHtml) {
    // Auto-wrap raw HTML in a Preact component
    const escapedHtml = JSON.stringify(rawHtml);
    componentCode = `function App() {
      const [formData, setFormData] = useState({ ...initialData });
      return html\`<div dangerouslySetInnerHTML=\${{ __html: ${escapedHtml} }} />\`;
    }`;
  } else {
    componentCode = `function App() {
      return html\`<div class="flex items-center justify-center h-full text-slate-400 text-sm">No component defined</div>\`;
    }`;
  }

  // Sanitize component string: fix double-escaping from LLM JSON output
  let sanitizedComponent = componentCode;

    // Detect double-escaping: if the string has literal \n but no real newlines,
    // or has \\" sequences, it's double-escaped
    const hasRealNewlines = sanitizedComponent.includes('\n');
    const hasLiteralBackslashN = sanitizedComponent.includes('\\n');
    const hasLiteralBackslashQuote = sanitizedComponent.includes('\\"');
    const hasLiteralBackslashBackslash = sanitizedComponent.includes('\\\\');

    if (hasLiteralBackslashN || hasLiteralBackslashQuote) {
      // Fix double-escaped sequences
      if (hasLiteralBackslashBackslash) {
        sanitizedComponent = sanitizedComponent.replace(/\\\\/g, '\x00BACKSLASH\x00');
      }
      sanitizedComponent = sanitizedComponent
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
      if (hasLiteralBackslashBackslash) {
        sanitizedComponent = sanitizedComponent.replace(/\x00BACKSLASH\x00/g, '\\');
      }
    }
    const bgOverlay = backgroundType !== 'color' && !transparentBg ? '<div class="stuard-background"></div>' : '';
    return `<!DOCTYPE html>
<html${transparentBg ? ' style="background:transparent!important"' : ''}>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src * data: blob: local-file: file:; media-src * data: blob: local-file: file:; font-src * data:;">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
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
  <\/script>
  <script src="https://unpkg.com/preact@10/dist/preact.umd.js" crossorigin><\/script>
  <script src="https://unpkg.com/preact@10/hooks/dist/hooks.umd.js" crossorigin><\/script>
  <script src="https://unpkg.com/htm@3/dist/htm.umd.js" crossorigin><\/script>
  <style>${defaultCss}\n${css}\n${transparentOverride}\n${animationKeyframes}</style>
</head>
<body${transparentBg ? ' style="background:transparent!important"' : ''}>
  ${bgOverlay}
  <div class="stuard-root"></div>
  <script>
    // ─── Constants ──────────────────────────────────────────────────────
    const CUSTOM_UI_ID = ${JSON.stringify(id)};
    const FLOW_ID = ${JSON.stringify(flowId)};
    window.initialData = ${JSON.stringify(data)};
    const initialData = window.initialData;
    const formData = { ...initialData, flowId: FLOW_ID };
    const hasStuardApi = typeof window.stuard !== 'undefined';

    // ─── CDN Load Check ─────────────────────────────────────────────────
    if (typeof preact === 'undefined' || typeof preactHooks === 'undefined' || typeof htm === 'undefined') {
      const missing = [];
      if (typeof preact === 'undefined') missing.push('preact');
      if (typeof preactHooks === 'undefined') missing.push('preact/hooks');
      if (typeof htm === 'undefined') missing.push('htm');
      document.querySelector('.stuard-root').innerHTML =
        '<div style="padding:24px;color:#f87171;font-family:system-ui">' +
        '<h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">Failed to load UI libraries</h2>' +
        '<p style="color:#94a3b8;font-size:13px">Could not load: ' + missing.join(', ') + ' from CDN.</p>' +
        '<p style="color:#94a3b8;font-size:13px;margin-top:8px">Check your internet connection and try again.</p></div>';
      throw new Error('CDN libraries not loaded: ' + missing.join(', '));
    }

    // ─── Preact Runtime ─────────────────────────────────────────────────
    const { h, render: preactRender, Fragment } = preact;
    const { useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, useLayoutEffect } = preactHooks;
    const html = htm.bind(h);

    // ─── Variable Subscription ──────────────────────────────────────────
    window.__varListeners = {};
    if (hasStuardApi) {
      window.stuard.subscribeVars(['*']);
      window.stuard.onVarUpdate(({ name, shortName, value }) => {
        const matchNames = [name, shortName];
        for (const mn of matchNames) {
          if (window.__varListeners[mn]) {
            window.__varListeners[mn].forEach(cb => {
              try { cb(value); } catch(e) { console.error('[useVar] listener error:', e); }
            });
          }
        }
      });
    }

    // ─── useVar Hook ────────────────────────────────────────────────────
    // React-like hook bridging Preact state to workflow variables.
    // Usage: const [count, setCount] = useVar('counter', 0);
    function useVar(varName, defaultValue) {
      const [value, _setValue] = useState(defaultValue);

      useEffect(() => {
        if (!hasStuardApi) return;

        window.stuard.getVar(varName).then(res => {
          if (res.ok && res.value !== undefined && res.value !== null) {
            _setValue(res.value);
          } else if (defaultValue !== undefined) {
            window.stuard.setVar(varName, defaultValue);
          }
        });

        const handler = (newVal) => _setValue(newVal);
        if (!window.__varListeners[varName]) window.__varListeners[varName] = [];
        window.__varListeners[varName].push(handler);

        return () => {
          const arr = window.__varListeners[varName];
          if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
          }
        };
      }, []);

      const setVar = (newVal) => {
        _setValue(newVal);
        if (hasStuardApi) window.stuard.setVar(varName, newVal);
      };

      return [value, setVar];
    }

    // ─── useStream Hook ──────────────────────────────────────────────────
    // Subscribe to a workflow stream and get chunks reactively.
    // For video: const { frame, index, done } = useStream(streamId);
    //            return html\`<img src=\${frame} />\`;
    // For text:  const { text, fullText, done } = useStream(streamId);
    function useStream(streamId) {
      const [chunk, setChunk] = useState(null);
      const [index, setIndex] = useState(-1);
      const [done, setDone] = useState(false);
      const [fullText, setFullText] = useState('');
      const subRef = useRef(null);

      useEffect(() => {
        if (!hasStuardApi || !streamId) return;

        window.stuard.subscribeStream(streamId, (evt) => {
          if (evt.closed || evt.index === -1) {
            setDone(true);
            return;
          }
          setChunk(evt.data);
          setIndex(evt.index);
          if (typeof evt.data === 'string') {
            setFullText(prev => prev + evt.data);
          }
        }).then(res => {
          if (res.ok) subRef.current = res.subscriberId;
        });

        return () => {
          if (subRef.current) {
            window.stuard.unsubscribeStream(streamId, subRef.current);
          }
        };
      }, [streamId]);

      return {
        chunk,       // latest raw chunk data (could be base64 image, text, JSON)
        frame: chunk, // alias for video/image use — use as <img src={frame} />
        text: typeof chunk === 'string' ? chunk : null,
        fullText,    // accumulated text for text streams
        index,       // chunk index (0-based)
        done,        // true when stream closes
      };
    }

    // ─── User Component ─────────────────────────────────────────────────
    try {
      ${sanitizedComponent}
    } catch (__compDefError) {
      console.error('[stuard] Component definition error:', __compDefError);
      function App() {
        return html\`<div class="p-6 space-y-3">
          <h2 class="text-red-400 font-bold text-lg">Component Error</h2>
          <pre class="text-xs text-red-300 bg-red-900/30 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap">\${String(__compDefError?.message || __compDefError)}</pre>
          <p class="text-slate-400 text-sm">Check the component code for syntax errors.</p>
          <button onClick=\${() => stuard.close()} class="btn-secondary mt-2">Close</button>
        </div>\`;
      }
    }

    // ─── Render ─────────────────────────────────────────────────────────
    try {
      preactRender(
        html\`<\${typeof App !== 'undefined' ? App : () => html\`<div class="p-4 text-red-400">No App component defined. Your component must define a function named App.</div>\`} />\`,
        document.querySelector('.stuard-root')
      );
    } catch (__renderError) {
      console.error('[stuard] Render error:', __renderError);
      document.querySelector('.stuard-root').innerHTML = '<div style="padding:24px;color:#f87171;font-family:monospace"><h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">Render Error</h2><pre style="font-size:12px;background:rgba(127,29,29,0.3);padding:12px;border-radius:8px;white-space:pre-wrap;overflow:auto;max-height:300px">' + String(__renderError?.message || __renderError).replace(/</g,'&lt;') + '</pre><p style="color:#94a3b8;font-size:13px;margin-top:12px">The component defined an App function but it failed to render.</p></div>';
    }
  <\/script>
</body>
</html>`;
}
// Legacy mode removed — Preact is the only rendering path
// END OF FILE MARKER
