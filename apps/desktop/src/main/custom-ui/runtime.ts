import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import type { RouterContext } from '../tool-router';
import { customUiWindows, windowData } from './state';
import { calculatePosition } from './position';
import { getPreloadPath } from './preload';
import { generateEnhancedCustomUiHtml } from './html';
import { setVariable, type VariableValue } from '../workflow-variables';
import { getScreenCaptureInvisible } from '../windows/window';

// Temp directory for custom UI HTML files (allows file:// loading so local images work)
const CUSTOM_UI_TMP_DIR = path.join(os.tmpdir(), 'stuard_custom_ui');
fs.mkdirSync(CUSTOM_UI_TMP_DIR, { recursive: true });

function writeTempHtml(id: string, html: string): string {
  const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(CUSTOM_UI_TMP_DIR, `${safeName}.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  return filePath;
}

function cleanupTempHtml(id: string): void {
  try {
    const safeName = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(CUSTOM_UI_TMP_DIR, `${safeName}.html`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
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
  const frameless = windowCfg.frameless === true || windowCfg.frameless === 'true';
  const wantsTransparentWindow = windowCfg.transparent === true || windowCfg.transparent === 'true';

  // === ENHANCED WINDOW PROPERTIES ===
  const backgroundType = windowCfg.backgroundType || 'color';
  const backgroundColor = windowCfg.backgroundColor || 'transparent';
  const gradient = windowCfg.gradient;
  const backgroundImage = windowCfg.backgroundImage;
  const translucent = windowCfg.translucent || undefined;
  const shadow = windowCfg.shadow || { enabled: false };
  const border = windowCfg.border || { enabled: false };
  const animation = windowCfg.animation;
  const contentPadding = windowCfg.contentPadding || 0;
  const overflow = windowCfg.overflow || '';
  const invisible = windowCfg.invisible === true || windowCfg.invisible === 'true';
  const isTranslucent = backgroundType === 'translucent';

  const transparentBg =
    windowCfg.noBackground === true ||
    windowCfg.noBackground === 'true' ||
    windowCfg.transparentBg === true ||
    windowCfg.transparentBg === 'true' ||
    wantsTransparentWindow ||
    (rawHtml && wantsTransparentWindow) ||
    isTranslucent;

  const flowId = args?.flowId || (ctx as any)?.flowId || '';

  // Pages system - multi-page SPA navigation
  const pages = args?.pages || undefined; // Record<string, { html?, layout?, css?, script? }>
  const startPage = args?.startPage || (pages ? Object.keys(pages)[0] : undefined);

  const existing = customUiWindows.get(id);
  const forceNew = args?.forceNew === true;
  ctx.logFn(
    `custom_ui: id="${id}", existing=${!!existing}, destroyed=${existing?.isDestroyed()}, blocking=${blocking}${
      pages ? `, pages=[${Object.keys(pages).join(',')}], startPage=${startPage}` : ''
    }`
  );

  // Parse data if string
  let safeData = typeof data === 'string' ? {} : data || {};
  if (typeof data === 'string') {
    try {
      safeData = JSON.parse(data);
    } catch (e) {
      ctx.logFn(`custom_ui: Warning - failed to parse 'data' argument as JSON: ${e}`);
    }
  }

  // Auto-merge non-reserved arguments into data
  const reservedArgs = new Set([
    'id',
    'title',
    'window',
    'width',
    'height',
    'blocking',
    'timeoutMs',
    'css',
    'layout',
    'content',
    'html',
    'script',
    'component',
    'keepOpen',
    'forceNew',
    'flowId',
    'data',
    'pages',
    'startPage',
  ]);

  for (const [key, val] of Object.entries(args || {})) {
    if (!reservedArgs.has(key)) {
      safeData[key] = val;
    }
  }

  ctx.logFn(`custom_ui: data keys=[${Object.keys(safeData).join(', ')}]`);

  // Debug: log actual data values to diagnose template resolution
  for (const [k, v] of Object.entries(safeData)) {
    const vs = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v)?.slice(0, 80);
    ctx.logFn(`custom_ui: data.${k} = ${vs}`);
  }

  const { x, y } = calculatePosition(windowCfg.position, width, height, windowCfg.x, windowCfg.y, margin);

  // Handle existing window — push data via variable system (no page reload)
  if (existing && !existing.isDestroyed() && !forceNew) {
    // Update window geometry only if changed
    const [currentWidth, currentHeight] = existing.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      existing.setSize(width, height);
    }
    existing.setTitle(title);

    // Push each data key as a workflow variable so useVar hooks update reactively.
    // This avoids regenerating HTML and reloading the page — React just re-renders.
    if (safeData && typeof safeData === 'object') {
      for (const [key, value] of Object.entries(safeData)) {
        setVariable(key, value as VariableValue);
      }
    }

    // Also send a data-update IPC as fallback for onDataUpdate listeners
    if (!existing.isDestroyed()) {
      existing.webContents.send('stuard:data-update', safeData);
    }

    if (!existing.isVisible()) {
      existing.show();
    }
    existing.focus();

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
    } catch {}
    customUiWindows.delete(id);
    windowData.delete(id);
  }

  // Only enable Electron-level transparency when the window is frameless.
  // On Windows, transparent + framed windows don't render CSS backgrounds correctly.
  // borderRadius still applies visually via CSS overflow:hidden inside the frame.
  const transparent = frameless && (!!windowCfg.transparent || borderRadius > 0 || transparentBg || isTranslucent);
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
    backgroundColor: (transparent || isTranslucent) ? '#00000000' : (backgroundColor || '#1a1a2e'),
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

  // Apply screen capture invisibility (per-window property OR global setting)
  if (invisible || getScreenCaptureInvisible()) {
    try { win.setContentProtection(true); } catch {}
  }

  if (isAlwaysOnTop) {
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu');
    } catch {}
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
    translucent,
    shadow,
    border,
    animation,
    contentPadding,
    overflow,
    draggable: windowCfg.draggable !== false,
  });

  const tmpHtmlPath = writeTempHtml(id, htmlContent);
  try {
    await win.loadFile(tmpHtmlPath);
  } catch (loadErr: any) {
    ctx.logFn(`custom_ui: loadFile failed for "${id}": ${loadErr?.message || loadErr}`);
    // Retry once with a small delay (Windows file system latency)
    await new Promise(r => setTimeout(r, 100));
    try {
      await win.loadFile(tmpHtmlPath);
    } catch (retryErr: any) {
      ctx.logFn(`custom_ui: loadFile retry also failed: ${retryErr?.message || retryErr}`);
      if (!win.isDestroyed()) { try { win.close(); } catch {} }
      customUiWindows.delete(id);
      windowData.delete(id);
      return { ok: false, error: `Failed to load UI: ${retryErr?.message || 'ERR_FAILED'}` };
    }
  }
  win.show();
  win.focus();

  // Legacy fallback: listen for title-based submit/close signals from runtime script
  // (used when preload is unavailable)
  win.webContents.on('page-title-updated', (_event, newTitle) => {
    const wd = windowData.get(id);
    if (!wd?.resolve) return;
    if (newTitle.startsWith('__stuard_submit__')) {
      try {
        const submitData = JSON.parse(newTitle.slice('__stuard_submit__'.length));
        Object.assign(safeData, submitData);
        if (wd) wd.data = safeData;
      } catch {}
      wd.resolve({ ok: true, action: 'submitted', data: safeData });
      wd.resolve = undefined;
    } else if (newTitle.startsWith('__stuard_close__')) {
      try {
        const closeData = JSON.parse(newTitle.slice('__stuard_close__'.length));
        Object.assign(safeData, closeData);
        if (wd) wd.data = safeData;
      } catch {}
      wd.resolve({ ok: true, action: 'closed', data: safeData });
      wd.resolve = undefined;
    }
  });

  ctx.logFn(
    `custom_ui: Showing "${title}" (${width}x${height}) with ${backgroundType} background${
      transparentBg ? ' [transparent]' : ''
    }`
  );

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
  return new Promise(resolve => {
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
      cleanupTempHtml(id);
    });

    // Timeout
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const existingWinData = windowData.get(id);
          if (existingWinData) existingWinData.resolve = undefined;

          if (!keepOpen && !win.isDestroyed()) {
            try {
              win.close();
            } catch {}
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
        try {
          win.close();
        } catch {}
      }
      customUiWindows.delete(id);
      windowData.delete(id);
      cleanupTempHtml(id);
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
    } catch {}
  }
  customUiWindows.delete(id);
  windowData.delete(id);
  cleanupTempHtml(id);
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
