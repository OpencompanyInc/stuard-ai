import { getNotificationWindow, openNotificationWindow, isAnyAppWindowFocused } from '../windows';

const notifiedKeys = new Map<string, number>();
const DEDUPE_MS = 60_000;

function deliverNotification(config: Record<string, unknown>): void {
  openNotificationWindow();
  const notificationWin = getNotificationWindow();
  if (!notificationWin || notificationWin.isDestroyed()) return;

  const send = () => {
    try {
      notificationWin.webContents.send('notification:show', config);
    } catch { /* window may have closed */ }
  };

  if (notificationWin.webContents.isLoadingMainFrame()) {
    notificationWin.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function truncate(text: string, max = 240): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function shouldNotify(requestId: string): boolean {
  const key = String(requestId || '').trim() || 'default';
  const now = Date.now();
  const last = notifiedKeys.get(key);
  if (last && now - last < DEDUPE_MS) return false;
  notifiedKeys.set(key, now);

  if (notifiedKeys.size > 200) {
    for (const [k, at] of notifiedKeys) {
      if (now - at > DEDUPE_MS) notifiedKeys.delete(k);
    }
  }
  return true;
}

/**
 * Notify when the orchestrator finishes a turn (`final` message).
 * Only fires for non-aborted completions. Subagent events are ignored.
 * Skipped when a Stuard window is focused (the user can see the result already).
 */
export function notifyOrchestratorDone(msg: any): void {
  if (!msg || String(msg.type || '').toLowerCase() !== 'final') return;
  if (msg.aborted === true) return;

  const result = (msg.result && typeof msg.result === 'object') ? msg.result : {};
  if (result.finishReason === 'aborted') return;

  // Don't interrupt with a toast if the user is already looking at Stuard —
  // they can see the result in the chat. Only notify when we're in the background.
  if (isAnyAppWindowFocused()) return;

  const requestId = String(msg.requestId || msg.id || '').trim();
  if (!shouldNotify(requestId || `final-${Date.now()}`)) return;

  const preview = truncate(result.response || result.text || result.message || '');
  const message = preview || 'Your task is complete.';

  deliverNotification({
    id: `orchestrator-done-${requestId || Date.now()}`,
    title: 'Task complete',
    message,
    variant: 'info',
    position: 'top-right',
    duration: 10_000,
    dismissible: true,
    sound: true,
    className: 'stuard-notification',
    orchestratorDone: true,
  });
}
