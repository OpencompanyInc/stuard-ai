/**
 * VM bot memory
 *
 * A small, local mirror of the desktop bot-memory-service. It stores each
 * deployed bot's private kanban plus a short run log so VM-triggered runs have
 * the same cross-session working memory as local proactive runs.
 */

import fs from 'fs';
import path from 'path';

export type BotKanbanStatus = 'queued' | 'in_progress' | 'completed' | 'failed';
export type BotMemoryActor = 'bot' | 'user';

export interface BotKanbanCard {
  id: string;
  title: string;
  notes?: string;
  status: BotKanbanStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  lastEditedBy: BotMemoryActor;
}

export interface BotRunLogEntry {
  id: string;
  at: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failed';
  cardIds?: string[];
  notes?: string;
}

export interface BotMemoryRecord {
  cards: BotKanbanCard[];
  runLog: BotRunLogEntry[];
}

interface BotMemoryFile {
  version: 1;
  bots: Record<string, BotMemoryRecord>;
}

const BOTS_ROOT = process.env.STUARD_BOTS_ROOT || '/home/stuard/bots';
const MEMORY_FILE = 'bot-memory.json';
const STATUS_VALUES: BotKanbanStatus[] = ['queued', 'in_progress', 'completed', 'failed'];
const RUN_LOG_LIMIT = 50;

function memoryPath(): string {
  return path.join(BOTS_ROOT, MEMORY_FILE);
}

function emptyFile(): BotMemoryFile {
  return { version: 1, bots: {} };
}

function ensureRoot(): void {
  try { fs.mkdirSync(BOTS_ROOT, { recursive: true }); } catch {}
}

function loadFile(): BotMemoryFile {
  try {
    const p = memoryPath();
    if (!fs.existsSync(p)) return emptyFile();
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw || raw.version !== 1 || !raw.bots || typeof raw.bots !== 'object') return emptyFile();
    const bots: Record<string, BotMemoryRecord> = {};
    for (const [botId, rec] of Object.entries(raw.bots as Record<string, any>)) {
      bots[String(botId)] = normalizeRecord(rec);
    }
    return { version: 1, bots };
  } catch {
    return emptyFile();
  }
}

function saveFile(file: BotMemoryFile): void {
  ensureRoot();
  fs.writeFileSync(memoryPath(), JSON.stringify(file, null, 2), 'utf-8');
}

function normalizeRecord(raw: any): BotMemoryRecord {
  const cards: BotKanbanCard[] = Array.isArray(raw?.cards)
    ? raw.cards.map(normalizeCard).filter((card: BotKanbanCard | null): card is BotKanbanCard => !!card)
    : [];
  const runLog: BotRunLogEntry[] = Array.isArray(raw?.runLog)
    ? raw.runLog.map(normalizeRunLog).filter((entry: BotRunLogEntry | null): entry is BotRunLogEntry => !!entry)
    : [];
  return {
    cards: cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    runLog: runLog.sort((a, b) => a.at.localeCompare(b.at)).slice(-RUN_LOG_LIMIT),
  };
}

function normalizeCard(raw: any): BotKanbanCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;
  const now = new Date().toISOString();
  const status: BotKanbanStatus = STATUS_VALUES.includes(raw.status) ? raw.status : 'queued';
  return {
    id,
    title,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
    status,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    completedAt: raw.completedAt || null,
    lastEditedBy: raw.lastEditedBy === 'user' ? 'user' : 'bot',
  };
}

function normalizeRunLog(raw: any): BotRunLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const summary = String(raw.summary || '').trim();
  if (!id || !summary) return null;
  return {
    id,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    summary,
    outcome: raw.outcome === 'partial' || raw.outcome === 'failed' ? raw.outcome : 'success',
    cardIds: Array.isArray(raw.cardIds) ? raw.cardIds.map(String) : undefined,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : undefined,
  };
}

function ensureRecord(file: BotMemoryFile, botId: string): BotMemoryRecord {
  if (!file.bots[botId]) file.bots[botId] = { cards: [], runLog: [] };
  return file.bots[botId];
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveBotId(args: any): string {
  return String(args?.__proactiveBotId || args?.proactiveBotId || args?.botId || args?.id || '').trim();
}

export function listVMBotCards(botId: string, status?: BotKanbanStatus): BotKanbanCard[] {
  if (!botId) return [];
  const rec = loadFile().bots[botId];
  if (!rec) return [];
  const cards = status ? rec.cards.filter((card) => card.status === status) : rec.cards;
  return [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createVMBotCard(
  botId: string,
  input: { title: string; notes?: string; status?: BotKanbanStatus },
  by: BotMemoryActor = 'bot',
): BotKanbanCard | null {
  const title = String(input?.title || '').trim();
  if (!botId || !title) return null;
  const file = loadFile();
  const rec = ensureRecord(file, botId);
  const now = new Date().toISOString();
  const status = input.status && STATUS_VALUES.includes(input.status) ? input.status : 'queued';
  const card: BotKanbanCard = {
    id: genId('card'),
    title,
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : undefined,
    status,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'completed' ? now : null,
    lastEditedBy: by,
  };
  rec.cards.push(card);
  saveFile(file);
  return card;
}

export function updateVMBotCard(
  botId: string,
  cardId: string,
  patch: Partial<Pick<BotKanbanCard, 'title' | 'notes' | 'status'>>,
  by: BotMemoryActor = 'bot',
): BotKanbanCard | null {
  if (!botId || !cardId) return null;
  const file = loadFile();
  const rec = file.bots[botId];
  if (!rec) return null;
  const idx = rec.cards.findIndex((card) => card.id === cardId);
  if (idx < 0) return null;
  const prev = rec.cards[idx];
  const now = new Date().toISOString();
  const nextStatus = patch.status && STATUS_VALUES.includes(patch.status) ? patch.status : prev.status;
  const next: BotKanbanCard = {
    ...prev,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : prev.title,
    notes: patch.notes !== undefined
      ? (typeof patch.notes === 'string' && patch.notes.trim() ? patch.notes.trim() : undefined)
      : prev.notes,
    status: nextStatus,
    updatedAt: now,
    completedAt: nextStatus === 'completed'
      ? (prev.completedAt || now)
      : (nextStatus === 'failed' ? prev.completedAt : null),
    lastEditedBy: by,
  };
  rec.cards[idx] = next;
  saveFile(file);
  return next;
}

export function deleteVMBotCard(botId: string, cardId: string): boolean {
  if (!botId || !cardId) return false;
  const file = loadFile();
  const rec = file.bots[botId];
  if (!rec) return false;
  const before = rec.cards.length;
  rec.cards = rec.cards.filter((card) => card.id !== cardId);
  if (rec.cards.length === before) return false;
  saveFile(file);
  return true;
}

export function deleteVMBotMemory(botId: string): boolean {
  if (!botId) return false;
  const file = loadFile();
  if (!file.bots[botId]) return false;
  delete file.bots[botId];
  saveFile(file);
  return true;
}

export function appendVMBotRunLog(
  botId: string,
  entry: { summary: string; outcome?: BotRunLogEntry['outcome']; cardIds?: string[]; notes?: string },
): BotRunLogEntry | null {
  const summary = String(entry?.summary || '').trim();
  if (!botId || !summary) return null;
  const file = loadFile();
  const rec = ensureRecord(file, botId);
  const log: BotRunLogEntry = {
    id: genId('run'),
    at: new Date().toISOString(),
    summary,
    outcome: entry.outcome === 'partial' || entry.outcome === 'failed' ? entry.outcome : 'success',
    cardIds: Array.isArray(entry.cardIds) && entry.cardIds.length > 0 ? entry.cardIds.map(String) : undefined,
    notes: typeof entry.notes === 'string' && entry.notes.trim() ? entry.notes.trim() : undefined,
  };
  rec.runLog.push(log);
  rec.runLog = rec.runLog.slice(-RUN_LOG_LIMIT);
  saveFile(file);
  return log;
}

export function listVMBotRunLog(botId: string, limit = 20): BotRunLogEntry[] {
  if (!botId) return [];
  const rec = loadFile().bots[botId];
  if (!rec) return [];
  return [...rec.runLog].reverse().slice(0, Math.max(1, Math.min(limit, RUN_LOG_LIMIT)));
}

export function exportVMBotMemory(botId: string, limit = 50): BotMemoryRecord {
  return {
    cards: listVMBotCards(botId),
    runLog: listVMBotRunLog(botId, limit).reverse(),
  };
}

export function replaceVMBotMemory(botId: string, record: Partial<BotMemoryRecord>): BotMemoryRecord {
  const file = loadFile();
  file.bots[botId] = normalizeRecord(record);
  saveFile(file);
  return file.bots[botId];
}

export function mergeVMBotMemory(botId: string, record: Partial<BotMemoryRecord>): BotMemoryRecord {
  if (!botId) return { cards: [], runLog: [] };
  const incoming = normalizeRecord(record);
  const file = loadFile();
  const current = ensureRecord(file, botId);

  const cardsById = new Map<string, BotKanbanCard>();
  for (const card of current.cards) cardsById.set(card.id, card);
  for (const card of incoming.cards) {
    const existing = cardsById.get(card.id);
    if (!existing || card.updatedAt.localeCompare(existing.updatedAt) >= 0) {
      cardsById.set(card.id, card);
    }
  }

  const logsById = new Map<string, BotRunLogEntry>();
  for (const entry of current.runLog) logsById.set(entry.id, entry);
  for (const entry of incoming.runLog) logsById.set(entry.id, entry);

  const merged = normalizeRecord({
    cards: Array.from(cardsById.values()),
    runLog: Array.from(logsById.values()),
  });
  file.bots[botId] = merged;
  saveFile(file);
  return merged;
}

export function formatVMBotMemoryForPrompt(botId: string, opts: { runLogLimit?: number; cardLimitPerColumn?: number } = {}): string {
  if (!botId) return '';
  const rec = loadFile().bots[botId] || { cards: [], runLog: [] };
  const cardLimit = Math.max(3, opts.cardLimitPerColumn ?? 8);
  const runLimit = Math.max(1, opts.runLogLimit ?? 5);
  const sections: string[] = [];

  if (rec.cards.length > 0) {
    const byStatus: Record<BotKanbanStatus, BotKanbanCard[]> = {
      in_progress: [],
      queued: [],
      failed: [],
      completed: [],
    };
    for (const card of rec.cards) byStatus[card.status].push(card);
    for (const key of Object.keys(byStatus) as BotKanbanStatus[]) {
      byStatus[key].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    const lines = [
      '# YOUR PRIVATE KANBAN (persists across VM and desktop runs)',
      'Manage cards with bot_memory_* tools. This is your working memory across wake-ups.',
    ];
    const labels: Record<BotKanbanStatus, string> = {
      in_progress: 'In progress',
      queued: 'Queued',
      failed: 'Failed (retry or close out)',
      completed: 'Recently completed',
    };
    for (const status of ['in_progress', 'queued', 'failed', 'completed'] as BotKanbanStatus[]) {
      const cards = byStatus[status];
      if (cards.length === 0) continue;
      lines.push(`\n## ${labels[status]}`);
      for (const card of cards.slice(0, cardLimit)) {
        const notes = card.notes ? ` - ${card.notes.replace(/\s+/g, ' ').slice(0, 200)}` : '';
        lines.push(`- [${card.id}] ${card.title}${notes}`);
      }
      if (cards.length > cardLimit) {
        lines.push(`- ...and ${cards.length - cardLimit} more (call bot_memory_list to see all)`);
      }
    }
    sections.push(lines.join('\n'));
  } else {
    sections.push([
      '# YOUR PRIVATE KANBAN (empty - start populating it as you work)',
      'Use bot_memory_create to capture a plan or finding, and bot_memory_log to wrap up each run.',
    ].join('\n'));
  }

  if (rec.runLog.length > 0) {
    const lines = ['# Recent runs (most recent first)'];
    for (const entry of [...rec.runLog].reverse().slice(0, runLimit)) {
      const when = entry.at.replace('T', ' ').slice(0, 16);
      const mark = entry.outcome === 'success' ? 'ok' : entry.outcome === 'partial' ? 'partial' : 'failed';
      lines.push(`- ${mark} ${when} - ${entry.summary}${entry.notes ? ` (${entry.notes.slice(0, 160)})` : ''}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
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
