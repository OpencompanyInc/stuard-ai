import { ipcMain } from 'electron';
import { getMainWindow } from '../../windows';
import { execAskUserViaNotification } from './ask-user-notification';
import type { RouterContext } from '../types';

/**
 * Route ask_user to the in-app AskUserPrompt component when the main window is
 * focused, or fall back to the notification overlay when it is not.
 */
export async function execAskUserInApp(args: any, ctx: RouterContext): Promise<any> {
  const mainWin = getMainWindow();
  const isFocused = mainWin && !mainWin.isDestroyed() && mainWin.isFocused();

  if (!isFocused) {
    return execAskUserViaNotification(args, ctx);
  }

  const promptId = `ask-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<any>((resolve) => {
    const timeoutMs = Number(args?.timeoutMs) || 300000;

    const cleanup = () => {
      try { ipcMain.removeHandler(`ask_user:respond:${promptId}`); } catch { }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: true, dismissed: true });
    }, timeoutMs);

    // One-shot IPC handler for the renderer's response
    ipcMain.handleOnce(`ask_user:respond:${promptId}`, (_e, result: any) => {
      clearTimeout(timer);
      resolve(result || { ok: true, dismissed: true });
      return { ok: true };
    });

    // Tell the renderer to display the inline AskUserPrompt
    mainWin!.webContents.send('ask_user:show', { promptId, args });
  });
}
