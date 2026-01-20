import { clipboard } from 'electron';
import { execCloseCustomUi as _execCloseCustomUi, execCustomUi as _execCustomUi, execUpdateCustomUi as _execUpdateCustomUi, execPlayAudio as _execPlayAudio, customUiWindows, sendEventToCustomUi, initCustomUiIpc } from '../../custom-ui';
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
  return { ok: true, action: 'return', terminated: true, value };
}

