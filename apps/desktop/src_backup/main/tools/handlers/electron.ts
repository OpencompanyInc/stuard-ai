import { clipboard } from 'electron';
import { execCloseCustomUi as _execCloseCustomUi, execCustomUi as _execCustomUi, execUpdateCustomUi as _execUpdateCustomUi, execPlayAudio as _execPlayAudio, customUiWindows } from '../../custom-ui';
import { RouterContext } from '../types';

export const execCustomUi = _execCustomUi;
export const execCloseCustomUi = _execCloseCustomUi;
export const execUpdateCustomUi = _execUpdateCustomUi;
export const execPlayAudio = _execPlayAudio;

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

