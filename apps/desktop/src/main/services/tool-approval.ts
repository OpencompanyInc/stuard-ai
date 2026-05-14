import { Notification } from 'electron';
import { getNotificationWindow, openNotificationWindow } from '../windows';

type PendingToolApproval = {
  resolve: (allow: boolean) => void;
  timer?: NodeJS.Timeout;
};

const pendingToolApprovals = new Map<string, PendingToolApproval>();

function dismissNotificationById(id: string): void {
  const notificationWin = getNotificationWindow();
  if (!notificationWin || notificationWin.isDestroyed()) return;
  try {
    notificationWin.webContents.send('notification:dismiss', { id });
  } catch {}
}

function deliverApprovalNotification(config: Record<string, any>): boolean {
  openNotificationWindow();
  const notificationWin = getNotificationWindow();
  if (!notificationWin || notificationWin.isDestroyed()) return false;

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

export function settleToolApprovalResponse(payload: { id?: string; allow?: boolean } | null | undefined): boolean {
  const id = String(payload?.id || '').trim();
  if (!id) return false;

  const pending = pendingToolApprovals.get(id);
  if (!pending) return false;

  pendingToolApprovals.delete(id);
  if (pending.timer) clearTimeout(pending.timer);
  dismissNotificationById(id);
  pending.resolve(Boolean(payload?.allow));
  return true;
}

export async function requestToolApproval(args: {
  id: string;
  tool: string;
  toolOriginal?: string;
  approvalArgs?: Record<string, any>;
  description?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const id = String(args.id || '').trim();
  const tool = String(args.toolOriginal || args.tool || 'tool').trim();
  if (!id) return false;

  const toolLabel = tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const description = String(args.description || '').trim() || `Stuard wants to use ${toolLabel}.`;
  const notification = {
    id,
    title: 'Permission Required',
    message: description,
    variant: 'warning',
    duration: 0,
    dismissible: true,
    sound: true,
    permissionRequest: {
      id,
      tool,
      args: args.approvalArgs || {},
      description,
    },
  };

  const delivered = deliverApprovalNotification(notification);
  if (!delivered) {
    if (Notification && typeof (Notification as any).isSupported === 'function' && Notification.isSupported()) {
      try {
        new Notification({ title: 'Permission Required', body: description }).show();
      } catch {}
    }
    return false;
  }

  const timeoutMs = Math.max(1_000, Number(args.timeoutMs || 55_000));
  return await new Promise<boolean>((resolve) => {
    const existing = pendingToolApprovals.get(id);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.resolve(false);
    }

    const timer = setTimeout(() => {
      pendingToolApprovals.delete(id);
      dismissNotificationById(id);
      resolve(false);
    }, timeoutMs);

    pendingToolApprovals.set(id, { timer, resolve });
  });
}
