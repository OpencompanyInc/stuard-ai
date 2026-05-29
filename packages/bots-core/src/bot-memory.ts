/**
 * Shared bot-memory store — the per-bot private kanban + run log that gives a
 * deployed bot cross-session working memory. Single-sourced between the desktop
 * (bot-memory-service) and the VM (vm-bot-memory), which previously kept
 * near-identical copies. The ONLY platform difference is storage: desktop reads/
 * writes Electron userData; the VM reads/writes /home/stuard/bots. That's
 * injected via a BotMemoryStorage adapter; all logic lives here.
 *
 * Canonicalized on the desktop implementation.
 */

export type BotKanbanStatus = 'queued' | 'in_progress' | 'completed' | 'failed';
export type BotMemoryActor = 'bot' | 'user';

/**
 * A card on a bot's private kanban — its own working memory (planning, doing,
 * done, stuck). Separate from the user-facing task system. Both the bot (via its
 * bot_memory tool) and the user (via the Kanban tab) can edit; `lastEditedBy`
 * records who touched it last.
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

/** A single run's outcome line, appended once per wake-up. Kept short. */
export interface BotRunLogEntry {
  id: string;
  at: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failed';
  cardIds?: string[];
  notes?: string;
}

export interface BotPersonalMemory {
  name?: string;
  preferences?: string;
  systemPrompt?: string;
  facts?: string;
}

export type BotPersonalMemorySlot = keyof BotPersonalMemory;

export interface BotMemoryRecord {
  profile: BotPersonalMemory;
  cards: BotKanbanCard[];
  runLog: BotRunLogEntry[];
}

export interface BotMemoryFile {
  version: 1;
  bots: Record<string, BotMemoryRecord>;
}

/** Host-provided persistence. Implementations decide where the file lives. */
export interface BotMemoryStorage {
  load(): BotMemoryFile;
  save(file: BotMemoryFile): void;
}

export const BOT_MEMORY_STATUS_VALUES: BotKanbanStatus[] = ['queued', 'in_progress', 'completed', 'failed'];
const STATUS_VALUES = BOT_MEMORY_STATUS_VALUES;
const RUN_LOG_LIMIT = 50; // Trim oldest past this — keeps prompt + file small.

export function emptyBotMemoryFile(): BotMemoryFile {
  return { version: 1, bots: {} };
}

export function normalizeBotMemoryRecord(raw: any): BotMemoryRecord {
  const profile = normalizeProfile(raw?.profile);
  const cards: BotKanbanCard[] = Array.isArray(raw?.cards)
    ? (raw.cards.map(normalizeCard).filter(Boolean) as BotKanbanCard[])
    : [];
  const runLog: BotRunLogEntry[] = Array.isArray(raw?.runLog)
    ? (raw.runLog.map(normalizeRunLog).filter(Boolean) as BotRunLogEntry[])
    : [];
  return { profile, cards, runLog };
}

function normalizeProfile(raw: any): BotPersonalMemory {
  if (!raw || typeof raw !== 'object') return {};
  const out: BotPersonalMemory = {};
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim();
  if (typeof raw.preferences === 'string' && raw.preferences.trim()) out.preferences = raw.preferences.trim();
  if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim()) out.systemPrompt = raw.systemPrompt.trim();
  if (typeof raw.system_prompt === 'string' && raw.system_prompt.trim()) out.systemPrompt = raw.system_prompt.trim();
  if (typeof raw.facts === 'string' && raw.facts.trim()) out.facts = raw.facts.trim();
  return out;
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
  if (!file.bots[botId]) file.bots[botId] = { profile: {}, cards: [], runLog: [] };
  else if (!file.bots[botId].profile) file.bots[botId].profile = {};
  return file.bots[botId];
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface BotMemoryStore {
  getProfile(botId: string): BotPersonalMemory;
  updateProfile(botId: string, patch: Partial<BotPersonalMemory>): BotPersonalMemory;
  listCards(botId: string, opts?: { status?: BotKanbanStatus }): BotKanbanCard[];
  getCard(botId: string, cardId: string): BotKanbanCard | null;
  createCard(botId: string, input: { title: string; notes?: string; status?: BotKanbanStatus }, by: BotMemoryActor): BotKanbanCard | null;
  updateCard(botId: string, cardId: string, patch: Partial<Pick<BotKanbanCard, 'title' | 'notes' | 'status'>>, by: BotMemoryActor): BotKanbanCard | null;
  deleteCard(botId: string, cardId: string): boolean;
  appendRunLog(botId: string, entry: { summary: string; outcome?: BotRunLogEntry['outcome']; cardIds?: string[]; notes?: string }): BotRunLogEntry | null;
  listRunLog(botId: string, limit?: number): BotRunLogEntry[];
  exportSnapshot(botId: string, limit?: number): BotMemoryRecord;
  replaceRecord(botId: string, record: Partial<BotMemoryRecord>): BotMemoryRecord;
  mergeSnapshot(botId: string, snapshot: Partial<BotMemoryRecord>): BotMemoryRecord;
  clearForBot(botId: string): boolean;
  formatForPrompt(botId: string, opts?: { runLogLimit?: number; cardLimitPerColumn?: number }): string;
}

/** Build a bot-memory store backed by host-provided storage. All logic shared. */
export function createBotMemoryStore(storage: BotMemoryStorage): BotMemoryStore {
  const load = () => storage.load();
  const save = (file: BotMemoryFile) => storage.save(file);

  return {
    listCards(botId, opts = {}) {
      if (!botId) return [];
      const rec = load().bots[botId];
      if (!rec) return [];
      const cards = opts.status ? rec.cards.filter(c => c.status === opts.status) : rec.cards;
      return [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    getProfile(botId) {
      if (!botId) return {};
      return { ...(load().bots[botId]?.profile || {}) };
    },

    updateProfile(botId, patch) {
      if (!botId) return {};
      const file = load();
      const rec = ensureRecord(file, botId);
      rec.profile = normalizeProfile({ ...(rec.profile || {}), ...(patch || {}) });
      save(file);
      return { ...rec.profile };
    },

    getCard(botId, cardId) {
      if (!botId || !cardId) return null;
      const rec = load().bots[botId];
      return rec?.cards.find(c => c.id === cardId) || null;
    },

    createCard(botId, input, by) {
      const title = String(input?.title || '').trim();
      if (!botId || !title) return null;
      const file = load();
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
      save(file);
      return card;
    },

    updateCard(botId, cardId, patch, by) {
      if (!botId || !cardId) return null;
      const file = load();
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
      save(file);
      return next;
    },

    deleteCard(botId, cardId) {
      if (!botId || !cardId) return false;
      const file = load();
      const rec = file.bots[botId];
      if (!rec) return false;
      const before = rec.cards.length;
      rec.cards = rec.cards.filter(c => c.id !== cardId);
      if (rec.cards.length === before) return false;
      save(file);
      return true;
    },

    appendRunLog(botId, entry) {
      const summary = String(entry?.summary || '').trim();
      if (!botId || !summary) return null;
      const file = load();
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
      if (rec.runLog.length > RUN_LOG_LIMIT) rec.runLog = rec.runLog.slice(-RUN_LOG_LIMIT);
      save(file);
      return log;
    },

    listRunLog(botId, limit = 20) {
      if (!botId) return [];
      const rec = load().bots[botId];
      if (!rec) return [];
      return [...rec.runLog].reverse().slice(0, Math.max(1, Math.min(limit, RUN_LOG_LIMIT)));
    },

    exportSnapshot(botId, limit = RUN_LOG_LIMIT) {
      if (!botId) return { profile: {}, cards: [], runLog: [] };
      const rec = load().bots[botId];
      if (!rec) return { profile: {}, cards: [], runLog: [] };
      return {
        profile: { ...(rec.profile || {}) },
        cards: [...rec.cards],
        runLog: [...rec.runLog].slice(-Math.max(1, Math.min(limit, RUN_LOG_LIMIT))),
      };
    },

    replaceRecord(botId, record) {
      if (!botId) return { profile: {}, cards: [], runLog: [] };
      const file = load();
      file.bots[botId] = normalizeBotMemoryRecord(record);
      save(file);
      return file.bots[botId];
    },

    mergeSnapshot(botId, snapshot) {
      if (!botId) return { profile: {}, cards: [], runLog: [] };
      const incoming = normalizeBotMemoryRecord(snapshot);
      const file = load();
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

      const merged = normalizeBotMemoryRecord({
        cards: Array.from(cardsById.values()),
        runLog: Array.from(logsById.values()),
        profile: { ...(current.profile || {}), ...(incoming.profile || {}) },
      });
      file.bots[botId] = { profile: merged.profile, cards: merged.cards, runLog: merged.runLog.slice(-RUN_LOG_LIMIT) };
      save(file);
      return file.bots[botId];
    },

    clearForBot(botId) {
      if (!botId) return false;
      const file = load();
      if (!file.bots[botId]) return false;
      delete file.bots[botId];
      save(file);
      return true;
    },

    formatForPrompt(botId, opts = {}) {
      if (!botId) return '';
      const rec = load().bots[botId] || { profile: {}, cards: [], runLog: [] };
      const cardLimit = Math.max(3, opts.cardLimitPerColumn ?? 8);
      const runLimit = Math.max(1, opts.runLogLimit ?? 5);
      const sections: string[] = [];

      const profile = rec.profile || {};
      const profileLines: string[] = ['# YOUR PERSONAL MEMORY SLOTS'];
      if (profile.name) profileLines.push(`- name: ${profile.name}`);
      if (profile.preferences) profileLines.push(`- preferences: ${profile.preferences}`);
      if (profile.facts) profileLines.push(`- facts: ${profile.facts}`);
      if (profile.systemPrompt) profileLines.push(`- system_prompt: ${profile.systemPrompt}`);
      profileLines.push('Use bot_memory_profile_update to keep these fixed slots current; do not store these as kanban cards.');
      sections.push(profileLines.join('\n'));

      if (rec.cards.length > 0) {
        const byStatus: Record<BotKanbanStatus, BotKanbanCard[]> = { in_progress: [], queued: [], failed: [], completed: [] };
        for (const c of rec.cards) byStatus[c.status].push(c);
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
}
