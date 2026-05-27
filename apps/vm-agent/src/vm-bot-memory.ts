/**
 * VM bot memory — thin wrapper over the shared @stuardai/bots-core store.
 *
 * Logic + types are single-sourced with the desktop bot-memory-service; this
 * file only provides the VM's JSON-file storage (/home/stuard/bots) and keeps
 * the VM's existing exported function names + command dispatcher.
 */

import fs from 'fs';
import path from 'path';
import {
  createBotMemoryStore,
  emptyBotMemoryFile,
  normalizeBotMemoryRecord,
  BOT_MEMORY_STATUS_VALUES as STATUS_VALUES,
  type BotMemoryFile,
  type BotKanbanCard,
  type BotKanbanStatus,
  type BotMemoryActor,
  type BotRunLogEntry,
  type BotMemoryRecord,
} from '@stuardai/bots-core';

export type { BotKanbanCard, BotKanbanStatus, BotMemoryActor, BotRunLogEntry, BotMemoryRecord };

const BOTS_ROOT = process.env.STUARD_BOTS_ROOT || '/home/stuard/bots';
const MEMORY_FILE = 'bot-memory.json';

function memoryPath(): string {
  return path.join(BOTS_ROOT, MEMORY_FILE);
}

const store = createBotMemoryStore({
  load(): BotMemoryFile {
    try {
      const p = memoryPath();
      if (!fs.existsSync(p)) return emptyBotMemoryFile();
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!raw || raw.version !== 1 || !raw.bots || typeof raw.bots !== 'object') return emptyBotMemoryFile();
      const bots: Record<string, BotMemoryRecord> = {};
      for (const [botId, rec] of Object.entries(raw.bots as Record<string, any>)) {
        bots[String(botId)] = normalizeBotMemoryRecord(rec);
      }
      return { version: 1, bots };
    } catch {
      return emptyBotMemoryFile();
    }
  },
  save(file: BotMemoryFile): void {
    try { fs.mkdirSync(BOTS_ROOT, { recursive: true }); } catch {}
    fs.writeFileSync(memoryPath(), JSON.stringify(file, null, 2), 'utf-8');
  },
});

function resolveBotId(args: any): string {
  return String(args?.__proactiveBotId || args?.proactiveBotId || args?.botId || args?.id || '').trim();
}

export function listVMBotCards(botId: string, status?: BotKanbanStatus): BotKanbanCard[] {
  return store.listCards(botId, status ? { status } : {});
}

export function createVMBotCard(
  botId: string,
  input: { title: string; notes?: string; status?: BotKanbanStatus },
  by: BotMemoryActor = 'bot',
): BotKanbanCard | null {
  return store.createCard(botId, input, by);
}

export function updateVMBotCard(
  botId: string,
  cardId: string,
  patch: Partial<Pick<BotKanbanCard, 'title' | 'notes' | 'status'>>,
  by: BotMemoryActor = 'bot',
): BotKanbanCard | null {
  return store.updateCard(botId, cardId, patch, by);
}

export function deleteVMBotCard(botId: string, cardId: string): boolean {
  return store.deleteCard(botId, cardId);
}

export function deleteVMBotMemory(botId: string): boolean {
  return store.clearForBot(botId);
}

export function appendVMBotRunLog(
  botId: string,
  entry: { summary: string; outcome?: BotRunLogEntry['outcome']; cardIds?: string[]; notes?: string },
): BotRunLogEntry | null {
  return store.appendRunLog(botId, entry);
}

export function listVMBotRunLog(botId: string, limit = 20): BotRunLogEntry[] {
  return store.listRunLog(botId, limit);
}

export function exportVMBotMemory(botId: string, limit = 50): BotMemoryRecord {
  // Chronological run log (oldest first) to match the prior VM export shape.
  return {
    cards: store.listCards(botId),
    runLog: store.listRunLog(botId, limit).reverse(),
  };
}

export function replaceVMBotMemory(botId: string, record: Partial<BotMemoryRecord>): BotMemoryRecord {
  return store.replaceRecord(botId, record);
}

export function mergeVMBotMemory(botId: string, record: Partial<BotMemoryRecord>): BotMemoryRecord {
  return store.mergeSnapshot(botId, record);
}

export function formatVMBotMemoryForPrompt(botId: string, opts: { runLogLimit?: number; cardLimitPerColumn?: number } = {}): string {
  return store.formatForPrompt(botId, opts);
}

export function handleVMBotMemoryCommand(command: string, args: any): any {
  const botId = resolveBotId(args);
  if (!botId) return { ok: false, error: 'missing_bot_id' };
  const normalizedCommand = command.replace(/^agent_memory_/, 'bot_memory_');

  switch (normalizedCommand) {
    case 'bot_memory_list': {
      const status = STATUS_VALUES.includes(args?.status) ? args.status as BotKanbanStatus : undefined;
      return { ok: true, cards: listVMBotCards(botId, status) };
    }
    case 'bot_memory_create': {
      const card = createVMBotCard(botId, {
        title: String(args?.title || ''),
        notes: typeof args?.notes === 'string' ? args.notes : undefined,
        status: STATUS_VALUES.includes(args?.status) ? args.status : undefined,
      }, args?.lastEditedBy === 'user' ? 'user' : 'bot');
      return card ? { ok: true, card } : { ok: false, error: 'invalid_input' };
    }
    case 'bot_memory_update': {
      const id = String(args?.id || args?.card_id || '').trim();
      if (!id) return { ok: false, error: 'missing_card_id' };
      const card = updateVMBotCard(botId, id, {
        title: typeof args?.title === 'string' ? args.title : undefined,
        notes: typeof args?.notes === 'string' ? args.notes : undefined,
        status: STATUS_VALUES.includes(args?.status) ? args.status : undefined,
      }, args?.lastEditedBy === 'user' ? 'user' : 'bot');
      return card ? { ok: true, card } : { ok: false, error: 'card_not_found' };
    }
    case 'bot_memory_delete': {
      const id = String(args?.id || args?.card_id || '').trim();
      if (!id) return { ok: false, error: 'missing_card_id' };
      const ok = deleteVMBotCard(botId, id);
      return ok ? { ok: true } : { ok: false, error: 'card_not_found' };
    }
    case 'bot_memory_log': {
      const entry = appendVMBotRunLog(botId, {
        summary: String(args?.summary || ''),
        outcome: args?.outcome,
        cardIds: Array.isArray(args?.cardIds) ? args.cardIds.map(String) : undefined,
        notes: typeof args?.notes === 'string' ? args.notes : undefined,
      });
      return entry ? { ok: true, entry } : { ok: false, error: 'invalid_input' };
    }
    case 'bot_memory_export':
      return { ok: true, ...exportVMBotMemory(botId) };
    case 'bot_memory_replace':
      return { ok: true, ...replaceVMBotMemory(botId, args?.memory || args || {}) };
    case 'bot_memory_merge':
      return { ok: true, ...mergeVMBotMemory(botId, args?.memory || args || {}) };
    default:
      return { ok: false, error: 'unsupported_bot_memory_command' };
  }
}
