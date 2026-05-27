import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import {
  createBotMemoryStore,
  emptyBotMemoryFile,
  normalizeBotMemoryRecord,
  type BotMemoryFile,
  type BotKanbanCard,
  type BotKanbanStatus,
  type BotMemoryActor,
  type BotRunLogEntry,
  type BotMemoryRecord,
} from '@stuardai/bots-core';

// Types + all logic now live in @stuardai/bots-core (single-sourced with the VM
// agent's vm-bot-memory). Desktop provides Electron-userData storage; the store
// owns everything else. Re-export the types so existing importers are unaffected.
export type { BotKanbanCard, BotKanbanStatus, BotMemoryActor, BotRunLogEntry };

function memoryFilePath(): string {
  return path.join(app.getPath('userData'), 'bot-memory.json');
}

const store = createBotMemoryStore({
  load(): BotMemoryFile {
    try {
      const p = memoryFilePath();
      if (!fs.existsSync(p)) return emptyBotMemoryFile();
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!raw || raw.version !== 1 || !raw.bots || typeof raw.bots !== 'object') return emptyBotMemoryFile();
      const bots: Record<string, BotMemoryRecord> = {};
      for (const [botId, rec] of Object.entries(raw.bots as Record<string, any>)) {
        bots[String(botId)] = normalizeBotMemoryRecord(rec);
      }
      return { version: 1, bots };
    } catch (e) {
      logger.warn('[bot-memory-service] Failed to load bot-memory.json:', e);
      return emptyBotMemoryFile();
    }
  },
  save(file: BotMemoryFile): void {
    try {
      fs.writeFileSync(memoryFilePath(), JSON.stringify(file, null, 2), 'utf-8');
    } catch (e) {
      logger.warn('[bot-memory-service] Failed to save bot-memory.json:', e);
    }
  },
});

// Public API — preserves the existing surface; clearForBot stays void-returning.
export const botMemoryService = {
  listCards: store.listCards,
  getCard: store.getCard,
  createCard: store.createCard,
  updateCard: store.updateCard,
  deleteCard: store.deleteCard,
  appendRunLog: store.appendRunLog,
  listRunLog: store.listRunLog,
  exportSnapshot: store.exportSnapshot,
  mergeSnapshot: store.mergeSnapshot,
  clearForBot(botId: string): void { store.clearForBot(botId); },
  formatForPrompt: store.formatForPrompt,
};
