import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, screen } from 'electron';
import { pathToFileURL } from 'url';
import type { RouterContext } from './tool-router';

export const customUiWindows = new Map<string, BrowserWindow>();

let audioPlayerWindow: BrowserWindow | null = null;
let audioPlayerReady: Promise<BrowserWindow> | null = null;

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
        (function(){
          window.__stuardPlayAudio = async function(url){
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
        })();
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

    win.webContents.executeJavaScript(js, true).catch(() => {});
    return { ok: true, status: 'playing', path: filePath, method: 'electron' };
  } catch (e: any) {
    ctx.logFn(`play_audio failed: ${e?.message || 'unknown'}`);
    return { ok: false, error: String(e?.message || 'play_audio_failed') };
  }
}

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
  
  // Ensure data is an object
  let safeData = typeof data === 'string' ? {} : (data || {});
  if (typeof data === 'string') {
    try { safeData = JSON.parse(data); } catch (e) { 
      ctx.logFn(`custom_ui: Warning - failed to parse 'data' argument as JSON: ${e}`);
    }
  }

  // Auto-merge non-reserved arguments into data
  // This allows passing 'preview' as a top-level arg to avoid JSON string interpolation issues
  const reservedArgs = new Set([
    'id', 'title', 'window', 'width', 'height', 'blocking', 'timeoutMs', 
    'css', 'layout', 'content', 'html', 'keepOpen', 'forceNew', 'flowId', 'data'
  ]);
  
  for (const [key, val] of Object.entries(args || {})) {
    if (!reservedArgs.has(key)) {
      safeData[key] = val;
    }
  }
  
  ctx.logFn(`custom_ui: data keys=[${Object.keys(safeData).join(', ')}]`);
  if (safeData.preview) ctx.logFn(`custom_ui: data.preview="${String(safeData.preview).slice(0, 50)}..."`);
  
  if (rawHtml) {
    const previewMatch = rawHtml.match(/\{\{\s*preview\s*\}\}/);
    ctx.logFn(`custom_ui: HTML contains {{preview}} tag? ${!!previewMatch}`);
  }

  const { x, y } = calculatePosition(
    windowCfg.position,
    width,
    height,
    windowCfg.x,
    windowCfg.y,
    margin
  );

  if (existing && !existing.isDestroyed() && !forceNew) {
    const transparent = !!windowCfg.transparent || frameless || borderRadius > 0 || transparentBg;

    try {
      existing.setBackgroundColor('#00000000');
      existing.setHasShadow(windowCfg.shadow !== false && !transparentBg);
    } catch {}

    const htmlContent = generateCustomUiHtml(id, title, css, layout, safeData, rawHtml, borderRadius, flowId, transparentBg);
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

    if (!blocking) {
      return { ok: true, action: 'updated', data: safeData };
    }
    return waitForUiAction(existing, id, safeData, timeoutMs, keepOpen, ctx, flowId);
  }

  if (existing && !existing.isDestroyed()) {
    try {
      existing.close();
    } catch {}
    customUiWindows.delete(id);
  }

  const transparent = !!windowCfg.transparent || frameless || borderRadius > 0 || transparentBg;
  const isAlwaysOnTop = windowCfg.alwaysOnTop !== false;
  // Hide from taskbar when always on top (unless explicitly set to show)
  const shouldSkipTaskbar = windowCfg.skipTaskbar === true || (isAlwaysOnTop && windowCfg.skipTaskbar !== false);

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
      sandbox: false,
    },
  });

  if (frameless) win.setMenu(null);

  // Hide from alt-tab on Windows when always on top
  if (isAlwaysOnTop) {
    try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch { }
  }
  customUiWindows.set(id, win);
  ctx.logFn(`custom_ui: Stored window "${id}" in map (total: ${customUiWindows.size})`);

  const htmlContent = generateCustomUiHtml(id, title, css, layout, safeData, rawHtml, borderRadius, flowId, transparentBg);
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
    let pollInterval: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (pollInterval) clearInterval(pollInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const doResolve = (result: any, shouldClose: boolean = true) => {
      if (resolved) return;
      resolved = true;
      cleanup();

      if (shouldClose && !keepOpen && !win.isDestroyed()) {
        try {
          win.close();
        } catch {}
        customUiWindows.delete(id);
        ctx.logFn(`custom_ui: Closed and removed window "${id}" (total: ${customUiWindows.size})`);
      } else if (!win.isDestroyed()) {
        try {
          win.setTitle(win.getTitle().split(':')[0] || 'Stuard UI');
        } catch {}
      }

      resolve(result);
    };

    pollInterval = setInterval(() => {
      if (win.isDestroyed()) {
        doResolve({ ok: false, action: 'closed', data }, false);
        customUiWindows.delete(id);
        return;
      }
      try {
        const currentTitle = win.getTitle();

        if (currentTitle.startsWith('PICKER:')) {
          const parts = currentTitle.slice(7).split(':');
          const pickerType = parts[0] || 'pick_file';
          const targetField = parts[1] || 'filePath';
          const filtersStr = parts[2] || '';
          const dialogTitle = parts[3] || 'Select';

          try {
            win.setTitle('Stuard UI');
          } catch {}

          (async () => {
            const { dialog } = require('electron');
            let filters = [{ name: 'All Files', extensions: ['*'] }];
            if (filtersStr) {
              try {
                filters = JSON.parse(filtersStr);
              } catch {}
            }

            let result: any;
            if (pickerType === 'pick_file') {
              result = await dialog.showOpenDialog({ title: dialogTitle, properties: ['openFile'], filters });
            } else if (pickerType === 'pick_files') {
              result = await dialog.showOpenDialog({
                title: dialogTitle,
                properties: ['openFile', 'multiSelections'],
                filters,
              });
            } else if (pickerType === 'pick_folder') {
              result = await dialog.showOpenDialog({ title: dialogTitle, properties: ['openDirectory'] });
            } else if (pickerType === 'pick_save_path') {
              result = await dialog.showSaveDialog({ title: dialogTitle, filters });
            }

            if (result && !result.canceled) {
              const selectedPath = result.filePath || (result.filePaths && result.filePaths[0]) || '';
              const allPaths = result.filePaths || [selectedPath];

              if (!win.isDestroyed()) {
                const updateScript = `
                  (function() {
                    const targetField = ${JSON.stringify(targetField)};
                    const selectedPath = ${JSON.stringify(selectedPath)};
                    const allPaths = ${JSON.stringify(allPaths)};

                    if (typeof formData !== 'undefined') {
                      formData[targetField] = selectedPath;
                      formData[targetField + '_all'] = allPaths;
                    }

                    const input = document.querySelector('[data-bind="' + targetField + '"]');
                    if (input) {
                      input.value = selectedPath;
                      input.dispatchEvent(new Event('input', { bubbles: true }));
                    }

                    return { updated: targetField, path: selectedPath };
                  })();
                `;
                try {
                  await win.webContents.executeJavaScript(updateScript);
                  ctx.logFn('custom_ui: File picker updated field "' + targetField + '" with: ' + selectedPath);
                } catch (e) {
                  console.error('Failed to inject picker result:', e);
                }
              }
            }
          })();

          return;
        }

        if (currentTitle.startsWith('ACTION:')) {
          const rest = currentTitle.slice(7);
          const colonIdx = rest.indexOf(':');
          const actionName = colonIdx > 0 ? rest.slice(0, colonIdx) : rest;
          const jsonStr = colonIdx > 0 ? rest.slice(colonIdx + 1) : '{}';

          if (actionName === 'stop_workflow' || actionName === 'stopworkflow' || actionName === 'stop') {
            try {
              const { workflows_stop } = require('./workflows/workflows');
              const stopFlowId = flowId || JSON.parse(jsonStr || '{}').flowId;
              if (stopFlowId) {
                workflows_stop(stopFlowId);
                ctx.logFn(`custom_ui: Stopped workflow ${stopFlowId}`);
              }
            } catch (e: any) {
              ctx.logFn(`custom_ui: Failed to stop workflow: ${e?.message}`);
            }
            doResolve({ ok: true, action: 'stop_workflow', data: { flowId } }, true);
            return;
          }

          try {
            const submittedData = JSON.parse(jsonStr);
            const isCloseAction = actionName === 'close' || actionName === 'exit' || actionName === 'cancel';
            // Treat user-initiated close/cancel as success so the workflow can handle the logic branch
            doResolve({ ok: true, action: actionName, data: submittedData }, !keepOpen);
          } catch {
            doResolve({ ok: true, action: actionName, data }, !keepOpen);
          }
          return;
        }

        if (currentTitle.startsWith('SUBMIT:')) {
          const jsonStr = currentTitle.slice(7);
          try {
            const submittedData = JSON.parse(jsonStr);
            doResolve({ ok: true, action: 'submit', data: submittedData }, !keepOpen);
          } catch {
            doResolve({ ok: true, action: 'submit', data }, !keepOpen);
          }
        } else if (currentTitle.startsWith('CLOSE:')) {
          // Explicit window close button (X)
          doResolve({ ok: true, action: 'closed', data }, true);
        }
      } catch {}
    }, 100);

    win.on('closed', () => {
      // If closed by user externally (Alt+F4 etc)
      doResolve({ ok: true, action: 'closed', data }, false);
      customUiWindows.delete(id);
    });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        doResolve({ ok: false, action: 'timeout', data }, !keepOpen);
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
    } catch {}
  }
  customUiWindows.delete(id);
  return { ok: true };
}

export async function execUpdateCustomUi(args: any, ctx: RouterContext): Promise<any> {
  const windowId = String(args?.id || '');
  const updates = args?.data || args?.update || {};
  const html = typeof args?.html === 'string' ? args.html : undefined;
  const css = typeof args?.css === 'string' ? args.css : undefined;

  if (!windowId) {
    return { ok: false, error: 'missing_window_id' };
  }

  const windowIds = Array.from(customUiWindows.keys());
  ctx.logFn(`update_custom_ui: Looking for "${windowId}", available: [${windowIds.join(', ')}]`);

  const existing = customUiWindows.get(windowId);
  if (!existing || existing.isDestroyed()) {
    return { ok: false, error: 'window_not_found' };
  }

  let updateScript = `(function() {
    const updates = ${JSON.stringify(updates)};
    let changed = [];
    
    // Update data bindings
    for (const [key, value] of Object.entries(updates)) {
      const bindEl = document.querySelector('[data-bind="' + key + '"]');
      if (bindEl) {
        if (bindEl.tagName === 'INPUT' || bindEl.tagName === 'TEXTAREA') {
          bindEl.value = value;
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

  // Append HTML update logic if provided
  if (html !== undefined) {
    updateScript += `
      // Update HTML content
      const root = document.querySelector('.stuard-root') || document.querySelector('.root') || document.body;
      if (root) {
        root.innerHTML = ${JSON.stringify(html)};
        changed.push('html');
        
        // Re-initialize any scripts or bindings if needed
        // We need to re-attach event listeners since innerHTML nukes them
        // This is a basic re-init for data-action buttons
        setTimeout(() => {
            document.querySelectorAll('[data-action]').forEach(el => {
              const actionName = el.getAttribute('data-action');
              const targetField = el.getAttribute('data-target') || el.getAttribute('data-bind');
              
              const pickerActions = ['pick_file', 'pick_files', 'pick_folder', 'pick_save_path'];
              if (pickerActions.includes(actionName)) {
                el.addEventListener('click', () => {
                  const filters = el.getAttribute('data-filters');
                  const title = el.getAttribute('data-title') || el.textContent || 'Select';
                  document.title = 'PICKER:' + actionName + ':' + (targetField || '') + ':' + (filters || '') + ':' + title;
                });
              } else {
                el.addEventListener('click', () => {
                  // Re-capture formData in case it changed
                  const currentData = (typeof formData !== 'undefined') ? formData : {};
                  document.title = 'ACTION:' + actionName + ':' + JSON.stringify(currentData);
                });
              }
            });
            
            // Re-attach listeners for data-bind inputs
            document.querySelectorAll('[data-bind]').forEach(el => {
              const key = el.getAttribute('data-bind');
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                // Initialize formData if needed
                if (typeof formData !== 'undefined') {
                   if (formData[key] === undefined) formData[key] = el.value || '';
                }
                el.addEventListener('input', (e) => { 
                  if (typeof formData !== 'undefined') formData[key] = e.target.value; 
                });
                
                // Also re-attach Enter key for submit
                el.addEventListener('keypress', (e) => {
                  if (e.key === 'Enter') { 
                    const currentData = (typeof formData !== 'undefined') ? formData : {};
                    document.title = 'ACTION:submit:' + JSON.stringify(currentData); 
                  }
                });
              }
            });
            
        }, 50);
      }
    `;
  }

  // Append CSS update logic if provided
  if (css !== undefined) {
    updateScript += `
      // Update CSS
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

function generateCustomUiHtml(
  id: string,
  title: string,
  css: string,
  layout: any,
  data: any,
  rawHtml?: string,
  borderRadius: number = 0,
  flowId: string = '',
  transparentBg: boolean = false
): string {
  const rootBg = 'transparent';

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
      ${borderRadius > 0 ? `
        ${radiusStyle}
        ${clipStyle}
      ` : ''}
    }
    
    .overlay-container, .root, .stuard-root {
      background: ${rootBg};
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
    .glass-light { 
      background: rgba(255, 255, 255, 0.05) !important; 
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    
    .card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 16px;
    }
    
    .solid-dark { background: #0f172a !important; }
    .solid-light { background: #334155 !important; }
    .no-bg { background: transparent !important; }
    
    /* Typography */
    h1, h2, h3, h4, h5, h6 { color: #f8fafc; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #cbd5e1; }
    
    /* Scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { 
      background: rgba(148, 163, 184, 0.2); 
      border-radius: 3px; 
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.4); }
    ::-webkit-scrollbar-corner { background: transparent; }
    
    .scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { border-radius: 2px; }
    
    /* Animation Utils */
    .fade-in { animation: fadeIn 0.3s ease-out; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    
    .slide-up { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `;

  const interpolatedHtml = rawHtml
    ? rawHtml.replace(/\{\{\s*([\w\.]+)\s*\}\}/g, (match: string, k: string) => {
        // Support dot notation server-side
        const val = k.split('.').reduce((o, key) => (o || {})[key], data);
        return val !== undefined ? escapeHtml(String(val)) : match;
      })
    : null;
  const layoutHtml = interpolatedHtml || renderLayout(layout, data);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
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
    
    // Client-side fallback: Traverse text nodes to replace {{key}} tags
    // This handles cases where server-side regex might have missed something
    function interpolateTextNodes(node) {
      if (node.nodeType === 3) { // Text node
        const text = node.nodeValue;
        if (text && text.includes('{{')) {
          const newText = text.replace(/\{\{\s*([\w\.]+)\s*\}\}/g, (match, key) => {
             // Handle dot notation if needed
             const val = key.split('.').reduce((o, k) => (o || {})[k], initialData);
             return val !== undefined ? val : match;
          });
          if (newText !== text) {
            node.nodeValue = newText;
          }
        }
      } else {
        node.childNodes.forEach(child => interpolateTextNodes(child));
      }
    }
    interpolateTextNodes(document.body);

    document.querySelectorAll('[data-bind]').forEach(el => {
      const key = el.getAttribute('data-bind');
      const val = formData[key];
      
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        // If formData has a value, use it; otherwise preserve the existing HTML value
        if (val !== undefined && val !== '') {
          el.value = val;
        } else {
          // Initialize formData from the HTML value so it gets submitted correctly
          formData[key] = el.value || '';
        }
        el.addEventListener('input', (e) => { formData[key] = e.target.value; });
      } else {
        // For non-input elements (div, span, etc.), set textContent if data exists
        if (val !== undefined) {
          el.textContent = val;
        }
      }
    });
    
    document.querySelectorAll('[data-action]').forEach(el => {
      const actionName = el.getAttribute('data-action');
      const targetField = el.getAttribute('data-target') || el.getAttribute('data-bind');
      
      const pickerActions = ['pick_file', 'pick_files', 'pick_folder', 'pick_save_path'];
      if (pickerActions.includes(actionName)) {
        el.addEventListener('click', () => {
          const filters = el.getAttribute('data-filters');
          const title = el.getAttribute('data-title') || el.textContent || 'Select';
          document.title = 'PICKER:' + actionName + ':' + (targetField || '') + ':' + (filters || '') + ':' + title;
        });
      } else {
        el.addEventListener('click', () => {
          document.title = 'ACTION:' + actionName + ':' + JSON.stringify(formData);
        });
      }
    });
    
    document.querySelectorAll('input[data-bind]').forEach(el => {
      el.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { document.title = 'ACTION:submit:' + JSON.stringify(formData); }
      });
    });
    
    document.body.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || 
          e.target.tagName === 'TEXTAREA' || e.target.tagName === 'A' ||
          e.target.hasAttribute('data-action') || e.target.hasAttribute('data-bind')) {
        e.stopPropagation();
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      children = node.children.replace(/\{\{(\w+)\}\}/g, (_: any, k: string) => escapeHtml(String(data[k] || '')));
    } else if (Array.isArray(node.children)) {
      children = node.children.map((c: any) => renderLayout(c, data)).join('');
    } else {
      children = renderLayout(node.children, data);
    }
  }

  if (type === 'input') {
    const value = node.bind && data[node.bind] ? ` value="${escapeHtml(String(data[node.bind]))}"` : '';
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
        ? content.replace(/\{\{(\w+)\}\}/g, (_: any, k: string) => escapeHtml(String(data[k] || '')))
        : renderLayout(content, data);
    return `<span${className}${style}>${text}</span>`;
  }

  return `<${type}${className}${style}${bind}${action}>${children}</${type}>`;
}
