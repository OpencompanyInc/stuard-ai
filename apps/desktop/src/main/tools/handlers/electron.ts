import { clipboard, Notification, shell } from 'electron';
import { execCloseCustomUi as _execCloseCustomUi, execCustomUi as _execCustomUi, execUpdateCustomUi as _execUpdateCustomUi, execPlayAudio as _execPlayAudio, customUiWindows, sendEventToCustomUi, initCustomUiIpc } from '../../custom-ui';
import { getNotificationWindow, openNotificationWindow } from '../../windows';
import { pathToFileURL } from 'node:url';
import { RouterContext } from '../types';

export const execCustomUi = _execCustomUi;
export const execCloseCustomUi = _execCloseCustomUi;
export const execUpdateCustomUi = _execUpdateCustomUi;
export const execPlayAudio = _execPlayAudio;
export { initCustomUiIpc };

/**
 * Send an event to a custom UI window from a workflow
 */
export async function execSendUiEvent(args: any, ctx: RouterContext): Promise<any> {
  const windowId = String(args?.id || args?.windowId || '');
  const eventName = String(args?.event || args?.eventName || '');
  const eventData = args?.data || {};

  if (!windowId) {
    return { ok: false, error: 'missing_window_id' };
  }
  if (!eventName) {
    return { ok: false, error: 'missing_event_name' };
  }

  const success = sendEventToCustomUi(windowId, eventName, eventData);
  if (!success) {
    return { ok: false, error: 'window_not_found_or_destroyed' };
  }

  ctx.logFn(`send_ui_event: Sent "${eventName}" to window "${windowId}"`);
  return { ok: true, event: eventName, windowId };
}

/**
 * Run JavaScript in a custom UI window
 */
export async function execRunUiScript(args: any, ctx: RouterContext): Promise<any> {
  const windowId = String(args?.id || args?.windowId || '');
  const script = String(args?.script || args?.code || '');
  const context = args?.context || {};

  if (!windowId) {
    return { ok: false, error: 'missing_window_id' };
  }
  if (!script) {
    return { ok: false, error: 'missing_script' };
  }

  const win = customUiWindows.get(windowId);
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'window_not_found' };
  }

  try {
    const contextStr = Object.keys(context).length > 0
      ? `const __ctx = ${JSON.stringify(context)};`
      : '';

    const wrappedScript = `
      (async () => {
        ${contextStr}
        ${script}
      })()
    `;

    const result = await win.webContents.executeJavaScript(wrappedScript, true);
    ctx.logFn(`run_ui_script: Executed script in window "${windowId}"`);
    return { ok: true, result };
  } catch (e: any) {
    ctx.logFn(`run_ui_script: Error: ${e?.message}`);
    return { ok: false, error: e?.message || 'script_execution_failed' };
  }
}

/**
 * Get list of open custom UI windows
 */
export async function execListCustomUiWindows(args: any, ctx: RouterContext): Promise<any> {
  const windows: Array<{ id: string; title: string; isDestroyed: boolean }> = [];

  for (const [id, win] of customUiWindows) {
    windows.push({
      id,
      title: win.isDestroyed() ? '(destroyed)' : win.getTitle(),
      isDestroyed: win.isDestroyed(),
    });
  }

  return { ok: true, windows, count: windows.length };
}

export async function execGetClipboardContent(args: any, ctx: RouterContext): Promise<any> {
  try {
    const text = clipboard.readText();
    ctx.logFn(`get_clipboard_content: Read ${text ? text.length : 0} chars: "${(text || '').slice(0, 50).replace(/\n/g, '\\n')}..."`);
    return { ok: true, text };
  } catch (e: any) {
    ctx.logFn(`get_clipboard_content: Failed: ${e?.message}`);
    return { ok: false, error: e?.message || 'clipboard_read_failed' };
  }
}

export async function execSetClipboardContent(args: any, ctx: RouterContext): Promise<any> {
  try {
    const text = String(args?.text || '');
    clipboard.writeText(text);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'clipboard_write_failed' };
  }
}

export async function execLog(args: any, ctx: RouterContext): Promise<any> {
  const msg = String(args?.message || args?.msg || '');
  ctx.logFn(msg);
  return { ok: true, logged: msg };
}

export async function execWait(args: any, ctx: RouterContext): Promise<any> {
  const ms = Math.max(
    0,
    Number(
      args?.ms ??
      args?.milliseconds ??
      args?.delayMs ??
      args?.duration ??
      args?.durationMs ??
      0
    )
  );
  if (ms > 0) await new Promise(r => setTimeout(r, ms));
  return { ok: true, waitedMs: ms };
}

export async function execEnd(args: any, ctx: RouterContext): Promise<any> {
  // End tool - signals workflow termination
  return { ok: true, action: 'end', terminated: true };
}

export async function execReturnValue(args: any, ctx: RouterContext): Promise<any> {
  const value = (args && typeof args === 'object' && 'value' in args)
    ? (args as any).value
    : args;
  const success = args?.success !== false; // Default to true
  const message = args?.message || '';
  return { ok: true, action: 'return', terminated: true, value, success, message };
}

type PendingNotificationResponse = {
  resolve: (value: any) => void;
  timer?: NodeJS.Timeout;
};

const pendingNotificationResponses = new Map<string, PendingNotificationResponse>();

function normalizeNotificationVariant(value: any): 'info' | 'success' | 'warning' | 'error' | 'neutral' {
  const raw = String(value || 'info').trim().toLowerCase();
  if (raw === 'success' || raw === 'warning' || raw === 'error' || raw === 'neutral') {
    return raw;
  }
  return 'info';
}

function normalizeNotificationImage(value: any): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (/^(https?:|data:|file:)/i.test(raw)) return raw;
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    try {
      return pathToFileURL(raw).toString();
    } catch {
      return raw;
    }
  }
  return raw;
}

function deliverNotification(config: Record<string, any>): boolean {
  openNotificationWindow();
  const notificationWin = getNotificationWindow();
  if (notificationWin && !notificationWin.isDestroyed()) {
    const send = () => {
      try {
        notificationWin.webContents.send('notification:show', config);
      } catch {}
    };

    if (notificationWin.webContents.isLoadingMainFrame()) {
      notificationWin.webContents.once('did-finish-load', send);
    } else {
      send();
    }
    return true;
  }
  return false;
}

function dismissNotificationById(id: string): void {
  const notificationWin = getNotificationWindow();
  if (!notificationWin || notificationWin.isDestroyed()) return;
  try {
    notificationWin.webContents.send('notification:dismiss', { id });
  } catch {}
}

export function settleNotificationResponse(payload: any): boolean {
  const responseId = String(payload?.responseId || payload?.id || '').trim();
  if (!responseId) return false;
  const pending = pendingNotificationResponses.get(responseId);
  if (!pending) return false;
  pendingNotificationResponses.delete(responseId);
  if (pending.timer) clearTimeout(pending.timer);
  pending.resolve(payload);
  return true;
}

export async function execSendNotification(args: any, ctx: RouterContext): Promise<any> {
  const title = String(args?.title || 'Stuard AI').trim() || 'Stuard AI';
  const message = String(args?.message ?? args?.body ?? '').trim();
  const variant = normalizeNotificationVariant(args?.severity ?? args?.variant);
  const position = String(args?.position || 'top-right').trim() || 'top-right';
  const progress = Number(args?.progress);
  const requestedDuration = Number(args?.durationMs ?? args?.duration);
  const waitForInput = Boolean(args?.waitForInput);
  const showInput = waitForInput
    || Boolean(args?.showInput)
    || String(args?.inputPlaceholder || args?.inputDefaultValue || '').trim().length > 0;
  const duration = waitForInput
    ? 0
    : (Number.isFinite(requestedDuration) && requestedDuration >= 0 ? requestedDuration : 5000);
  const inputType = String(args?.inputType || 'text').trim().toLowerCase();
  const responseId = `notification-response-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const notification = {
    id: String(args?.id || responseId),
    title,
    message,
    variant,
    position,
    duration,
    dismissible: args?.dismissible !== false,
    sound: args?.sound ?? true,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined,
    image: normalizeNotificationImage(args?.image ?? args?.imagePath),
    taskId: args?.taskId ? String(args.taskId) : undefined,
    workflowRunId: args?.workflowRunId ? String(args.workflowRunId) : undefined,
  } as Record<string, any>;

  if (showInput) {
    notification.input = {
      placeholder: String(args?.inputPlaceholder || 'Type here...'),
      defaultValue: String(args?.inputDefaultValue || ''),
      submitText: String(args?.inputSubmitText || 'Send'),
      cancelText: args?.inputCancelText ? String(args.inputCancelText) : undefined,
      type: inputType === 'password' || inputType === 'email' || inputType === 'number' ? inputType : 'text',
      keepAfterSubmit: Boolean(args?.keepAfterSubmit),
    };
  }

  if (waitForInput) {
    notification.responseId = responseId;
  }

  const delivered = deliverNotification(notification);
  if (!delivered) {
    if (waitForInput) {
      return { ok: false, error: 'interactive_notification_unavailable' };
    }
    if (Notification && typeof (Notification as any).isSupported === 'function' && Notification.isSupported()) {
      try {
        const nativeNotification = new Notification({ title, body: message });
        nativeNotification.show();
      } catch (e: any) {
        return { ok: false, error: String(e?.message || 'notification_failed') };
      }
      return { ok: true, notification, native: true };
    }
    return { ok: false, error: 'notification_window_unavailable' };
  }

  ctx.logFn(`send_notification: ${title}${message ? ` — ${message}` : ''}`);

  if (!waitForInput) {
    return { ok: true, notification };
  }

  const timeoutMs = Math.max(0, Number(args?.timeoutMs || 300000));
  return await new Promise((resolve) => {
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        pendingNotificationResponses.delete(responseId);
        dismissNotificationById(notification.id);
        resolve({ ok: false, error: 'timeout', notification, responseId });
      }, timeoutMs)
      : undefined;

    pendingNotificationResponses.set(responseId, {
      timer,
      resolve: (payload) => {
        const responseType = String(payload?.type || 'submit');
        resolve({
          ok: true,
          notification,
          responseId,
          response: {
            type: responseType,
            value: payload?.value,
          },
          submitted: responseType === 'submit',
          dismissed: responseType === 'dismiss',
          cancelled: responseType === 'cancel',
          value: payload?.value,
        });
      },
    });
  });
}

let _nwm: any | null = null;
let _nwmInit: { ok: boolean; error?: string } | null = null;

function _ensureNwm() {
  if (_nwmInit) return _nwmInit;
  try {
    const mod = require('node-window-manager');
    _nwm = mod?.windowManager;
    if (!_nwm) {
      _nwmInit = { ok: false, error: 'node_window_manager_missing_export' };
      return _nwmInit;
    }
    if (process.platform === 'darwin') {
      try {
        _nwm.requestAccessibility();
      } catch { }
    }
    _nwmInit = { ok: true };
    return _nwmInit;
  } catch (e: any) {
    _nwm = null;
    _nwmInit = { ok: false, error: String(e?.message || e || 'node_window_manager_load_failed') };
    return _nwmInit;
  }
}

function _safeGetTitle(win: any): string {
  try {
    const t = win?.getTitle?.();
    return String(t || '').trim();
  } catch {
    return '';
  }
}

function _safeGetBounds(win: any): { x: number; y: number; width: number; height: number } | null {
  try {
    const b = win?.getBounds?.();
    if (!b || typeof b !== 'object') return null;
    const x = Number((b as any).x);
    const y = Number((b as any).y);
    const width = Number((b as any).width);
    const height = Number((b as any).height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function _getWindowsSafe(): any[] {
  const init = _ensureNwm();
  if (!init.ok || !_nwm) return [];
  try {
    const wins = _nwm.getWindows?.();
    return Array.isArray(wins) ? wins : [];
  } catch {
    return [];
  }
}

function _findWindowById(id: number): any | null {
  const wins = _getWindowsSafe();
  for (const w of wins) {
    if (Number((w as any)?.id) === id) return w;
  }
  return null;
}

function _findBestWindowByTitle(query: string): any | null {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const wins = _getWindowsSafe();
  let best: any | null = null;
  let bestScore = -1;
  for (const w of wins) {
    try {
      if (typeof w?.isWindow === 'function' && !w.isWindow()) continue;
    } catch { }
    const title = _safeGetTitle(w);
    if (!title) continue;
    const tl = title.toLowerCase();
    if (tl === q) {
      const score = 1_000_000 + title.length;
      if (score > bestScore) {
        best = w;
        bestScore = score;
      }
      continue;
    }
    if (tl.includes(q)) {
      const score = 1000 + title.length;
      if (score > bestScore) {
        best = w;
        bestScore = score;
      }
    }
  }
  return best;
}

export async function execListOpenWindows(args: any, ctx: RouterContext): Promise<any> {
  const init = _ensureNwm();
  if (!init.ok) return { ok: false, error: init.error || 'node_window_manager_unavailable' };

  const windows: Array<{ id: number; title: string; minimized?: boolean; maximized?: boolean; bounds?: any }> = [];
  for (const w of _getWindowsSafe()) {
    const title = _safeGetTitle(w);
    if (!title) continue;
    try {
      if (typeof w?.isVisible === 'function' && !w.isVisible()) continue;
    } catch { }
    windows.push({
      id: Number((w as any)?.id),
      title,
      bounds: _safeGetBounds(w) || undefined,
    });
  }
  ctx.logFn(`list_open_windows: Found ${windows.length} window(s)`);
  return { ok: true, windows };
}

export async function execBringWindowToForeground(args: any, ctx: RouterContext): Promise<any> {
  const init = _ensureNwm();
  if (!init.ok) return { ok: false, error: init.error || 'node_window_manager_unavailable' };

  const title = String(args?.title || '').trim();
  if (!title) return { ok: false, error: 'missing_title' };

  const w = _findBestWindowByTitle(title);
  if (!w) return { ok: false, error: 'window_not_found' };

  try { w.restore?.(); } catch { }
  try { w.bringToTop?.(); } catch { }

  return { ok: true };
}

export async function execGetWindowInfo(args: any, ctx: RouterContext): Promise<any> {
  const init = _ensureNwm();
  if (!init.ok) return { ok: false, error: init.error || 'node_window_manager_unavailable' };

  const title = String(args?.title || '').trim();
  if (!title) return { ok: false, error: 'missing_title' };

  const w = _findBestWindowByTitle(title);
  if (!w) return { ok: false, error: 'window_not_found' };

  const bounds = _safeGetBounds(w);
  if (!bounds) return { ok: false, error: 'bounds_unavailable' };

  return { ok: true, bounds };
}

export async function execSetWindowBounds(args: any, ctx: RouterContext): Promise<any> {
  const init = _ensureNwm();
  if (!init.ok) return { ok: false, error: init.error || 'node_window_manager_unavailable' };

  const idRaw = args?.id;
  const id = Number.isFinite(Number(idRaw)) ? Number(idRaw) : null;
  const title = String(args?.title || '').trim();
  const bounds = args?.bounds;

  if (!bounds || typeof bounds !== 'object') return { ok: false, error: 'missing_bounds' };
  if (!title && !Number.isFinite(id as any)) return { ok: false, error: 'missing_target' };

  const w = Number.isFinite(id as any) ? _findWindowById(id as any) : _findBestWindowByTitle(title);
  if (!w) return { ok: false, error: 'window_not_found' };

  try {
    const patch: any = {};
    if (typeof (bounds as any).x === 'number') patch.x = (bounds as any).x;
    if (typeof (bounds as any).y === 'number') patch.y = (bounds as any).y;
    if (typeof (bounds as any).width === 'number') patch.width = (bounds as any).width;
    if (typeof (bounds as any).height === 'number') patch.height = (bounds as any).height;
    w.setBounds?.(patch);
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'set_bounds_failed') };
  }

  if (args?.bringToTop) {
    try { w.restore?.(); } catch { }
    try { w.bringToTop?.(); } catch { }
  }

  const outBounds = _safeGetBounds(w);
  return { ok: true, bounds: outBounds || undefined };
}

export async function execSmartBringWindowToForeground(args: any, ctx: RouterContext): Promise<any> {
  const init = _ensureNwm();
  if (!init.ok) return { ok: false, error: init.error || 'node_window_manager_unavailable' };

  const hint = String(args?.hint || '').trim();
  if (!hint) return { ok: false, error: 'missing_hint' };

  const tryFocus = () => {
    const w = _findBestWindowByTitle(hint);
    if (!w) return false;
    try { w.restore?.(); } catch { }
    try { w.bringToTop?.(); } catch { }
    return true;
  };

  if (tryFocus()) return { ok: true };

  const looksLikePath = /^[a-zA-Z]:[\\/]/.test(hint) || hint.startsWith('\\\\');
  const looksLikeUrl = /^https?:\/\//i.test(hint);
  if (looksLikePath) {
    try { await shell.openPath(hint); } catch { }
  } else if (looksLikeUrl) {
    try { await shell.openExternal(hint); } catch { }
  }

  await new Promise(r => setTimeout(r, 1200));
  if (tryFocus()) return { ok: true };

  return { ok: false, error: 'window_not_found' };
}

