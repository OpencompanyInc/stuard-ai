import { BrowserWindow } from 'electron';
import { botMemoryService, type BotKanbanStatus } from '../../services/bot-memory-service';
import type { RouterContext } from '../types';

const VALID_STATUSES: ReadonlySet<BotKanbanStatus> = new Set(['queued', 'in_progress', 'completed', 'failed']);

function broadcastMemoryChanged(botId: string): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('bot-memory-changed', { botId });
    }
  } catch { /* renderer-less main, ignore */ }
}

function requireBotId(ctx: RouterContext): { ok: false; error: string } | { ok: true; botId: string } {
  const botId = (ctx?.proactiveBotId || '').trim();
  if (!botId) {
    return { ok: false, error: 'bot_memory tools are only available during a proactive bot run (no proactiveBotId in context).' };
  }
  return { ok: true, botId };
}

export async function execBotMemoryList(args: any, ctx: RouterContext): Promise<any> {
  const scope = requireBotId(ctx);
  if (!scope.ok) return scope;
  const status = typeof args?.status === 'string' && VALID_STATUSES.has(args.status as BotKanbanStatus)
    ? (args.status as BotKanbanStatus)
    : undefined;
  return { ok: true, cards: botMemoryService.listCards(scope.botId, status ? { status } : {}) };
}

export async function execBotMemoryCreate(args: any, ctx: RouterContext): Promise<any> {
  const scope = requireBotId(ctx);
  if (!scope.ok) return scope;
  const title = String(args?.title || '').trim();
  if (!title) return { ok: false, error: 'title is required' };
  const status = typeof args?.status === 'string' && VALID_STATUSES.has(args.status as BotKanbanStatus)
    ? (args.status as BotKanbanStatus)
    : undefined;
  const card = botMemoryService.createCard(scope.botId, {
    title,
    notes: typeof args?.notes === 'string' ? args.notes : undefined,
    status,
  }, 'bot');
  if (!card) return { ok: false, error: 'failed to create card' };
  broadcastMemoryChanged(scope.botId);
  return { ok: true, card };
}

export async function execBotMemoryUpdate(args: any, ctx: RouterContext): Promise<any> {
  const scope = requireBotId(ctx);
  if (!scope.ok) return scope;
  const id = String(args?.id || args?.card_id || '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const patch: Record<string, any> = {};
  if (typeof args?.title === 'string') patch.title = args.title;
  if (typeof args?.notes === 'string') patch.notes = args.notes;
  if (typeof args?.status === 'string' && VALID_STATUSES.has(args.status as BotKanbanStatus)) patch.status = args.status;
  const card = botMemoryService.updateCard(scope.botId, id, patch, 'bot');
  if (!card) return { ok: false, error: 'card not found' };
  broadcastMemoryChanged(scope.botId);
  return { ok: true, card };
}

export async function execBotMemoryDelete(args: any, ctx: RouterContext): Promise<any> {
  const scope = requireBotId(ctx);
  if (!scope.ok) return scope;
  const id = String(args?.id || args?.card_id || '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const ok = botMemoryService.deleteCard(scope.botId, id);
  if (ok) broadcastMemoryChanged(scope.botId);
  return ok ? { ok: true } : { ok: false, error: 'card not found' };
}

export async function execBotMemoryLog(args: any, ctx: RouterContext): Promise<any> {
  const scope = requireBotId(ctx);
  if (!scope.ok) return scope;
  const summary = String(args?.summary || '').trim();
  if (!summary) return { ok: false, error: 'summary is required' };
  const outcome = args?.outcome === 'partial' || args?.outcome === 'failed' ? args.outcome : 'success';
  const entry = botMemoryService.appendRunLog(scope.botId, {
    summary,
    outcome,
    cardIds: Array.isArray(args?.cardIds) ? args.cardIds.map(String) : undefined,
    notes: typeof args?.notes === 'string' ? args.notes : undefined,
  });
  if (!entry) return { ok: false, error: 'failed to append run log' };
  broadcastMemoryChanged(scope.botId);
  return { ok: true, entry };
}
