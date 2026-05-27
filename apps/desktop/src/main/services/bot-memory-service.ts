import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export type BotKanbanStatus = 'queued' | 'in_progress' | 'completed' | 'failed';
export type BotMemoryActor = 'bot' | 'user';

/**
 * A card on a bot's private kanban. This is the bot's own working memory —
 * what it's planning to do, doing now, has finished, or got stuck on. It's
 * intentionally separate from the user-facing task system (which lives in
 * proactive-data.json and is owned by the user). Both the bot (via its
 * `bot_memory` tool) and the user (via the Kanban tab in BotsView) can edit
 * these cards; `lastEditedBy` records who touched a card last so the UI can
 * surface the difference.
 */
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

/**
 * A single run's outcome line. Appended once per wake-up so the bot can read
 * back what it tried last time and decide what to do next. Kept short on
 * purpose — long agent transcripts already live in proactive-data.json's
 * wakeUpLog; this is the at-a-glance "what mattered" version.
 */
export interface BotRunLogEntry {
  id: string;
  at: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failed';
  /** Optional list of card ids touched during this run. */
  cardIds?: string[];
  /** Optional longer free-form notes the bot wants its future self to see. */
  notes?: string;
}

interface BotMemoryRecord {
  cards: BotKanbanCard[];
  runLog: BotRunLogEntry[];
}

interface BotMemoryFile {
  version: 1;
  bots: Record<string, BotMemoryRecord>;
}

// ─── Persistence ───────────────────────────────────────────────────────────

const STATUS_VALUES: BotKanbanStatus[] = ['queued', 'in_progress', 'completed', 'failed'];
const RUN_LOG_LIMIT = 50; // Trim oldest entries past this — keeps prompt + file small.

function memoryFilePath(): string {
  return path.join(app.getPath('userData'), 'bot-memory.json');
}

function emptyFile(): BotMemoryFile {
  return { version: 1, bots: {} };
}

function loadFile(): BotMemoryFile {
  try {
    const p = memoryFilePath();
    if (!fs.existsSync(p)) return emptyFile();
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!raw || raw.version !== 1 || !raw.bots || typeof raw.bots !== 'object') return emptyFile();
    const bots: Record<string, BotMemoryRecord> = {};
    for (const [botId, rec] of Object.entries(raw.bots as Record<string, any>)) {
      bots[String(botId)] = normalizeRecord(rec);
    }
    return { version: 1, bots };
  } catch (e) {
    logger.warn('[bot-memory-service] Failed to load bot-memory.json:', e);
    return emptyFile();
  }
}

function saveFile(file: BotMemoryFile): void {
  try {
    fs.writeFileSync(memoryFilePath(), JSON.stringify(file, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('[bot-memory-service] Failed to save bot-memory.json:', e);
  }
}

function normalizeRecord(raw: any): BotMemoryRecord {
  const cards: BotKanbanCard[] = Array.isArray(raw?.cards) ? raw.cards.map(normalizeCard).filter(Boolean) as BotKanbanCard[] : [];
  const runLog: BotRunLogEntry[] = Array.isArray(raw?.runLog) ? raw.runLog.map(normalizeRunLog).filter(Boolean) as BotRunLogEntry[] : [];
  return { cards, runLog };
}

function normalizeCard(raw: any): BotKanbanCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;
  const status: BotKanbanStatus = STATUS_VALUES.includes(raw.status) ? raw.status : 'queued';
  const now = new Date().toISOString();
  return {
    id,
    title,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
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
  const outcome = raw.outcome === 'partial' || raw.outcome === 'failed' ? raw.outcome : 'success';
  return {
    id,
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    summary,
    outcome,
    cardIds: Array.isArray(raw.cardIds) ? raw.cardIds.map(String) : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

function ensureRecord(file: BotMemoryFile, botId: string): BotMemoryRecord {
  if (!file.bots[botId]) {
    file.bots[botId] = { cards: [], runLog: [] };
  }
  return file.bots[botId];
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

export const botMemoryService = {
  /** Returns the bot's cards. Optionally filter by status. */
  listCards(botId: string, opts: { status?: BotKanbanStatus } = {}): BotKanbanCard[] {
    if (!botId) return [];
    const file = loadFile();
    const rec = file.bots[botId];
    if (!rec) return [];
    const cards = opts.status ? rec.cards.filter(c => c.status === opts.status) : rec.cards;
    // Newest first within each status — feels natural in a kanban column.
    return [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getCard(botId: string, cardId: string): BotKanbanCard | null {
    if (!botId || !cardId) return null;
    const rec = loadFile().bots[botId];
    return rec?.cards.find(c => c.id === cardId) || null;
  },

  createCard(
    botId: string,
    input: { title: string; notes?: string; status?: BotKanbanStatus },
    by: BotMemoryActor,
  ): BotKanbanCard | null {
    const title = String(input?.title || '').trim();
    if (!botId || !title) return null;
    const file = loadFile();
    const rec = ensureRecord(file, botId);
    const now = new Date().toISOString();
    const card: BotKanbanCard = {
      id: genId('card'),
      title,
      notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : undefined,
      status: input.status && STATUS_VALUES.includes(input.status) ? input.status : 'queued',
      createdAt: now,
      updatedAt: now,
      completedAt: input.status === 'completed' ? now : null,
      lastEditedBy: by,
    };
    rec.cards.push(card);
    saveFile(file);
    return card;
  },

  updateCard(
    botId: string,
    cardId: string,
    patch: Partial<Pick<BotKanbanCard, 'title' | 'notes' | 'status'>>,
    by: BotMemoryActor,
  ): BotKanbanCard | null {
    if (!botId || !cardId) return null;
    const file = loadFile();
    const rec = file.bots[botId];
    if (!rec) return null;
    const idx = rec.cards.findIndex(c => c.id === cardId);
    if (idx < 0) return null;
    const prev = rec.cards[idx];
    const now = new Date().toISOString();
    const nextStatus: BotKanbanStatus = patch.status && STATUS_VALUES.includes(patch.status) ? patch.status : prev.status;
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
  },

  deleteCard(botId: string, cardId: string): boolean {
    if (!botId || !cardId) return false;
    const file = loadFile();
    const rec = file.bots[botId];
    if (!rec) return false;
    const before = rec.cards.length;
    rec.cards = rec.cards.filter(c => c.id !== cardId);
    if (rec.cards.length === before) return false;
    saveFile(file);
    return true;
  },

  /** Append a run-log entry. Trims to the most recent RUN_LOG_LIMIT. */
  appendRunLog(
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
    if (rec.runLog.length > RUN_LOG_LIMIT) {
      rec.runLog = rec.runLog.slice(-RUN_LOG_LIMIT);
    }
    saveFile(file);
    return log;
  },

  /** Most-recent first. */
  listRunLog(botId: string, limit: number = 20): BotRunLogEntry[] {
    if (!botId) return [];
    const rec = loadFile().bots[botId];
    if (!rec) return [];
    return [...rec.runLog].reverse().slice(0, Math.max(1, Math.min(limit, RUN_LOG_LIMIT)));
  },

  /** Export a compact snapshot for VM sync. Run log is chronological. */
  exportSnapshot(botId: string, limit: number = RUN_LOG_LIMIT): BotMemoryRecord {
    if (!botId) return { cards: [], runLog: [] };
    const rec = loadFile().bots[botId];
    if (!rec) return { cards: [], runLog: [] };
    return {
      cards: [...rec.cards],
      runLog: [...rec.runLog].slice(-Math.max(1, Math.min(limit, RUN_LOG_LIMIT))),
    };
  },

  /** Merge a VM snapshot into the local file, keeping the newest card edits. */
  mergeSnapshot(botId: string, snapshot: Partial<BotMemoryRecord>): BotMemoryRecord {
    if (!botId) return { cards: [], runLog: [] };
    const incoming = normalizeRecord(snapshot);
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
    file.bots[botId] = {
      cards: merged.cards,
      runLog: merged.runLog.slice(-RUN_LOG_LIMIT),
    };
    saveFile(file);
    return file.bots[botId];
  },

  /** Drop everything for this bot. Called when a bot is deleted. */
  clearForBot(botId: string): void {
    if (!botId) return;
    const file = loadFile();
    if (!file.bots[botId]) return;
    delete file.bots[botId];
    saveFile(file);
  },

  /**
   * Build the markdown the scheduler injects into the bot's system prompt:
   * a compact kanban grouped by status plus the last few run-log entries.
   * Returns an empty string if the bot has nothing yet — caller should skip
   * the section in that case so we don't waste tokens on empty headings.
   */
  formatForPrompt(botId: string, opts: { runLogLimit?: number; cardLimitPerColumn?: number } = {}): string {
    if (!botId) return '';
    const rec = loadFile().bots[botId] || { cards: [], runLog: [] };

    const cardLimit = Math.max(3, opts.cardLimitPerColumn ?? 8);
    const runLimit = Math.max(1, opts.runLogLimit ?? 5);

    const sections: string[] = [];

    if (rec.cards.length > 0) {
      const byStatus: Record<BotKanbanStatus, BotKanbanCard[]> = {
        in_progress: [], queued: [], failed: [], completed: [],
      };
      for (const c of rec.cards) byStatus[c.status].push(c);
      // Sort each column newest-first.
      for (const k of Object.keys(byStatus) as BotKanbanStatus[]) {
        byStatus[k].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      const lines: string[] = [
        '# YOUR PRIVATE KANBAN (persists across runs — this is YOUR working memory)',
        'Manage cards with the bot_memory_* tools (always available to you):',
        '  • bot_memory_list — see every card; filter by status when you need to.',
        '  • bot_memory_create — capture a new intent, plan, or finding (defaults to "queued").',
        '  • bot_memory_update — move a card between columns or edit its notes.',
        '  • bot_memory_delete — drop a card (prefer marking "completed" so history sticks).',
        '  • bot_memory_log — append a one-line wrap-up of this run for your future self.',
        'The user can edit these cards too; lastEditedBy distinguishes their edits from yours.',
      ];
      const labelMap: Record<BotKanbanStatus, string> = {
        in_progress: 'In progress',
        queued: 'Queued',
        failed: 'Failed (retry or close out)',
        completed: 'Recently completed',
      };
      const order: BotKanbanStatus[] = ['in_progress', 'queued', 'failed', 'completed'];
      for (const status of order) {
        const list = byStatus[status];
        if (list.length === 0) continue;
        lines.push(`\n## ${labelMap[status]}`);
        for (const c of list.slice(0, cardLimit)) {
          const noteSuffix = c.notes ? ` — ${c.notes.replace(/\s+/g, ' ').slice(0, 200)}` : '';
          lines.push(`- [${c.id}] ${c.title}${noteSuffix}`);
        }
        if (list.length > cardLimit) {
          lines.push(`- …and ${list.length - cardLimit} more (call bot_memory_list to see all)`);
        }
      }
      sections.push(lines.join('\n'));
    } else {
      // No cards yet — still tell the agent the tools exist so it can start
      // building memory on its very first run instead of running blind.
      sections.push([
        '# YOUR PRIVATE KANBAN (empty — start populating it as you work)',
        'You have a private kanban that persists across runs. Use it as your working memory:',
        '  • bot_memory_create({ title, notes?, status? }) — log a plan or finding now so future runs see it.',
        '  • bot_memory_list / bot_memory_update / bot_memory_delete — manage existing cards.',
        '  • bot_memory_log({ summary, outcome }) — wrap up each run with a single line.',
        'The user can also seed cards from the Kanban tab — check it first before duplicating their intent.',
      ].join('\n'));
    }

    if (rec.runLog.length > 0) {
      const recent = [...rec.runLog].reverse().slice(0, runLimit);
      const lines: string[] = ['# Recent runs (most recent first)'];
      for (const r of recent) {
        const when = r.at.replace('T', ' ').slice(0, 16);
        const outcomeMark = r.outcome === 'success' ? '✓' : r.outcome === 'partial' ? '~' : '✗';
        lines.push(`- ${outcomeMark} ${when} — ${r.summary}${r.notes ? ` (${r.notes.slice(0, 160)})` : ''}`);
      }
      sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
  },
};
